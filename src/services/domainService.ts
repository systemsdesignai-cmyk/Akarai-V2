import { db } from '../db/database';
import { ORG_ID, OWNER_USER_ID, seedSampleData } from '../db/sampleData';
import type {
  ApplicationSettings,
  Charge,
  ChargeType,
  CommunicationChannel,
  DepositLiability,
  DocumentCategory,
  DocumentationStatus,
  DocumentationType,
  Expense,
  LeaseCategory,
  LedgerAdjustment,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MessageDeliveryStatus,
  Payment,
  PaymentMethod,
  PaymentVerificationStatus,
  Property,
  PropertyCategory,
  Receipt,
  RoleType,
  Tenancy,
  TenancyLedgerSummary,
  TenancyStatus,
  Unit,
  UnitStatus,
  UnitType,
} from '../types/domain';
import { generateUUID, todayIso } from '../utils/format';

export const MAX_SINGLE_TRANSACTION_CENTS = 1_000_000_000; // R10,000,000.00 safety ceiling

const ACTIVE_TENANCY_STATUSES: TenancyStatus[] = ['active', 'notice_given', 'renewing'];

/**
 * Thrown when a user submits a second payment on the same day with the same tenancy, method,
 * amount, and reference (e.g., two cash payments on the same day without a reference).
 * The UI catches this to request explicit confirmation before recording a distinct payment.
 */
export class DuplicatePaymentConfirmationError extends Error {
  readonly code = 'SAME_DAY_DUPLICATE_CONFIRMATION_REQUIRED' as const;
  readonly existingPaymentId: string;
  readonly amountCents: number;
  readonly transactionDate: string;

  constructor(existingPaymentId: string, amountCents: number, transactionDate: string) {
    super(
      `A payment of R${(amountCents / 100).toFixed(2)} on ${transactionDate} with the same method and reference already exists. Confirm if this is a distinct second payment.`
    );
    this.name = 'DuplicatePaymentConfirmationError';
    this.existingPaymentId = existingPaymentId;
    this.amountCents = amountCents;
    this.transactionDate = transactionDate;
  }
}

// Tracks in-flight payment submission tokens/fingerprints to block concurrent double-submits immediately.
const inFlightPaymentKeys = new Set<string>();

export function assertValidPositiveCents(value: number, label = 'Amount'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a valid finite number.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be stored as an exact integer number of cents.`);
  }
  if (value <= 0) {
    throw new Error(`${label} must be greater than R 0.00.`);
  }
  if (value > MAX_SINGLE_TRANSACTION_CENTS) {
    throw new Error(`${label} exceeds the single-entry maximum limit (R 10,000,000.00).`);
  }
  return value;
}

export function assertValidNonNegativeCents(value: number, label = 'Amount'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a valid finite number.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be stored as an exact integer number of cents.`);
  }
  if (value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
  if (value > MAX_SINGLE_TRANSACTION_CENTS) {
    throw new Error(`${label} exceeds the maximum allowed limit.`);
  }
  return value;
}

export function assertValidISODate(dateStr: string, label = 'Date'): string {
  const trimmed = typeof dateStr === 'string' ? dateStr.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error(`${label} "${trimmed}" is not a real calendar date.`);
  }
  return trimmed;
}

export function assertValidPeriodMonth(periodMonth: string): string {
  const trimmed = typeof periodMonth === 'string' ? periodMonth.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    throw new Error('Billing period must be in YYYY-MM format (e.g., 2026-11).');
  }
  return trimmed;
}

