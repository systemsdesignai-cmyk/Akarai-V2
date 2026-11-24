import { db } from '../db/database';
import { formatZAR } from '../utils/format';

export const SUPPORTED_BACKUP_SCHEMA_VERSION = '0.1.0' as const;

export interface BackupEnvelope {
  schemaName: 'LandlordOS_MVP_Backup' | 'Akarai_Backup';
  schemaVersion: '0.1.0';
  exportedAt: string;
  currency: 'ZAR';
  counts: {
    properties: number;
    units: number;
    tenantProfiles: number;
    tenancies: number;
    charges: number;
    payments: number;
    receipts: number;
    expenses: number;
    maintenanceTickets: number;
  };
  tables: Record<string, unknown[]>;
}

const REQUIRED_BACKUP_TABLES = [
  'organizations',
  'users',
  'ownerEntities',
  'portfolios',
  'properties',
  'units',
  'tenantProfiles',
  'tenancies',
  'charges',
  'payments',
  'paymentAllocations',
  'receipts',
  'applicationSettings',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value);
}

function triggerBrowserDownload(filename: string, content: string, mimeType: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportEntityCSV(
  type: 'payments' | 'tenants' | 'units' | 'charges' | 'expenses'
): Promise<{ exportedCount: number; filename?: string }> {
  const dateStamp = new Date().toISOString().slice(0, 10);

  if (type === 'payments') {
    const payments = await db.payments.toArray();
    if (payments.length === 0) return { exportedCount: 0 };
    const headers = [
      'Payment ID',
      'Tenancy ID',
      'Tenant ID',
      'Transaction Date',
      'Amount (ZAR)',
      'Amount (Cents)',
      'Method',
      'Verification Status',
      'External Reference',
      'Recorded By',
    ];
    const rows = payments.map((p) => [
      p.id,
      p.tenancyId,
      p.tenantId,
      p.transactionDate,
      formatZAR(p.amountCents),
      p.amountCents,
      p.method,
      p.verificationStatus,
      p.externalReference || '',
      p.recordedByName,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
    const filename = `Akarai_Payments_${dateStamp}.csv`;
    triggerBrowserDownload(filename, csv, 'text/csv;charset=utf-8;');
    return { exportedCount: payments.length, filename };
  }

  if (type === 'tenants') {
    const tenants = await db.tenantProfiles.toArray();
    if (tenants.length === 0) return { exportedCount: 0 };
    const headers = [
      'Tenant Code',
      'Full Name',
      'Provisional Identifier',
      'Primary Phone',
      'Alternative Phone',
      'Documentation Type',
      'Documentation Status',
      'Has Smartphone',
      'Has Bank Account',
      'Preferred Channel',
    ];
    const rows = tenants.map((t) => [
      t.tenantCode,
      t.fullName,
      t.provisionalIdentifier || '',
      t.primaryPhone || 'None',
      t.alternativePhone || '',
      t.documentationType,
      t.documentationStatus,
      t.hasSmartphone ? 'Yes' : 'No',
      t.hasBankAccount ? 'Yes' : 'No',
      t.preferredChannel,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
    const filename = `Akarai_Tenants_${dateStamp}.csv`;
    triggerBrowserDownload(filename, csv, 'text/csv;charset=utf-8;');
    return { exportedCount: tenants.length, filename };
  }

  if (type === 'units') {
    const units = await db.units.toArray();
    if (units.length === 0) return { exportedCount: 0 };
    const headers = ['Unit ID', 'Property ID', 'Unit Number', 'Name', 'Type', 'Status', 'Standard Rent (ZAR)', 'Rent Cents'];
    const rows = units.map((u) => [
      u.id,
      u.propertyId,
      u.unitNumber,
      u.name,
      u.unitType,
      u.status,
      formatZAR(u.standardRentCents),
      u.standardRentCents,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
    const filename = `Akarai_Units_${dateStamp}.csv`;
    triggerBrowserDownload(filename, csv, 'text/csv;charset=utf-8;');
    return { exportedCount: units.length, filename };
  }

  if (type === 'charges') {
    const charges = await db.charges.toArray();
    if (charges.length === 0) return { exportedCount: 0 };
    const headers = [
      'Charge ID',
      'Tenancy ID',
      'Period Key',
      'Type',
      'Description',
      'Charged (ZAR)',
      'Allocated Paid (ZAR)',
      'Adjusted (ZAR)',
      'Due Date',
      'Status',
    ];
    const rows = charges.map((c) => [
      c.id,
      c.tenancyId,
      c.periodKey,
      c.chargeType,
      c.description,
      formatZAR(c.amountCents),
      formatZAR(c.allocatedPaidCents),
      formatZAR(c.adjustedCents),
      c.dueDate,
      c.status,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
    const filename = `Akarai_Charges_${dateStamp}.csv`;
    triggerBrowserDownload(filename, csv, 'text/csv;charset=utf-8;');
    return { exportedCount: charges.length, filename };
  }

  const expenses = await db.expenses.toArray();
  if (expenses.length === 0) return { exportedCount: 0 };
  const headers = ['Expense ID', 'Property ID', 'Category', 'Description', 'Vendor', 'Amount (ZAR)', 'Date', 'Status'];
  const rows = expenses.map((e) => [
    e.id,
    e.propertyId,
    e.category,
    e.description,
    e.vendorName || '',
    formatZAR(e.amountCents),
    e.incurredDate,
    e.paidStatus,
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
  const filename = `Akarai_Expenses_${dateStamp}.csv`;
  triggerBrowserDownload(filename, csv, 'text/csv;charset=utf-8;');
  return { exportedCount: expenses.length, filename };
}

export async function buildFullBackupEnvelope(): Promise<BackupEnvelope> {
  const now = new Date().toISOString();
  const [
    organizations,
    users,
    memberships,
    ownerEntities,
    portfolios,
    properties,
    units,
    people,
    tenantProfiles,
    identityEvidences,
    tenancies,
    tenancyParticipants,
    leaseVersions,
    charges,
    payments,
    paymentAllocations,
    ledgerAdjustments,
    receipts,
    depositLiabilities,
    expenses,
    maintenanceTickets,
    maintenanceEvents,
    documents,
    communicationPreferences,
    messageLogs,
    consentRecords,
    auditEvents,
    syncOperations,
    applicationSettings,
  ] = await Promise.all([
    db.organizations.toArray(),
    db.users.toArray(),
    db.memberships.toArray(),
    db.ownerEntities.toArray(),
    db.portfolios.toArray(),
    db.properties.toArray(),
    db.units.toArray(),
    db.people.toArray(),
    db.tenantProfiles.toArray(),
    db.identityEvidences.toArray(),
    db.tenancies.toArray(),
    db.tenancyParticipants.toArray(),
    db.leaseVersions.toArray(),
    db.charges.toArray(),
    db.payments.toArray(),
    db.paymentAllocations.toArray(),
    db.ledgerAdjustments.toArray(),
    db.receipts.toArray(),
    db.depositLiabilities.toArray(),
    db.expenses.toArray(),
    db.maintenanceTickets.toArray(),
    db.maintenanceEvents.toArray(),
    db.documents.toArray(),
    db.communicationPreferences.toArray(),
    db.messageLogs.toArray(),
    db.consentRecords.toArray(),
    db.auditEvents.toArray(),
    db.syncOperations.toArray(),
    db.applicationSettings.toArray(),
  ]);

  return {
    schemaName: 'LandlordOS_MVP_Backup',
    schemaVersion: SUPPORTED_BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    currency: 'ZAR',
    counts: {
      properties: properties.length,
      units: units.length,
      tenantProfiles: tenantProfiles.length,
      tenancies: tenancies.length,
      charges: charges.length,
      payments: payments.length,
      receipts: receipts.length,
      expenses: expenses.length,
      maintenanceTickets: maintenanceTickets.length,
    },
    tables: {
      organizations,
      users,
      memberships,
      ownerEntities,
      portfolios,
      properties,
      units,
      people,
      tenantProfiles,
      identityEvidences,
      tenancies,
      tenancyParticipants,
      leaseVersions,
      charges,
      payments,
      paymentAllocations,
      ledgerAdjustments,
      receipts,
      depositLiabilities,
      expenses,
      maintenanceTickets,
      maintenanceEvents,
      documents,
      communicationPreferences,
      messageLogs,
      consentRecords,
      auditEvents,
      syncOperations,
      applicationSettings,
    },
  };
}

export async function exportFullBackupJSON(): Promise<BackupEnvelope> {
  const envelope = await buildFullBackupEnvelope();

  await db.applicationSettings.update('settings-default', {
    lastBackupExportedAt: envelope.exportedAt,
  });

  triggerBrowserDownload(
    `Akarai_Backup_${envelope.exportedAt.slice(0, 10)}.json`,
    JSON.stringify(envelope, null, 2),
    'application/json'
  );

  return envelope;
}

/**
 * Validates backup structure, schema version, row object integrity, unique IDs,
 * foreign-key links, and integer-cent financial invariants (A03).
 */
export function validateBackupEnvelope(parsed: unknown): {
  valid: boolean;
  error?: string;
  envelope?: BackupEnvelope;
} {
  if (!isPlainObject(parsed)) {
    return { valid: false, error: 'Backup payload must be a JSON object.' };
  }

  if (parsed.schemaName !== 'LandlordOS_MVP_Backup' && parsed.schemaName !== 'Akarai_Backup') {
    return {
      valid: false,
      error: 'Invalid backup schema header: expected Akarai_Backup or LandlordOS_MVP_Backup.',
    };
  }

  if (parsed.schemaVersion !== SUPPORTED_BACKUP_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Unsupported backup schemaVersion "${String(parsed.schemaVersion ?? '')}". Expected "${SUPPORTED_BACKUP_SCHEMA_VERSION}".`,
    };
  }

  if (!isPlainObject(parsed.tables)) {
    return { valid: false, error: 'Backup file is missing required entity tables object.' };
  }

  const tables = parsed.tables as Record<string, unknown>;

  for (const req of REQUIRED_BACKUP_TABLES) {
    if (!Array.isArray(tables[req])) {
      return {
        valid: false,
        error: `Backup validation failed: missing or non-array required table "${req}".`,
      };
    }
  }

  // Validate every present table has plain object rows with unique non-empty string IDs
  const idSets: Record<string, Set<string>> = {};
  for (const [tableName, tableVal] of Object.entries(tables)) {
    if (!Array.isArray(tableVal)) {
      return { valid: false, error: `Table "${tableName}" must be an array.` };
    }
    const seen = new Set<string>();
    for (let i = 0; i < tableVal.length; i += 1) {
      const row = tableVal[i];
      if (!isPlainObject(row)) {
        return { valid: false, error: `Row ${i} in "${tableName}" is not a valid object.` };
      }
      if (typeof row.id !== 'string' || row.id.trim().length === 0) {
        return { valid: false, error: `Row ${i} in "${tableName}" is missing a valid string "id".` };
      }
      if (seen.has(row.id)) {
        return { valid: false, error: `Duplicate id "${row.id}" found in table "${tableName}".` };
      }
      seen.add(row.id);
    }
    idSets[tableName] = seen;
  }

  // Foreign-key & financial invariant checks
  const propertyIds = idSets.properties || new Set<string>();
  const unitIds = idSets.units || new Set<string>();
  const tenantIds = idSets.tenantProfiles || new Set<string>();
  const tenancyIds = idSets.tenancies || new Set<string>();
  const chargeIds = idSets.charges || new Set<string>();
  const paymentIds = idSets.payments || new Set<string>();

  for (const unit of tables.units as Record<string, unknown>[]) {
    if (typeof unit.propertyId !== 'string' || !propertyIds.has(unit.propertyId)) {
      return { valid: false, error: `Unit "${unit.id}" references missing propertyId "${String(unit.propertyId)}".` };
    }
    if (!isFiniteInt(unit.standardRentCents) || unit.standardRentCents < 0) {
      return { valid: false, error: `Unit "${unit.id}" has invalid standardRentCents.` };
    }
  }

  for (const tenancy of tables.tenancies as Record<string, unknown>[]) {
    if (typeof tenancy.propertyId !== 'string' || !propertyIds.has(tenancy.propertyId)) {
      return { valid: false, error: `Tenancy "${tenancy.id}" references missing propertyId.` };
    }
    if (typeof tenancy.unitId !== 'string' || !unitIds.has(tenancy.unitId)) {
      return { valid: false, error: `Tenancy "${tenancy.id}" references missing unitId.` };
    }
    if (typeof tenancy.primaryTenantId !== 'string' || !tenantIds.has(tenancy.primaryTenantId)) {
      return { valid: false, error: `Tenancy "${tenancy.id}" references missing primaryTenantId.` };
    }
    if (!isFiniteInt(tenancy.rentAmountCents) || tenancy.rentAmountCents < 0) {
      return { valid: false, error: `Tenancy "${tenancy.id}" has invalid rentAmountCents.` };
    }
  }

  for (const charge of tables.charges as Record<string, unknown>[]) {
    if (typeof charge.tenancyId !== 'string' || !tenancyIds.has(charge.tenancyId)) {
      return { valid: false, error: `Charge "${charge.id}" references missing tenancyId.` };
    }
    if (!isFiniteInt(charge.amountCents) || charge.amountCents < 0) {
      return { valid: false, error: `Charge "${charge.id}" has invalid non-integer or negative amountCents.` };
    }
    if (!isFiniteInt(charge.allocatedPaidCents) || charge.allocatedPaidCents < 0) {
      return { valid: false, error: `Charge "${charge.id}" has invalid allocatedPaidCents.` };
    }
    if (!isFiniteInt(charge.adjustedCents)) {
      return { valid: false, error: `Charge "${charge.id}" has invalid adjustedCents.` };
    }
  }

  for (const payment of tables.payments as Record<string, unknown>[]) {
    if (typeof payment.tenancyId !== 'string' || !tenancyIds.has(payment.tenancyId)) {
      return { valid: false, error: `Payment "${payment.id}" references missing tenancyId.` };
    }
    if (!isFiniteInt(payment.amountCents) || payment.amountCents <= 0) {
      return { valid: false, error: `Payment "${payment.id}" has invalid amountCents (must be positive integer cents).` };
    }
    if (!isFiniteInt(payment.unallocatedCents) || payment.unallocatedCents < 0) {
      return { valid: false, error: `Payment "${payment.id}" has invalid unallocatedCents.` };
    }
  }

  for (const alloc of tables.paymentAllocations as Record<string, unknown>[]) {
    if (typeof alloc.paymentId !== 'string' || !paymentIds.has(alloc.paymentId)) {
      return { valid: false, error: `PaymentAllocation "${alloc.id}" references missing paymentId.` };
    }
    if (typeof alloc.chargeId !== 'string' || !chargeIds.has(alloc.chargeId)) {
      return { valid: false, error: `PaymentAllocation "${alloc.id}" references missing chargeId.` };
    }
    if (!isFiniteInt(alloc.amountCents) || alloc.amountCents <= 0) {
      return { valid: false, error: `PaymentAllocation "${alloc.id}" has invalid amountCents.` };
    }
  }

  for (const receipt of tables.receipts as Record<string, unknown>[]) {
    if (typeof receipt.paymentId !== 'string' || !paymentIds.has(receipt.paymentId)) {
      return { valid: false, error: `Receipt "${receipt.id}" references missing paymentId.` };
    }
    if (typeof receipt.receiptNumber !== 'string' || receipt.receiptNumber.trim().length === 0) {
      return { valid: false, error: `Receipt "${receipt.id}" is missing a valid receiptNumber.` };
    }
    if (!isFiniteInt(receipt.amountCents)) {
      return { valid: false, error: `Receipt "${receipt.id}" has invalid amountCents.` };
    }
  }

  if (Array.isArray(tables.expenses)) {
    for (const exp of tables.expenses as Record<string, unknown>[]) {
      if (!isFiniteInt(exp.amountCents) || exp.amountCents < 0) {
        return { valid: false, error: `Expense "${exp.id}" has invalid amountCents.` };
      }
    }
  }

  if (Array.isArray(tables.depositLiabilities)) {
    for (const dep of tables.depositLiabilities as Record<string, unknown>[]) {
      if (
        !isFiniteInt(dep.agreedDepositCents) ||
        !isFiniteInt(dep.receivedDepositCents) ||
        !isFiniteInt(dep.deductionsCents) ||
        !isFiniteInt(dep.refundedCents) ||
        dep.agreedDepositCents < 0 ||
        dep.receivedDepositCents < 0 ||
        dep.deductionsCents < 0 ||
        dep.refundedCents < 0
      ) {
        return { valid: false, error: `DepositLiability "${dep.id}" has invalid integer cent values.` };
      }
    }
  }

  // Recompute truthful counts from actual table arrays rather than trusting file metadata
  const sanitizedEnvelope: BackupEnvelope = {
    schemaName: parsed.schemaName,
    schemaVersion: SUPPORTED_BACKUP_SCHEMA_VERSION,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    currency: 'ZAR',
    counts: {
      properties: (tables.properties as unknown[]).length,
      units: (tables.units as unknown[]).length,
      tenantProfiles: (tables.tenantProfiles as unknown[]).length,
      tenancies: (tables.tenancies as unknown[]).length,
      charges: (tables.charges as unknown[]).length,
      payments: (tables.payments as unknown[]).length,
      receipts: (tables.receipts as unknown[]).length,
      expenses: Array.isArray(tables.expenses) ? tables.expenses.length : 0,
      maintenanceTickets: Array.isArray(tables.maintenanceTickets) ? tables.maintenanceTickets.length : 0,
    },
    tables: tables as Record<string, unknown[]>,
  };

  return { valid: true, envelope: sanitizedEnvelope };
}

export function validateBackupJSON(rawText: string): {
  valid: boolean;
  error?: string;
  envelope?: BackupEnvelope;
} {
  try {
    const parsed: unknown = JSON.parse(rawText);
    return validateBackupEnvelope(parsed);
  } catch (err) {
    return {
      valid: false,
      error: `JSON parsing error: ${err instanceof Error ? err.message : 'Invalid JSON file'}`,
    };
  }
}

export async function restoreValidatedBackup(
  envelope: BackupEnvelope,
  options?: { onBeforeCommitForTest?: () => void }
): Promise<void> {
  // Always re-validate before mutating any database tables so malformed payloads can never wipe data.
  const check = validateBackupEnvelope(envelope);
  if (!check.valid || !check.envelope) {
    throw new Error(check.error || 'Backup validation failed before restore.');
  }

  const t = check.envelope.tables;
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      const rows = t[table.name];
      if (Array.isArray(rows) && rows.length > 0) {
        await table.bulkAdd(rows);
      }
    }
    if (options?.onBeforeCommitForTest) {
      options.onBeforeCommitForTest();
    }
  });
}