async function nextUniqueReceiptNumber(prefix: string): Promise<string> {
  const existing = await db.receipts.toArray();
  const used = new Set(existing.map((r) => r.receiptNumber));
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let maxSeq = 0;
  for (const r of existing) {
    const m = pattern.exec(r.receiptNumber);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  let candidateSeq = maxSeq + 1;
  let candidate = `${prefix}-${String(candidateSeq).padStart(3, '0')}`;
  while (used.has(candidate)) {
    candidateSeq += 1;
    candidate = `${prefix}-${String(candidateSeq).padStart(3, '0')}`;
  }
  return candidate;
}

async function nextUniqueTicketNumber(): Promise<string> {
  const existing = await db.maintenanceTickets.toArray();
  const used = new Set(existing.map((t) => t.ticketNumber));
  let maxSeq = 13;
  for (const t of existing) {
    const m = /^MNT-2026-(\d+)$/.exec(t.ticketNumber);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  let seq = maxSeq + 1;
  let candidate = `MNT-2026-${String(seq).padStart(3, '0')}`;
  while (used.has(candidate)) {
    seq += 1;
    candidate = `MNT-2026-${String(seq).padStart(3, '0')}`;
  }
  return candidate;
}

/**
 * Pure, deterministic ledger balance calculator.
 * Balances are ALWAYS derived from charges, payment allocations, unallocated payment credits, and ledger adjustments.
 * Deposits are tracked separately as liabilities and never mixed into rental revenue.
 */
export function computeTenancyLedgerSummary(
  tenancyId: string,
  allCharges: Charge[],
  allPayments: Payment[],
  allAdjustments: LedgerAdjustment[],
  allDeposits: DepositLiability[],
  referenceDateIso: string = todayIso()
): TenancyLedgerSummary {
  const charges = allCharges.filter((c) => c.tenancyId === tenancyId && !c.isDeleted && c.status !== 'reversed');
  const payments = allPayments.filter(
    (p) => p.tenancyId === tenancyId && !p.isDeleted && p.verificationStatus !== 'reversed'
  );
  const adjustments = allAdjustments.filter((a) => a.tenancyId === tenancyId && !a.isDeleted);
  const deposits = allDeposits.filter((d) => d.tenancyId === tenancyId && !d.isDeleted);

  let totalChargedCents = 0;
  let totalAllocatedPaidCents = 0;
  let totalWaivedOrCreditedCents = 0;
  let totalDebitAdjustedCents = 0;
  let overdueAmountCents = 0;

  for (const c of charges) {
    totalChargedCents += c.amountCents;
    totalAllocatedPaidCents += c.allocatedPaidCents;
    if (c.adjustedCents < 0) {
      totalWaivedOrCreditedCents += Math.abs(c.adjustedCents);
    } else if (c.adjustedCents > 0) {
      totalDebitAdjustedCents += c.adjustedCents;
    }

    const netChargeRemaining = Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents);
    if (c.status === 'overdue' || (netChargeRemaining > 0 && c.dueDate < referenceDateIso)) {
      overdueAmountCents += netChargeRemaining;
    }
  }

  // Also include standalone tenancy-level adjustments not tied to a single charge
  for (const adj of adjustments) {
    if (!adj.chargeId) {
      if (adj.adjustmentType === 'waiver' || adj.adjustmentType === 'credit_note') {
        totalWaivedOrCreditedCents += adj.amountCents;
      } else if (adj.adjustmentType === 'debit_correction') {
        totalDebitAdjustedCents += adj.amountCents;
      }
    }
  }

  let totalUnallocatedCreditCents = 0;
  for (const p of payments) {
    totalUnallocatedCreditCents += p.unallocatedCents;
  }

  const netBalanceDueCents =
    totalChargedCents +
    totalDebitAdjustedCents -
    totalWaivedOrCreditedCents -
    totalAllocatedPaidCents -
    totalUnallocatedCreditCents;

  const depositHeldLiabilityCents = deposits.reduce(
    (acc, d) => acc + Math.max(0, d.receivedDepositCents + d.accruedInterestCents - d.deductionsCents - d.refundedCents),
    0
  );

  return {
    tenancyId,
    totalChargedCents,
    totalAllocatedPaidCents,
    totalUnallocatedCreditCents,
    totalWaivedOrCreditedCents,
    totalDebitAdjustedCents,
    netBalanceDueCents,
    overdueAmountCents: Math.max(0, overdueAmountCents - totalUnallocatedCreditCents),
    depositHeldLiabilityCents,
  };
}

async function logAuditAndSync(params: {
  entityTable: string;
  entityType: string;
  entityId: string;
  action: string;
  operation: 'insert' | 'update' | 'soft_delete';
  summary: string;
  payload: unknown;
  isFinancialEvent: boolean;
  actorUserId?: string;
  actorName?: string;
  actorRole?: RoleType;
}) {
  const now = new Date().toISOString();
  const settings = await db.applicationSettings.get('settings-default');
  const actorUserId = params.actorUserId || settings?.activeUserId || OWNER_USER_ID;
  const actorRole = params.actorRole || settings?.activeRole || 'owner';
  const user = await db.users.get(actorUserId);
  const actorName = params.actorName || user?.fullName || 'Local Operator';

  await db.auditEvents.add({
    id: generateUUID(),
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actorUserId,
    actorName,
    actorRole,
    summary: params.summary,
    newStateJson: JSON.stringify(params.payload),
  });

  await db.syncOperations.add({
    id: generateUUID(),
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    entityTable: params.entityTable,
    entityId: params.entityId,
    operation: params.operation,
    baseRevision: 0,
    targetRevision: 1,
    payloadJson: JSON.stringify(params.payload),
    isFinancialEvent: params.isFinancialEvent,
    syncStatus: 'queued_local_only',
  });
}

export async function createPropertyRecord(input: {
  name: string;
  category: PropertyCategory;
  portfolioId?: string;
  ownerEntityId?: string;
  streetAddress: string;
  suburb: string;
  city: string;
  province: Property['province'];
  postalCode: string;
  buildingsCount: number;
  floorsCount: number;
  notes?: string;
}): Promise<Property> {
  if (!input.name.trim()) throw new Error('Property name is required.');
  const now = new Date().toISOString();
  const property: Property = {
    id: `prop-${generateUUID().slice(0, 8)}`,
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    portfolioId: input.portfolioId || 'port-gauteng',
    ownerEntityId: input.ownerEntityId || 'owner-ent-1',
    name: input.name.trim(),
    category: input.category,
    streetAddress: input.streetAddress.trim(),
    suburb: input.suburb.trim(),
    city: input.city.trim(),
    province: input.province,
    postalCode: input.postalCode.trim(),
    buildingsCount: Math.max(1, Math.round(input.buildingsCount || 1)),
    floorsCount: Math.max(1, Math.round(input.floorsCount || 1)),
    notes: input.notes?.trim(),
  };

  await db.transaction(
    'rw',
    [db.properties, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      await db.properties.add(property);
      await logAuditAndSync({
        entityTable: 'properties',
        entityType: 'Property',
        entityId: property.id,
        action: 'CREATE_PROPERTY',
        operation: 'insert',
        summary: `Created property "${property.name}" in ${property.suburb}, ${property.city}.`,
        payload: property,
        isFinancialEvent: false,
      });
    }
  );
  return property;
}

export async function createUnitRecord(input: {
  propertyId: string;
  unitNumber: string;
  name: string;
  unitType: UnitType;
  buildingName?: string;
  floorLabel?: string;
  status: UnitStatus;
  standardRentCents: number;
  sizeSqm?: number;
  amenities: string[];
  meterNumberElectricity?: string;
  meterNumberWater?: string;
  notes?: string;
}): Promise<Unit> {
  if (!input.propertyId) throw new Error('Property is required.');
  if (!input.unitNumber.trim()) throw new Error('Unit number is required.');
  const rentCents = assertValidNonNegativeCents(Math.round(input.standardRentCents), 'Standard rent');
  const now = new Date().toISOString();
  const unit: Unit = {
    id: `unit-${generateUUID().slice(0, 8)}`,
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    propertyId: input.propertyId,
    unitNumber: input.unitNumber.trim(),
    name: input.name.trim() || input.unitNumber.trim(),
    unitType: input.unitType,
    buildingName: input.buildingName?.trim() || 'Main Structure',
    floorLabel: input.floorLabel?.trim() || 'Ground',
    status: input.status,
    standardRentCents: rentCents,
    billingCycle: 'monthly',
    sizeSqm: input.sizeSqm,
    amenities: input.amenities,
    meterNumberElectricity: input.meterNumberElectricity?.trim(),
    meterNumberWater: input.meterNumberWater?.trim(),
    notes: input.notes?.trim(),
  };

  await db.transaction(
    'rw',
    [db.units, db.properties, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const property = await db.properties.get(input.propertyId);
      if (!property) throw new Error('Selected property not found.');
      await db.units.add(unit);
      await logAuditAndSync({
        entityTable: 'units',
        entityType: 'Unit',
        entityId: unit.id,
        action: 'CREATE_UNIT',
        operation: 'insert',
        summary: `Added unit ${unit.unitNumber} (${unit.name}) with standard rent R${(unit.standardRentCents / 100).toFixed(2)}.`,
        payload: unit,
        isFinancialEvent: false,
      });
    }
  );
  return unit;
}

export async function updatePropertyRecord(
  propertyId: string,
  updates: {
    name?: string;
    category?: PropertyCategory;
    streetAddress?: string;
    suburb?: string;
    city?: string;
    province?: Property['province'];
    postalCode?: string;
    buildingsCount?: number;
    floorsCount?: number;
    notes?: string;
  }
): Promise<Property> {
  const now = new Date().toISOString();
  return await db.transaction(
    'rw',
    [db.properties, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const existing = await db.properties.get(propertyId);
      if (!existing) throw new Error('Property not found.');
      const nextName = updates.name !== undefined ? updates.name.trim() : existing.name;
      if (!nextName) throw new Error('Property name is required.');

      const updated: Property = {
        ...existing,
        name: nextName,
        category: updates.category ?? existing.category,
        streetAddress: updates.streetAddress !== undefined ? updates.streetAddress.trim() : existing.streetAddress,
        suburb: updates.suburb !== undefined ? updates.suburb.trim() : existing.suburb,
        city: updates.city !== undefined ? updates.city.trim() : existing.city,
        province: updates.province ?? existing.province,
        postalCode: updates.postalCode !== undefined ? updates.postalCode.trim() : existing.postalCode,
        buildingsCount:
          updates.buildingsCount !== undefined ? Math.max(1, Math.round(updates.buildingsCount)) : existing.buildingsCount,
        floorsCount:
          updates.floorsCount !== undefined ? Math.max(1, Math.round(updates.floorsCount)) : existing.floorsCount,
        notes: updates.notes !== undefined ? updates.notes.trim() || undefined : existing.notes,
        updatedAt: now,
        revision: existing.revision + 1,
      };

      await db.properties.put(updated);
      await logAuditAndSync({
        entityTable: 'properties',
        entityType: 'Property',
        entityId: propertyId,
        action: 'UPDATE_PROPERTY',
        operation: 'update',
        summary: `Updated property "${updated.name}" (${updated.suburb}, ${updated.city}).`,
        payload: updated,
        isFinancialEvent: false,
      });
      return updated;
    }
  );
}

export async function updateUnitRecord(
  unitId: string,
  updates: {
    unitNumber?: string;
    name?: string;
    unitType?: UnitType;
    buildingName?: string;
    floorLabel?: string;
    status?: UnitStatus;
    standardRentCents?: number;
    sizeSqm?: number;
    meterNumberElectricity?: string;
    meterNumberWater?: string;
    notes?: string;
  }
): Promise<Unit> {
  const now = new Date().toISOString();
  return await db.transaction(
    'rw',
    [db.units, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const existing = await db.units.get(unitId);
      if (!existing) throw new Error('Unit not found.');
      const nextUnitNumber = updates.unitNumber !== undefined ? updates.unitNumber.trim() : existing.unitNumber;
      if (!nextUnitNumber) throw new Error('Unit number is required.');
      const nextRent =
        updates.standardRentCents !== undefined
          ? assertValidNonNegativeCents(Math.round(updates.standardRentCents), 'Standard rent')
          : existing.standardRentCents;

      const updated: Unit = {
        ...existing,
        unitNumber: nextUnitNumber,
        name: updates.name !== undefined ? updates.name.trim() || nextUnitNumber : existing.name,
        unitType: updates.unitType ?? existing.unitType,
        buildingName: updates.buildingName !== undefined ? updates.buildingName.trim() || 'Main Structure' : existing.buildingName,
        floorLabel: updates.floorLabel !== undefined ? updates.floorLabel.trim() || 'Ground' : existing.floorLabel,
        status: updates.status ?? existing.status,
        standardRentCents: nextRent,
        sizeSqm: updates.sizeSqm !== undefined ? updates.sizeSqm : existing.sizeSqm,
        meterNumberElectricity:
          updates.meterNumberElectricity !== undefined
            ? updates.meterNumberElectricity.trim() || undefined
            : existing.meterNumberElectricity,
        meterNumberWater:
          updates.meterNumberWater !== undefined ? updates.meterNumberWater.trim() || undefined : existing.meterNumberWater,
        notes: updates.notes !== undefined ? updates.notes.trim() || undefined : existing.notes,
        updatedAt: now,
        revision: existing.revision + 1,
      };

      await db.units.put(updated);
      await logAuditAndSync({
        entityTable: 'units',
        entityType: 'Unit',
        entityId: unitId,
        action: 'UPDATE_UNIT',
        operation: 'update',
        summary: `Updated unit ${updated.unitNumber} (${updated.name}) — standard rent R${(updated.standardRentCents / 100).toFixed(2)}.`,
        payload: updated,
        isFinancialEvent: false,
      });
      return updated;
    }
  );
}

export async function createTenantRecord(input: {
  fullName: string;
  provisionalIdentifier?: string;
  primaryPhone?: string;
  alternativePhone?: string;
  alternativeContactName?: string;
  email?: string;
  hasSmartphone: boolean;
  hasBankAccount: boolean;
  hasInternetAccess: boolean;
  documentationType: DocumentationType;
  documentationStatus: DocumentationStatus;
  referenceHint?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  preferredChannel: CommunicationChannel;
  occupantsCount: number;
  portalAccessEnabled: boolean;
  notes?: string;
}) {
  if (!input.fullName.trim()) throw new Error('Tenant full name is required.');
  const now = new Date().toISOString();
  const personId = `person-${generateUUID().slice(0, 8)}`;
  const tenantId = `tenant-${generateUUID().slice(0, 8)}`;

  return await db.transaction(
    'rw',
    [
      db.people,
      db.tenantProfiles,
      db.identityEvidences,
      db.consentRecords,
      db.applicationSettings,
      db.users,
      db.auditEvents,
      db.syncOperations,
    ],
    async () => {
      const existingTenants = await db.tenantProfiles.toArray();
      const usedCodes = new Set(existingTenants.map((t) => t.tenantCode));
      let seq = existingTenants.length + 1;
      let tenantCode = `TEN-${String(seq).padStart(3, '0')}`;
      while (usedCodes.has(tenantCode)) {
        seq += 1;
        tenantCode = `TEN-${String(seq).padStart(3, '0')}`;
      }

      const settings = await db.applicationSettings.get('settings-default');
      const activeUser = await db.users.get(settings?.activeUserId || OWNER_USER_ID);
      const actorName = activeUser?.fullName || 'Local Operator';

      await db.people.add({
        id: personId,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        fullName: input.fullName.trim(),
        provisionalIdentifier: input.provisionalIdentifier?.trim(),
        primaryPhone: input.primaryPhone?.trim() || undefined,
        alternativePhone: input.alternativePhone?.trim() || undefined,
        alternativeContactRelation: input.alternativeContactName?.trim() || undefined,
        email: input.email?.trim() || undefined,
        hasSmartphone: input.hasSmartphone,
        hasBankAccount: input.hasBankAccount,
        hasInternetAccess: input.hasInternetAccess,
        preferredLanguage: 'English',
      });

      const profile = {
        id: tenantId,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        personId,
        tenantCode,
        fullName: input.fullName.trim(),
        provisionalIdentifier: input.provisionalIdentifier?.trim() || undefined,
        primaryPhone: input.primaryPhone?.trim() || undefined,
        alternativePhone: input.alternativePhone?.trim() || undefined,
        alternativeContactName: input.alternativeContactName?.trim() || undefined,
        email: input.email?.trim() || undefined,
        hasSmartphone: input.hasSmartphone,
        hasBankAccount: input.hasBankAccount,
        hasInternetAccess: input.hasInternetAccess,
        documentationType: input.documentationType,
        documentationStatus: input.documentationStatus,
        emergencyContactName: input.emergencyContactName?.trim() || undefined,
        emergencyContactPhone: input.emergencyContactPhone?.trim() || undefined,
        emergencyContactRelation: input.emergencyContactRelation?.trim() || undefined,
        portalAccessEnabled: input.portalAccessEnabled,
        preferredChannel: input.preferredChannel,
        occupantsCount: Math.max(1, Math.round(input.occupantsCount || 1)),
        notes: input.notes?.trim() || undefined,
      };

      await db.tenantProfiles.add(profile);

      await db.identityEvidences.add({
        id: `idev-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        tenantId,
        documentationType: input.documentationType,
        documentationStatus: input.documentationStatus,
        referenceHint:
          input.referenceHint?.trim() ||
          (input.documentationStatus === 'not-provided'
            ? 'No formal document collected — administrative record allowed'
            : 'Minimized metadata recorded'),
        verificationNotes:
          'Identity verification and immigration status are distinct concepts. Missing documentation does not imply unlawful status.',
        consentToStoreMetadata: true,
      });

      await db.consentRecords.add({
        id: `con-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        tenantId,
        purpose: 'tenancy_administration',
        consentGranted: true,
        recordedMethod: input.hasSmartphone ? 'portal_checkbox' : 'verbal_witnessed_logged',
        recordedAt: now,
        recordedByName: actorName,
        notes: 'POPIA data minimization applied at tenant registration.',
      });

      await logAuditAndSync({
        entityTable: 'tenantProfiles',
        entityType: 'TenantProfile',
        entityId: tenantId,
        action: 'REGISTER_TENANT',
        operation: 'insert',
        summary: `Registered tenant "${profile.fullName}" (${tenantCode}) with documentation status: ${profile.documentationStatus}.`,
        payload: profile,
        isFinancialEvent: false,
      });

      return profile;
    }
  );
}

export async function updateTenantRecord(
  tenantId: string,
  updates: {
    fullName?: string;
    provisionalIdentifier?: string;
    primaryPhone?: string;
    alternativePhone?: string;
    alternativeContactName?: string;
    email?: string;
    preferredChannel?: CommunicationChannel;
    occupantsCount?: number;
    notes?: string;
  }
) {
  const now = new Date().toISOString();
  return await db.transaction(
    'rw',
    [db.tenantProfiles, db.people, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const existing = await db.tenantProfiles.get(tenantId);
      if (!existing) throw new Error('Tenant not found.');
      const nextName = updates.fullName !== undefined ? updates.fullName.trim() : existing.fullName;
      if (!nextName) throw new Error('Tenant full name is required.');

      const updated = {
        ...existing,
        fullName: nextName,
        provisionalIdentifier:
          updates.provisionalIdentifier !== undefined
            ? updates.provisionalIdentifier.trim() || undefined
            : existing.provisionalIdentifier,
        primaryPhone:
          updates.primaryPhone !== undefined
            ? updates.primaryPhone.trim() || undefined
            : existing.primaryPhone,
        alternativePhone:
          updates.alternativePhone !== undefined
            ? updates.alternativePhone.trim() || undefined
            : existing.alternativePhone,
        alternativeContactName:
          updates.alternativeContactName !== undefined
            ? updates.alternativeContactName.trim() || undefined
            : existing.alternativeContactName,
        email: updates.email !== undefined ? updates.email.trim() || undefined : existing.email,
        preferredChannel: updates.preferredChannel ?? existing.preferredChannel,
        occupantsCount:
          updates.occupantsCount !== undefined
            ? Math.max(1, Math.round(updates.occupantsCount))
            : existing.occupantsCount,
        notes: updates.notes !== undefined ? updates.notes.trim() || undefined : existing.notes,
        updatedAt: now,
        revision: existing.revision + 1,
      };

      await db.tenantProfiles.put(updated);
      if (existing.personId) {
        const person = await db.people.get(existing.personId);
        if (person) {
          await db.people.update(existing.personId, {
            fullName: updated.fullName,
            provisionalIdentifier: updated.provisionalIdentifier,
            primaryPhone: updated.primaryPhone,
            alternativePhone: updated.alternativePhone,
            alternativeContactRelation: updated.alternativeContactName,
            email: updated.email,
            updatedAt: now,
            revision: person.revision + 1,
          });
        }
      }

      await logAuditAndSync({
        entityTable: 'tenantProfiles',
        entityType: 'TenantProfile',
        entityId: tenantId,
        action: 'UPDATE_TENANT',
        operation: 'update',
        summary: `Updated tenant profile "${updated.fullName}" (${updated.tenantCode}).`,
        payload: updated,
        isFinancialEvent: false,
      });

      return updated;
    }
  );
}

export async function createTenancyRecord(input: {
  propertyId: string;
  unitId: string;
  primaryTenantId: string;
  coOccupantNames?: string[];
  leaseCategory: LeaseCategory;
  startDate: string;
  endDate?: string;
  rentAmountCents: number;
  dueDayOfMonth: number;
  depositRequiredCents: number;
  depositReceivedCents: number;
  recurringUtilityChargeCents: number;
  recurringUtilityLabel?: string;
  noticePeriodDays: number;
  specialTerms?: string;
  generateFirstMonthCharge: boolean;
  firstChargePeriodKey?: string;
}) {
  const startDate = assertValidISODate(input.startDate, 'Start date');
  const endDate = input.endDate?.trim() ? assertValidISODate(input.endDate, 'End date') : undefined;
  if (endDate && endDate < startDate) {
    throw new Error('Lease end date cannot be earlier than start date.');
  }
  const rentAmountCents = assertValidPositiveCents(Math.round(input.rentAmountCents), 'Monthly rent');
  const depositRequiredCents = assertValidNonNegativeCents(Math.round(input.depositRequiredCents || 0), 'Deposit required');
  const depositReceivedCents = assertValidNonNegativeCents(Math.round(input.depositReceivedCents || 0), 'Deposit received');
  const recurringUtilityChargeCents = assertValidNonNegativeCents(
    Math.round(input.recurringUtilityChargeCents || 0),
    'Recurring utility charge'
  );

  const now = new Date().toISOString();

  return await db.transaction(
    'rw',
    [
      db.tenancies,
      db.units,
      db.tenantProfiles,
      db.tenancyParticipants,
      db.leaseVersions,
      db.depositLiabilities,
      db.charges,
      db.applicationSettings,
      db.users,
      db.auditEvents,
      db.syncOperations,
    ],
    async () => {
      const unit = await db.units.get(input.unitId);
      if (!unit) throw new Error('Selected unit not found.');
      const tenant = await db.tenantProfiles.get(input.primaryTenantId);
      if (!tenant) throw new Error('Selected tenant not found.');

      // F05 / F07: Prevent overlapping active tenancies on the same unit.
      const existingUnitTenancies = await db.tenancies.where('unitId').equals(input.unitId).toArray();
      const conflicting = existingUnitTenancies.find(
        (t) => !t.isDeleted && ACTIVE_TENANCY_STATUSES.includes(t.status)
      );
      if (conflicting) {
        throw new Error(
          `Unit ${unit.unitNumber} already has an active tenancy (${conflicting.tenancyReference}). End or terminate the current tenancy before assigning a new active lease.`
        );
      }

      const existingAll = await db.tenancies.toArray();
      const usedRefs = new Set(existingAll.map((t) => t.tenancyReference));
      let seq = existingAll.length + 1;
      let tenancyReference = `LSE-${unit.unitNumber}-${String(seq).padStart(2, '0')}`;
      while (usedRefs.has(tenancyReference)) {
        seq += 1;
        tenancyReference = `LSE-${unit.unitNumber}-${String(seq).padStart(2, '0')}`;
      }

      const tenancyId = `tenancy-${generateUUID().slice(0, 8)}`;

      const tenancy: Tenancy = {
        id: tenancyId,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        propertyId: unit.propertyId,
        unitId: input.unitId,
        primaryTenantId: input.primaryTenantId,
        tenancyReference,
        leaseCategory: input.leaseCategory,
        status: 'active',
        startDate,
        endDate,
        moveInDate: startDate,
        rentAmountCents,
        paymentFrequency: 'monthly',
        dueDayOfMonth: Math.min(28, Math.max(1, Math.round(input.dueDayOfMonth || 1))),
        depositRequiredCents,
        recurringUtilityChargeCents,
        recurringUtilityLabel: input.recurringUtilityLabel?.trim() || 'Recurring Utility Charge',
        noticePeriodDays: Math.max(0, Math.round(input.noticePeriodDays || 30)),
        legalReviewStatus: 'neutral_template_unreviewed',
        specialTerms: input.specialTerms?.trim(),
      };

      await db.tenancies.add(tenancy);

      // Update unit status to occupied
      await db.units.update(unit.id, { status: 'occupied', updatedAt: now, revision: unit.revision + 1 });

      // Add primary participant & optional co-occupants
      await db.tenancyParticipants.add({
        id: `part-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        tenancyId,
        tenantId: input.primaryTenantId,
        fullName: tenant.fullName,
        role: 'primary_tenant',
        joinedDate: startDate,
      });

      if (input.coOccupantNames && input.coOccupantNames.length > 0) {
        for (const coName of input.coOccupantNames) {
          if (coName.trim()) {
            await db.tenancyParticipants.add({
              id: `part-${generateUUID().slice(0, 8)}`,
              organizationId: ORG_ID,
              createdAt: now,
              updatedAt: now,
              revision: 1,
              tenancyId,
              tenantId: input.primaryTenantId,
              fullName: coName.trim(),
              role: 'authorized_occupant',
              joinedDate: startDate,
            });
          }
        }
      }

      // Record initial lease version
      await db.leaseVersions.add({
        id: `lv-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        tenancyId,
        versionNumber: 1,
        effectiveDate: startDate,
        rentAmountCents: tenancy.rentAmountCents,
        termsSummary: `Initial agreement (${input.leaseCategory}) at R${(tenancy.rentAmountCents / 100).toFixed(2)}/month.`,
        templateTitle:
          input.leaseCategory === 'commercial_retail'
            ? 'Neutral Commercial Lease Template (Requires Legal Review)'
            : 'Neutral Residential / Room Agreement Template (Requires Legal Review)',
        isLegalReviewed: false,
        createdByUserId: OWNER_USER_ID,
      });

      // Record Deposit Liability separately from rental revenue
      if (depositRequiredCents > 0 || depositReceivedCents > 0) {
        await db.depositLiabilities.add({
          id: `dep-${generateUUID().slice(0, 8)}`,
          organizationId: ORG_ID,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          tenancyId,
          tenantId: input.primaryTenantId,
          propertyId: unit.propertyId,
          unitId: input.unitId,
          agreedDepositCents: depositRequiredCents,
          receivedDepositCents: depositReceivedCents,
          accruedInterestCents: 0,
          deductionsCents: 0,
          refundedCents: 0,
          heldInAccountNote: 'Dedicated Deposit Liability Account (Excluded from Rental Income)',
          status:
            depositReceivedCents >= depositRequiredCents
              ? 'held_as_liability'
              : depositReceivedCents > 0
                ? 'partially_held'
                : 'pending',
        });
      }

      if (input.generateFirstMonthCharge) {
        const periodMonth = input.firstChargePeriodKey || startDate.slice(0, 7);
        await generateChargeForTenancy({
          tenancyId,
          periodMonth,
          includeUtilities: true,
        });
      }

      await logAuditAndSync({
        entityTable: 'tenancies',
        entityType: 'Tenancy',
        entityId: tenancyId,
        action: 'CREATE_TENANCY',
        operation: 'insert',
        summary: `Created tenancy ${tenancyReference} for ${tenant.fullName} on unit ${unit.unitNumber}.`,
        payload: tenancy,
        isFinancialEvent: true,
      });

      return tenancy;
    }
  );
}

/**
 * Atomically updates tenancy status and synchronizes unit occupancy status (F07).
 */
export async function updateTenancyStatus(tenancyId: string, newStatus: TenancyStatus): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction(
    'rw',
    [db.tenancies, db.units, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const tenancy = await db.tenancies.get(tenancyId);
      if (!tenancy) throw new Error('Tenancy not found.');

      const unit = await db.units.get(tenancy.unitId);
      const siblingTenancies = (await db.tenancies.where('unitId').equals(tenancy.unitId).toArray()).filter(
        (t) => t.id !== tenancy.id && !t.isDeleted
      );
      const otherActive = siblingTenancies.find((t) => ACTIVE_TENANCY_STATUSES.includes(t.status));

      if (ACTIVE_TENANCY_STATUSES.includes(newStatus) && otherActive) {
        throw new Error(
          `Cannot set tenancy to "${newStatus}" because unit ${unit?.unitNumber || tenancy.unitId} already has another active tenancy (${otherActive.tenancyReference}).`
        );
      }

      const isEnding = newStatus === 'ended' || newStatus === 'terminated';
      await db.tenancies.update(tenancy.id, {
        status: newStatus,
        moveOutDate: isEnding ? tenancy.moveOutDate || now.slice(0, 10) : undefined,
        updatedAt: now,
        revision: tenancy.revision + 1,
      });

      if (unit) {
        if (isEnding && !otherActive && unit.status === 'occupied') {
          await db.units.update(unit.id, {
            status: 'vacant',
            updatedAt: now,
            revision: unit.revision + 1,
          });
        } else if (ACTIVE_TENANCY_STATUSES.includes(newStatus) && unit.status !== 'occupied') {
          await db.units.update(unit.id, {
            status: 'occupied',
            updatedAt: now,
            revision: unit.revision + 1,
          });
        }
      }

      await logAuditAndSync({
        entityTable: 'tenancies',
        entityType: 'Tenancy',
        entityId: tenancy.id,
        action: 'UPDATE_TENANCY_STATUS',
        operation: 'update',
        summary: `Updated tenancy ${tenancy.tenancyReference} status from ${tenancy.status} to ${newStatus}.`,
        payload: { tenancyId: tenancy.id, previousStatus: tenancy.status, newStatus },
        isFinancialEvent: false,
      });
    }
  );
}

/**
 * Generates recurring or manual charges for a tenancy while strictly preventing duplicate recurring charges for the same periodKey.
 */
export async function generateChargeForTenancy(input: {
  tenancyId: string;
  periodMonth: string; // e.g., "2026-11" or "2026-12"
  includeUtilities?: boolean;
  customCharge?: {
    chargeType: ChargeType;
    description: string;
    amountCents: number;
    dueDate: string;
  };
}): Promise<{ createdCharges: Charge[]; skippedDuplicates: string[] }> {
  const periodMonth = assertValidPeriodMonth(input.periodMonth);
  if (input.customCharge) {
    assertValidPositiveCents(input.customCharge.amountCents, 'Charge amount');
    assertValidISODate(input.customCharge.dueDate, 'Charge due date');
    if (!input.customCharge.description.trim()) {
      throw new Error('Charge description is required.');
    }
  }

  const now = new Date().toISOString();

  return await db.transaction(
    'rw',
    [db.tenancies, db.units, db.charges, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const tenancy = await db.tenancies.get(input.tenancyId);
      if (!tenancy) throw new Error('Tenancy not found');

      const unit = await db.units.get(tenancy.unitId);
      const existingCharges = await db.charges.where('tenancyId').equals(tenancy.id).toArray();
      const createdCharges: Charge[] = [];
      const skippedDuplicates: string[] = [];

      if (input.customCharge) {
        const customKey = `${periodMonth}-${input.customCharge.chargeType}-${generateUUID().slice(0, 4)}`;
        const charge: Charge = {
          id: `chg-${generateUUID().slice(0, 8)}`,
          organizationId: ORG_ID,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          tenancyId: tenancy.id,
          propertyId: tenancy.propertyId,
          unitId: tenancy.unitId,
          tenantId: tenancy.primaryTenantId,
          periodKey: customKey,
          chargeType: input.customCharge.chargeType,
          description: input.customCharge.description.trim(),
          amountCents: input.customCharge.amountCents,
          allocatedPaidCents: 0,
          adjustedCents: 0,
          dueDate: input.customCharge.dueDate,
          effectiveDate: input.customCharge.dueDate,
          status: input.customCharge.dueDate < todayIso() ? 'overdue' : 'due',
          recordedByUserId: OWNER_USER_ID,
        };
        await db.charges.add(charge);
        createdCharges.push(charge);
      } else {
        const rentPeriodKey = `${periodMonth}-rent`;
        const hasExistingRent = existingCharges.some(
          (c) => c.periodKey === rentPeriodKey && c.status !== 'reversed' && !c.isDeleted
        );

        const dueDayStr = String(tenancy.dueDayOfMonth).padStart(2, '0');
        const dueDate = `${periodMonth}-${dueDayStr}`;

        if (hasExistingRent) {
          skippedDuplicates.push(`Rent charge for ${periodMonth} (${tenancy.tenancyReference})`);
        } else {
          const rentCharge: Charge = {
            id: `chg-${generateUUID().slice(0, 8)}`,
            organizationId: ORG_ID,
            createdAt: now,
            updatedAt: now,
            revision: 1,
            tenancyId: tenancy.id,
            propertyId: tenancy.propertyId,
            unitId: tenancy.unitId,
            tenantId: tenancy.primaryTenantId,
            periodKey: rentPeriodKey,
            chargeType: 'rent',
            description: `${periodMonth} Monthly Rent — ${unit?.name || tenancy.tenancyReference}`,
            amountCents: tenancy.rentAmountCents,
            allocatedPaidCents: 0,
            adjustedCents: 0,
            dueDate,
            effectiveDate: `${periodMonth}-01`,
            status: dueDate < todayIso() ? 'overdue' : 'due',
            recordedByUserId: OWNER_USER_ID,
          };
          await db.charges.add(rentCharge);
          createdCharges.push(rentCharge);
        }

        if (input.includeUtilities && tenancy.recurringUtilityChargeCents > 0) {
          const utilPeriodKey = `${periodMonth}-utility`;
          const hasExistingUtil = existingCharges.some(
            (c) => c.periodKey === utilPeriodKey && c.status !== 'reversed' && !c.isDeleted
          );
          if (hasExistingUtil) {
            skippedDuplicates.push(`Utility charge for ${periodMonth} (${tenancy.tenancyReference})`);
          } else {
            const utilCharge: Charge = {
              id: `chg-${generateUUID().slice(0, 8)}`,
              organizationId: ORG_ID,
              createdAt: now,
              updatedAt: now,
              revision: 1,
              tenancyId: tenancy.id,
              propertyId: tenancy.propertyId,
              unitId: tenancy.unitId,
              tenantId: tenancy.primaryTenantId,
              periodKey: utilPeriodKey,
              chargeType: 'water',
              description: `${periodMonth} ${tenancy.recurringUtilityLabel || 'Utility Charge'}`,
              amountCents: tenancy.recurringUtilityChargeCents,
              allocatedPaidCents: 0,
              adjustedCents: 0,
              dueDate,
              effectiveDate: `${periodMonth}-01`,
              status: dueDate < todayIso() ? 'overdue' : 'due',
              recordedByUserId: OWNER_USER_ID,
            };
            await db.charges.add(utilCharge);
            createdCharges.push(utilCharge);
          }
        }
      }

      if (createdCharges.length > 0) {
        await logAuditAndSync({
          entityTable: 'charges',
          entityType: 'Charge',
          entityId: createdCharges[0].id,
          action: 'GENERATE_CHARGES',
          operation: 'insert',
          summary: `Generated ${createdCharges.length} charge(s) for tenancy ${tenancy.tenancyReference} (${periodMonth}).`,
          payload: createdCharges,
          isFinancialEvent: true,
        });
      }

      return { createdCharges, skippedDuplicates };
    }
  );
}

/**
 * Records an externally processed payment (Cash, EFT, ATM deposit, eWallet) atomically inside a
 * Dexie transaction (A01), validates amounts/dates strictly (A02), blocks concurrent/retry duplicates,
 * allows confirmed distinct same-day payments, allocates oldest unpaid charges first (FIFO),
 * tracks advance/overpayment credits, and generates a guaranteed-unique auditable Receipt.
 */
export async function recordPaymentTransaction(input: {
  tenancyId: string;
  amountCents: number;
  transactionDate: string;
  method: PaymentMethod;
  externalReference?: string;
  verificationStatus: PaymentVerificationStatus;
  notes?: string;
  idempotencyToken?: string;
  confirmDistinctDuplicate?: boolean;
  /** Optional internal test hook invoked inside the Dexie transaction right before commit to verify full rollback. */
  onBeforeCommitForTest?: () => void;
}): Promise<{ payment: Payment; receipt: Receipt }> {
  if (!input.tenancyId) throw new Error('Tenancy is required.');
  const roundedCents = assertValidPositiveCents(input.amountCents, 'Payment amount');
  const transactionDate = assertValidISODate(input.transactionDate, 'Transaction date');
  const normalizedRef = input.externalReference?.trim() || '';

  const sameDayFingerprint = `${input.tenancyId}-${transactionDate}-${input.method}-${roundedCents}-${normalizedRef || 'noref'}`;
  const inFlightLockKey = input.idempotencyToken?.trim()
    ? `tok:${input.idempotencyToken.trim()}`
    : `fp:${sameDayFingerprint}`;

  if (inFlightPaymentKeys.has(inFlightLockKey)) {
    throw new Error('Payment submission is already in progress. Duplicate submission blocked.');
  }

  inFlightPaymentKeys.add(inFlightLockKey);
  const now = new Date().toISOString();

  try {
    return await db.transaction(
      'rw',
      [
        db.tenancies,
        db.properties,
        db.units,
        db.tenantProfiles,
        db.ownerEntities,
        db.charges,
        db.payments,
        db.paymentAllocations,
        db.ledgerAdjustments,
        db.depositLiabilities,
        db.receipts,
        db.applicationSettings,
        db.users,
        db.auditEvents,
        db.syncOperations,
      ],
      async () => {
        const tenancy = await db.tenancies.get(input.tenancyId);
        if (!tenancy) throw new Error('Tenancy not found');

        const tokenKey = input.idempotencyToken?.trim();
        if (tokenKey) {
          const existingByToken = await db.payments.where('idempotencyKey').equals(tokenKey).first();
          if (existingByToken && existingByToken.verificationStatus !== 'reversed') {
            throw new Error(
              `Duplicate payment submission prevented: this submission token was already recorded (Payment ${existingByToken.id}).`
            );
          }
        }

        // Check for existing non-reversed same-day/same-method/same-amount/same-reference payment
        const tenancyPayments = await db.payments.where('tenancyId').equals(tenancy.id).toArray();
        const sameDayMatch = tenancyPayments.find(
          (p) =>
            !p.isDeleted &&
            p.verificationStatus !== 'reversed' &&
            p.transactionDate === transactionDate &&
            p.method === input.method &&
            p.amountCents === roundedCents &&
            (p.externalReference?.trim() || '') === normalizedRef
        );

        if (sameDayMatch) {
          if (!input.confirmDistinctDuplicate) {
            throw new DuplicatePaymentConfirmationError(sameDayMatch.id, roundedCents, transactionDate);
          }
        }

        const idempotencyKey =
          tokenKey ||
          (input.confirmDistinctDuplicate && sameDayMatch
            ? `${sameDayFingerprint}-distinct-${generateUUID().slice(0, 8)}`
            : sameDayFingerprint);

        const existingByKey = await db.payments.where('idempotencyKey').equals(idempotencyKey).first();
        if (existingByKey && existingByKey.verificationStatus !== 'reversed') {
          throw new Error(
            `Duplicate payment submission prevented: A payment of R${(roundedCents / 100).toFixed(2)} on ${transactionDate} is already recorded.`
          );
        }

        const settings = await db.applicationSettings.get('settings-default');
        const activeUser = await db.users.get(settings?.activeUserId || OWNER_USER_ID);
        const property = await db.properties.get(tenancy.propertyId);
        const unit = await db.units.get(tenancy.unitId);
        const tenant = await db.tenantProfiles.get(tenancy.primaryTenantId);
        const ownerEntity = property ? await db.ownerEntities.get(property.ownerEntityId) : undefined;

        // Fetch open charges for this tenancy ordered by dueDate ascending (FIFO allocation)
        const charges = (await db.charges.where('tenancyId').equals(tenancy.id).toArray())
          .filter((c) => !c.isDeleted && c.status !== 'reversed' && c.status !== 'paid' && c.status !== 'waived')
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

        let remainingToAllocate = roundedCents;
        const paymentId = `pay-${generateUUID().slice(0, 8)}`;

        for (const charge of charges) {
          if (remainingToAllocate <= 0) break;
          const chargeNetDue = Math.max(0, charge.amountCents + charge.adjustedCents - charge.allocatedPaidCents);
          if (chargeNetDue <= 0) continue;

          const allocCents = Math.min(remainingToAllocate, chargeNetDue);
          const newAllocated = charge.allocatedPaidCents + allocCents;
          const isNowPaid = newAllocated >= charge.amountCents + charge.adjustedCents;

          await db.charges.update(charge.id, {
            allocatedPaidCents: newAllocated,
            status: isNowPaid ? 'paid' : 'partially_paid',
            updatedAt: now,
            revision: charge.revision + 1,
          });

          await db.paymentAllocations.add({
            id: `alloc-${generateUUID().slice(0, 8)}`,
            organizationId: ORG_ID,
            createdAt: now,
            updatedAt: now,
            revision: 1,
            paymentId,
            chargeId: charge.id,
            tenancyId: tenancy.id,
            amountCents: allocCents,
            allocatedAt: now,
          });

          remainingToAllocate -= allocCents;
        }

        const payment: Payment = {
          id: paymentId,
          organizationId: ORG_ID,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          tenancyId: tenancy.id,
          propertyId: tenancy.propertyId,
          unitId: tenancy.unitId,
          tenantId: tenancy.primaryTenantId,
          idempotencyKey,
          amountCents: roundedCents,
          unallocatedCents: remainingToAllocate, // Any excess becomes advance credit on ledger
          transactionDate,
          effectiveDate: transactionDate,
          method: input.method,
          externalReference: normalizedRef || undefined,
          verificationStatus: input.verificationStatus,
          recordedByUserId: activeUser?.id || OWNER_USER_ID,
          recordedByName: activeUser?.fullName || 'Local Operator',
          notes: input.notes?.trim() || undefined,
        };

        await db.payments.add(payment);

        // Compute exact updated ledger balance after this payment
        const [allCharges, allPayments, allAdjustments, allDeposits] = await Promise.all([
          db.charges.where('tenancyId').equals(tenancy.id).toArray(),
          db.payments.where('tenancyId').equals(tenancy.id).toArray(),
          db.ledgerAdjustments.where('tenancyId').equals(tenancy.id).toArray(),
          db.depositLiabilities.where('tenancyId').equals(tenancy.id).toArray(),
        ]);

        const summary = computeTenancyLedgerSummary(tenancy.id, allCharges, allPayments, allAdjustments, allDeposits);
        const receiptPrefix = `RCP-${transactionDate.slice(0, 7).replace('-', '')}`;
        const receiptNumber = await nextUniqueReceiptNumber(receiptPrefix);

        const receipt: Receipt = {
          id: `rcp-${generateUUID().slice(0, 8)}`,
          organizationId: ORG_ID,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          receiptNumber,
          paymentId: payment.id,
          tenancyId: tenancy.id,
          propertyId: tenancy.propertyId,
          unitId: tenancy.unitId,
          tenantId: tenancy.primaryTenantId,
          landlordName: ownerEntity?.name || 'Landlord',
          tenantName: tenant?.fullName || 'Tenant',
          propertyUnitLabel: `${property?.name || 'Property'} — ${unit?.unitNumber || ''} (${unit?.name || ''})`,
          amountCents: roundedCents,
          paymentMethod: input.method,
          paymentVerificationStatus: input.verificationStatus,
          transactionDate,
          issuedAt: now,
          balanceAfterPaymentCents: summary.netBalanceDueCents,
          isCorrectionOrReversal: false,
        };

        await db.receipts.add(receipt);

        await logAuditAndSync({
          entityTable: 'payments',
          entityType: 'Payment',
          entityId: payment.id,
          action: 'RECORD_PAYMENT',
          operation: 'insert',
          summary: `Recorded R${(roundedCents / 100).toFixed(2)} (${input.method}) for ${tenant?.fullName || 'Tenant'} and issued receipt ${receiptNumber}.`,
          payload: { payment, receipt },
          isFinancialEvent: true,
        });

        if (input.onBeforeCommitForTest) {
          input.onBeforeCommitForTest();
        }

        return { payment, receipt };
      }
    );
  } finally {
    inFlightPaymentKeys.delete(inFlightLockKey);
  }
}

/**
 * Reverses a payment entry atomically without deleting historical records (A01).
 * Restores charge balances, marks the payment as reversed, logs a LedgerAdjustment, and issues a reversal receipt record.
 */
export async function reversePaymentTransaction(
  paymentId: string,
  reason: string,
  options?: { onBeforeCommitForTest?: () => void }
): Promise<Receipt> {
  const cleanReason = reason?.trim() || '';
  if (cleanReason.length < 3) {
    throw new Error('A clear reversal reason (at least 3 characters) is required for the audit trail.');
  }
  const now = new Date().toISOString();

  return await db.transaction(
    'rw',
    [
      db.payments,
      db.paymentAllocations,
      db.charges,
      db.ledgerAdjustments,
      db.depositLiabilities,
      db.receipts,
      db.applicationSettings,
      db.users,
      db.auditEvents,
      db.syncOperations,
    ],
    async () => {
      const payment = await db.payments.get(paymentId);
      if (!payment) throw new Error('Payment not found');
      if (payment.verificationStatus === 'reversed') {
        throw new Error('This payment has already been reversed');
      }

      const allocations = await db.paymentAllocations.where('paymentId').equals(payment.id).toArray();
      for (const alloc of allocations) {
        const charge = await db.charges.get(alloc.chargeId);
        if (charge) {
          const updatedPaid = Math.max(0, charge.allocatedPaidCents - alloc.amountCents);
          const netTotal = charge.amountCents + charge.adjustedCents;
          const newStatus =
            updatedPaid >= netTotal
              ? 'paid'
              : updatedPaid > 0
                ? 'partially_paid'
                : charge.dueDate < todayIso()
                  ? 'overdue'
                  : 'due';
          await db.charges.update(charge.id, {
            allocatedPaidCents: updatedPaid,
            status: newStatus,
            updatedAt: now,
            revision: charge.revision + 1,
          });
        }
      }

      await db.payments.update(payment.id, {
        verificationStatus: 'reversed',
        unallocatedCents: 0,
        updatedAt: now,
        revision: payment.revision + 1,
        notes: `${payment.notes ? payment.notes + ' | ' : ''}REVERSED: ${cleanReason}`,
      });

      const settings = await db.applicationSettings.get('settings-default');
      const activeUser = await db.users.get(settings?.activeUserId || OWNER_USER_ID);

      await db.ledgerAdjustments.add({
        id: `adj-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        tenancyId: payment.tenancyId,
        paymentId: payment.id,
        adjustmentType: 'reversal',
        amountCents: payment.amountCents,
        reason: cleanReason,
        effectiveDate: now.slice(0, 10),
        recordedByUserId: activeUser?.id || OWNER_USER_ID,
        recordedByName: activeUser?.fullName || 'Local Operator',
      });

      const [allCharges, allPayments, allAdjustments, allDeposits] = await Promise.all([
        db.charges.where('tenancyId').equals(payment.tenancyId).toArray(),
        db.payments.where('tenancyId').equals(payment.tenancyId).toArray(),
        db.ledgerAdjustments.where('tenancyId').equals(payment.tenancyId).toArray(),
        db.depositLiabilities.where('tenancyId').equals(payment.tenancyId).toArray(),
      ]);
      const summary = computeTenancyLedgerSummary(
        payment.tenancyId,
        allCharges,
        allPayments,
        allAdjustments,
        allDeposits
      );

      const originalReceipt = await db.receipts.where('paymentId').equals(payment.id).first();
      const reversalReceiptNumber = await nextUniqueReceiptNumber('REV');
      const reversalReceipt: Receipt = {
        id: `rcp-rev-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        receiptNumber: reversalReceiptNumber,
        paymentId: payment.id,
        tenancyId: payment.tenancyId,
        propertyId: payment.propertyId,
        unitId: payment.unitId,
        tenantId: payment.tenantId,
        landlordName: originalReceipt?.landlordName || 'Landlord',
        tenantName: originalReceipt?.tenantName || 'Tenant',
        propertyUnitLabel: originalReceipt?.propertyUnitLabel || 'Unit',
        amountCents: -payment.amountCents,
        paymentMethod: payment.method,
        paymentVerificationStatus: 'reversed',
        transactionDate: now.slice(0, 10),
        issuedAt: now,
        balanceAfterPaymentCents: summary.netBalanceDueCents,
        isCorrectionOrReversal: true,
        correctionNote: `Reversal of receipt ${originalReceipt?.receiptNumber || payment.id}: ${cleanReason}`,
      };

      await db.receipts.add(reversalReceipt);

      await logAuditAndSync({
        entityTable: 'payments',
        entityType: 'PaymentReversal',
        entityId: payment.id,
        action: 'REVERSE_PAYMENT',
        operation: 'update',
        summary: `Reversed payment ${payment.id} (R${(payment.amountCents / 100).toFixed(2)}). Reason: ${cleanReason}`,
        payload: reversalReceipt,
        isFinancialEvent: true,
      });

      if (options?.onBeforeCommitForTest) {
        options.onBeforeCommitForTest();
      }

      return reversalReceipt;
    }
  );
}

/**
 * Applies a credit waiver or debit correction atomically to a specific charge and recalculates charge status (A01).
 */
export async function applyChargeAdjustment(input: {
  chargeId: string;
  adjustmentType: 'waiver' | 'debit_correction';
  amountCents: number;
  reason: string;
  onBeforeCommitForTest?: () => void;
}) {
  const validAmount = assertValidPositiveCents(input.amountCents, 'Adjustment amount');
  const cleanReason = input.reason?.trim() || '';
  if (cleanReason.length < 3) {
    throw new Error('Adjustment reason is required.');
  }
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [db.charges, db.ledgerAdjustments, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const charge = await db.charges.get(input.chargeId);
      if (!charge) throw new Error('Charge not found');

      const signedDelta = input.adjustmentType === 'waiver' ? -validAmount : validAmount;
      const newAdjusted = charge.adjustedCents + signedDelta;
      const effectiveRequired = Math.max(0, charge.amountCents + newAdjusted);

      const newStatus =
        effectiveRequired === 0
          ? 'waived'
          : charge.allocatedPaidCents >= effectiveRequired
            ? 'paid'
            : charge.allocatedPaidCents > 0
              ? 'partially_paid'
              : charge.dueDate < todayIso()
                ? 'overdue'
                : 'adjusted';

      await db.charges.update(charge.id, {
        adjustedCents: newAdjusted,
        status: newStatus,
        updatedAt: now,
        revision: charge.revision + 1,
      });

      const settings = await db.applicationSettings.get('settings-default');
      const activeUser = await db.users.get(settings?.activeUserId || OWNER_USER_ID);

      await db.ledgerAdjustments.add({
        id: `adj-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        tenancyId: charge.tenancyId,
        chargeId: charge.id,
        adjustmentType: input.adjustmentType,
        amountCents: validAmount,
        reason: cleanReason,
        effectiveDate: now.slice(0, 10),
        recordedByUserId: activeUser?.id || OWNER_USER_ID,
        recordedByName: activeUser?.fullName || 'Local Operator',
      });

      await logAuditAndSync({
        entityTable: 'ledgerAdjustments',
        entityType: 'LedgerAdjustment',
        entityId: charge.id,
        action: 'ADJUST_CHARGE',
        operation: 'update',
        summary: `Applied ${input.adjustmentType} of R${(validAmount / 100).toFixed(2)} on charge "${charge.description}". Reason: ${cleanReason}`,
        payload: { chargeId: charge.id, signedDelta, reason: cleanReason },
        isFinancialEvent: true,
      });

      if (input.onBeforeCommitForTest) {
        input.onBeforeCommitForTest();
      }
    }
  );
}

/**
 * Atomically records a deposit receipt, lawful deduction, or refund on a DepositLiability (F11).
 * Deposits remain strictly separate from rental income.
 */
export async function recordDepositMovement(input: {
  depositId: string;
  movementType: 'receive' | 'deduction' | 'refund';
  amountCents: number;
  reason: string;
}): Promise<DepositLiability> {
  const validAmount = assertValidPositiveCents(input.amountCents, 'Deposit movement amount');
  const cleanReason = input.reason?.trim() || '';
  if (cleanReason.length < 3) {
    throw new Error('A traceable reason is required for deposit movements.');
  }
  const now = new Date().toISOString();

  return await db.transaction(
    'rw',
    [db.depositLiabilities, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const dep = await db.depositLiabilities.get(input.depositId);
      if (!dep) throw new Error('Deposit liability record not found.');

      const currentHeld = Math.max(
        0,
        dep.receivedDepositCents + dep.accruedInterestCents - dep.deductionsCents - dep.refundedCents
      );

      let nextReceived = dep.receivedDepositCents;
      let nextDeductions = dep.deductionsCents;
      let nextRefunded = dep.refundedCents;

      if (input.movementType === 'receive') {
        nextReceived += validAmount;
      } else if (input.movementType === 'deduction') {
        if (validAmount > currentHeld) {
          throw new Error(
            `Deduction exceeds held deposit liability (R${(currentHeld / 100).toFixed(2)} available).`
          );
        }
        nextDeductions += validAmount;
      } else if (input.movementType === 'refund') {
        if (validAmount > currentHeld) {
          throw new Error(
            `Refund exceeds held deposit liability (R${(currentHeld / 100).toFixed(2)} available).`
          );
        }
        nextRefunded += validAmount;
      }

      const nextHeld = Math.max(0, nextReceived + dep.accruedInterestCents - nextDeductions - nextRefunded);
      let nextStatus: DepositLiability['status'] = dep.status;
      if (nextHeld === 0 && (nextRefunded > 0 || nextDeductions > 0)) {
        nextStatus = 'refunded';
      } else if (nextRefunded > 0 || nextDeductions > 0) {
        nextStatus = 'partially_refunded';
      } else if (nextReceived >= dep.agreedDepositCents && nextReceived > 0) {
        nextStatus = 'held_as_liability';
      } else if (nextReceived > 0) {
        nextStatus = 'partially_held';
      } else {
        nextStatus = 'pending';
      }

      const updated: DepositLiability = {
        ...dep,
        receivedDepositCents: nextReceived,
        deductionsCents: nextDeductions,
        refundedCents: nextRefunded,
        status: nextStatus,
        heldInAccountNote: `${dep.heldInAccountNote.split(' | ')[0]} | Last ${input.movementType}: R${(validAmount / 100).toFixed(2)} (${cleanReason})`,
        updatedAt: now,
        revision: dep.revision + 1,
      };

      await db.depositLiabilities.put(updated);

      await logAuditAndSync({
        entityTable: 'depositLiabilities',
        entityType: 'DepositLiability',
        entityId: dep.id,
        action: `DEPOSIT_${input.movementType.toUpperCase()}`,
        operation: 'update',
        summary: `Deposit ${input.movementType} of R${(validAmount / 100).toFixed(2)} recorded. Reason: ${cleanReason}`,
        payload: { depositId: dep.id, movementType: input.movementType, amountCents: validAmount, reason: cleanReason },
        isFinancialEvent: true,
      });

      return updated;
    }
  );
}

export async function createMaintenanceTicketRecord(input: {
  propertyId: string;
  unitId?: string;
  tenancyId?: string;
  tenantId?: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  reportedByRole: 'landlord' | 'manager' | 'tenant';
  reporterName: string;
  assignedContractorName?: string;
  assignedContractorPhone?: string;
  estimatedCostCents: number;
  photoDataUrl?: string;
}) {
  if (!input.title.trim()) throw new Error('Maintenance issue title is required.');
  const estimatedCents = assertValidNonNegativeCents(Math.round(input.estimatedCostCents || 0), 'Estimated cost');
  const now = new Date().toISOString();

  return await db.transaction(
    'rw',
    [db.maintenanceTickets, db.maintenanceEvents, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      const ticketId = `mnt-${generateUUID().slice(0, 8)}`;
      const ticketNumber = await nextUniqueTicketNumber();

      const ticket = {
        id: ticketId,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        ticketNumber,
        propertyId: input.propertyId,
        unitId: input.unitId || undefined,
        tenancyId: input.tenancyId || undefined,
        tenantId: input.tenantId || undefined,
        title: input.title.trim(),
        description: input.description.trim(),
        category: input.category,
        priority: input.priority,
        status: 'reported' as MaintenanceStatus,
        reportedDate: now.slice(0, 10),
        reportedByRole: input.reportedByRole,
        reporterName: input.reporterName.trim() || 'Local Operator',
        assignedContractorName: input.assignedContractorName?.trim() || undefined,
        assignedContractorPhone: input.assignedContractorPhone?.trim() || undefined,
        estimatedCostCents: estimatedCents,
        actualCostCents: 0,
        photoUrls: input.photoDataUrl ? [input.photoDataUrl] : [],
      };

      await db.maintenanceTickets.add(ticket);
      await db.maintenanceEvents.add({
        id: `mev-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        ticketId,
        statusTo: 'reported',
        note: `Ticket opened by ${ticket.reporterName} (${ticket.reportedByRole}).`,
        actorName: ticket.reporterName,
        eventTimestamp: now,
      });

      await logAuditAndSync({
        entityTable: 'maintenanceTickets',
        entityType: 'MaintenanceTicket',
        entityId: ticketId,
        action: 'CREATE_MAINTENANCE_TICKET',
        operation: 'insert',
        summary: `Created maintenance ticket ${ticketNumber}: "${ticket.title}".`,
        payload: ticket,
        isFinancialEvent: false,
      });

      return ticket;
    }
  );
}

export async function updateMaintenanceTicketStatus(input: {
  ticketId: string;
  newStatus: MaintenanceStatus;
  note: string;
  assignedContractorName?: string;
  actualCostCents?: number;
  completionNotes?: string;
  recordAsExpense?: boolean;
}) {
  if (input.actualCostCents !== undefined) {
    assertValidNonNegativeCents(Math.round(input.actualCostCents), 'Actual repair cost');
  }
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [
      db.maintenanceTickets,
      db.maintenanceEvents,
      db.expenses,
      db.applicationSettings,
      db.users,
      db.auditEvents,
      db.syncOperations,
    ],
    async () => {
      const ticket = await db.maintenanceTickets.get(input.ticketId);
      if (!ticket) throw new Error('Maintenance ticket not found');

      const settings = await db.applicationSettings.get('settings-default');
      const activeUser = await db.users.get(settings?.activeUserId || OWNER_USER_ID);
      const actorName = activeUser?.fullName || 'Local Operator';

      const actualCostCents =
        input.actualCostCents !== undefined ? Math.round(input.actualCostCents) : ticket.actualCostCents;

      await db.maintenanceTickets.update(ticket.id, {
        status: input.newStatus,
        assignedContractorName: input.assignedContractorName?.trim() || ticket.assignedContractorName,
        actualCostCents,
        completionNotes: input.completionNotes?.trim() || ticket.completionNotes,
        resolvedAt: input.newStatus === 'resolved' || input.newStatus === 'closed' ? now : ticket.resolvedAt,
        updatedAt: now,
        revision: ticket.revision + 1,
      });

      await db.maintenanceEvents.add({
        id: `mev-${generateUUID().slice(0, 8)}`,
        organizationId: ORG_ID,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        ticketId: ticket.id,
        statusFrom: ticket.status,
        statusTo: input.newStatus,
        note: input.note.trim() || `Status updated to ${input.newStatus}`,
        actorName,
        eventTimestamp: now,
      });

      if (input.recordAsExpense && actualCostCents > 0) {
        await recordExpenseEntry({
          propertyId: ticket.propertyId,
          unitId: ticket.unitId,
          maintenanceTicketId: ticket.id,
          category: 'repairs_maintenance',
          description: `Maintenance ${ticket.ticketNumber}: ${ticket.title}`,
          vendorName: input.assignedContractorName || ticket.assignedContractorName || 'Maintenance Contractor',
          amountCents: actualCostCents,
          incurredDate: now.slice(0, 10),
          paidStatus: 'paid',
          paymentMethod: 'eft',
        });
      }
    }
  );
}

export async function recordExpenseEntry(input: {
  propertyId: string;
  unitId?: string;
  maintenanceTicketId?: string;
  category: Expense['category'];
  description: string;
  vendorName?: string;
  amountCents: number;
  incurredDate: string;
  paidStatus: 'paid' | 'unpaid_invoice';
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
}) {
  if (!input.description.trim()) throw new Error('Expense description is required.');
  const amountCents = assertValidPositiveCents(Math.round(input.amountCents), 'Expense amount');
  const incurredDate = assertValidISODate(input.incurredDate, 'Expense date');
  const now = new Date().toISOString();

  const expense: Expense = {
    id: `exp-${generateUUID().slice(0, 8)}`,
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    propertyId: input.propertyId,
    unitId: input.unitId || undefined,
    maintenanceTicketId: input.maintenanceTicketId || undefined,
    category: input.category,
    description: input.description.trim(),
    vendorName: input.vendorName?.trim() || undefined,
    amountCents,
    incurredDate,
    paidStatus: input.paidStatus,
    paymentMethod: input.paymentMethod,
    referenceNumber: input.referenceNumber?.trim() || undefined,
    recordedByUserId: OWNER_USER_ID,
  };

  await db.transaction(
    'rw',
    [db.expenses, db.applicationSettings, db.users, db.auditEvents, db.syncOperations],
    async () => {
      await db.expenses.add(expense);
      await logAuditAndSync({
        entityTable: 'expenses',
        entityType: 'Expense',
        entityId: expense.id,
        action: 'RECORD_EXPENSE',
        operation: 'insert',
        summary: `Recorded expense "${expense.description}" of R${(expense.amountCents / 100).toFixed(2)}.`,
        payload: expense,
        isFinancialEvent: true,
      });
    }
  );

  return expense;
}

export async function logCommunicationEntry(input: {
  tenantId: string;
  tenancyId?: string;
  propertyId?: string;
  channel: CommunicationChannel;
  templateType:
    | 'rent_reminder'
    | 'payment_acknowledgement'
    | 'arrears_follow_up'
    | 'maintenance_update'
    | 'renewal_notice'
    | 'in_person_record'
    | 'general_message';
  subject: string;
  body: string;
  recipientContact: string;
  deliveryStatus: MessageDeliveryStatus;
  statusEvidenceNote: string;
}) {
  const now = new Date().toISOString();
  const settings = await db.applicationSettings.get('settings-default');
  const activeUser = await db.users.get(settings?.activeUserId || OWNER_USER_ID);

  const entry = {
    id: `msg-${generateUUID().slice(0, 8)}`,
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    tenantId: input.tenantId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    channel: input.channel,
    templateType: input.templateType,
    subject: input.subject.trim(),
    body: input.body.trim(),
    recipientContact: input.recipientContact.trim(),
    deliveryStatus: input.deliveryStatus,
    statusEvidenceNote: input.statusEvidenceNote,
    recordedByName: activeUser?.fullName || 'Local Operator',
    sentOrLoggedAt: now,
  };

  await db.messageLogs.add(entry);
  return entry;
}

export async function addDocumentRecord(input: {
  title: string;
  category: DocumentCategory;
  propertyId?: string;
  unitId?: string;
  tenancyId?: string;
  tenantId?: string;
  accessScope: 'owner_only' | 'owner_and_manager' | 'shared_with_tenant';
  mimeType: string;
  fileSizeBytes: number;
  localDataUrl?: string;
  retentionExpiresAt?: string;
  notes?: string;
}) {
  if (!input.title.trim()) throw new Error('Document title is required.');
  const now = new Date().toISOString();
  const doc = {
    id: `doc-${generateUUID().slice(0, 8)}`,
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    title: input.title.trim(),
    category: input.category,
    propertyId: input.propertyId || undefined,
    unitId: input.unitId || undefined,
    tenancyId: input.tenancyId || undefined,
    tenantId: input.tenantId || undefined,
    ownerName: 'Sipho Khumalo',
    accessScope: input.accessScope,
    storageMode: 'local_indexeddb_blob' as const,
    mimeType: input.mimeType,
    fileSizeBytes: Math.max(0, Math.round(input.fileSizeBytes)),
    localDataUrl: input.localDataUrl,
    retentionExpiresAt: input.retentionExpiresAt || '2031-12-31',
    notes: input.notes?.trim() || undefined,
  };
  await db.documents.add(doc);
  return doc;
}

export async function resolveFinancialSyncConflict(
  syncOpId: string,
  resolution: 'accept_proposed_adjustment' | 'keep_authoritative_ledger'
) {
  const now = new Date().toISOString();
  await db.transaction(
    'rw',
    [db.syncOperations, db.charges, db.ledgerAdjustments, db.applicationSettings, db.users, db.auditEvents],
    async () => {
      const op = await db.syncOperations.get(syncOpId);
      if (!op || op.syncStatus === 'reconciled_local') return;

      if (resolution === 'accept_proposed_adjustment' && op.entityId === 'chg-kabelo-nov-util') {
        const targetCharge = await db.charges.get('chg-kabelo-nov-util');
        if (targetCharge) {
          await applyChargeAdjustment({
            chargeId: 'chg-kabelo-nov-util',
            adjustmentType: 'waiver',
            amountCents: 5000,
            reason: 'Reconciled offline caretaker adjustment proposal (R50.00 water waiver).',
          });
        }
      }

      await db.syncOperations.update(syncOpId, {
        syncStatus: 'reconciled_local',
        updatedAt: now,
        conflictReason: `Explicitly reconciled by Owner (${resolution === 'accept_proposed_adjustment' ? 'Applied R50.00 waiver' : 'Retained R200.00 authoritative charge'}).`,
      });
    }
  );
}

/**
 * Atomically clears all operational/sample records to produce a clean, empty local workspace (A04).
 * Preserves user theme, role, subscription tier selection, and core organization scaffolding so
 * creating new records immediately works without re-seeding demo data on reload.
 */
export async function clearSampleDataToEmptyWorkspace() {
  const now = new Date().toISOString();
  await db.transaction(
    'rw',
    [
      db.properties,
      db.units,
      db.people,
      db.tenantProfiles,
      db.identityEvidences,
      db.tenancies,
      db.tenancyParticipants,
      db.leaseVersions,
      db.charges,
      db.payments,
      db.paymentAllocations,
      db.ledgerAdjustments,
      db.receipts,
      db.depositLiabilities,
      db.expenses,
      db.maintenanceTickets,
      db.maintenanceEvents,
      db.documents,
      db.communicationPreferences,
      db.messageLogs,
      db.consentRecords,
      db.auditEvents,
      db.syncOperations,
      db.applicationSettings,
    ],
    async () => {
      await Promise.all([
        db.properties.clear(),
        db.units.clear(),
        db.people.clear(),
        db.tenantProfiles.clear(),
        db.identityEvidences.clear(),
        db.tenancies.clear(),
        db.tenancyParticipants.clear(),
        db.leaseVersions.clear(),
        db.charges.clear(),
        db.payments.clear(),
        db.paymentAllocations.clear(),
        db.ledgerAdjustments.clear(),
        db.receipts.clear(),
        db.depositLiabilities.clear(),
        db.expenses.clear(),
        db.maintenanceTickets.clear(),
        db.maintenanceEvents.clear(),
        db.documents.clear(),
        db.communicationPreferences.clear(),
        db.messageLogs.clear(),
        db.consentRecords.clear(),
        db.auditEvents.clear(),
        db.syncOperations.clear(),
      ]);

      const existing = await db.applicationSettings.get('settings-default');
      if (existing) {
        await db.applicationSettings.update('settings-default', {
          isSampleDataLoaded: false,
          workspaceMode: 'clean',
          activeTenantIdForPortal: undefined,
          updatedAt: now,
          revision: existing.revision + 1,
        });
      } else {
        await db.applicationSettings.put({
          id: 'settings-default',
          organizationId: ORG_ID,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          activeRole: 'owner',
          activeUserId: OWNER_USER_ID,
          assignedPropertyIdsForManager: [],
          isSampleDataLoaded: false,
          workspaceMode: 'clean',
          selectedPlanTier: 'pro',
          simulatedBillingStatus: 'active_demo',
          theme: 'dark',
          supabaseConnected: false,
          smsProviderConfigured: false,
          onboardingCompleted: true,
        });
      }
    }
  );
}

export async function reloadFictionalSampleData() {
  await seedSampleData(true);
}

/**
 * Persists the simulated subscription plan choice locally in Dexie (and localStorage fallback) (A06).
 * Explicitly local-only simulation — no real billing or external payment processor is connected.
 */
export async function updateSimulatedSubscriptionPlan(
  planTier: NonNullable<ApplicationSettings['selectedPlanTier']>,
  billingStatus: NonNullable<ApplicationSettings['simulatedBillingStatus']> = 'active_demo'
): Promise<void> {
  const now = new Date().toISOString();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('akarai_simulated_plan_tier', planTier);
      localStorage.setItem('akarai_simulated_billing_status', billingStatus);
    }
  } catch {
    // ignore storage quota errors
  }

  const existing = await db.applicationSettings.get('settings-default');
  if (existing) {
    await db.applicationSettings.update('settings-default', {
      selectedPlanTier: planTier,
      simulatedBillingStatus: billingStatus,
      updatedAt: now,
      revision: existing.revision + 1,
    });
  }
}

export async function updateApplicationPreferences(updates: {
  portfolioDisplayName?: string;
  setupChecklistDismissed?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.applicationSettings.get('settings-default');
  if (existing) {
    await db.applicationSettings.update('settings-default', {
      ...updates,
      updatedAt: now,
      revision: existing.revision + 1,
    });
  }
}
