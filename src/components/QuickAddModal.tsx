import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  Plus,
  X,
} from 'lucide-react';
import type {
  Charge,
  CommunicationChannel,
  DepositLiability,
  DocumentationStatus,
  DocumentationType,
  Expense,
  LeaseCategory,
  LedgerAdjustment,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceTicket,
  Payment,
  PaymentMethod,
  PaymentVerificationStatus,
  Property,
  PropertyCategory,
  Receipt,
  RoleType,
  Tenancy,
  TenantProfile,
  Unit,
  UnitStatus,
  UnitType,
} from '../types/domain';
import {
  computeTenancyLedgerSummary,
  createMaintenanceTicketRecord,
  createPropertyRecord,
  createTenancyRecord,
  createTenantRecord,
  createUnitRecord,
  DuplicatePaymentConfirmationError,
  logCommunicationEntry,
  recordExpenseEntry,
  recordPaymentTransaction,
} from '../services/domainService';
import { downloadReceiptPDF } from '../services/pdfService';
import {
  buildWhatsAppUrl,
  currentPeriodKey,
  formatSADate,
  formatZAR,
  generateUUID,
  parseZARToCents,
  PAYMENT_METHOD_LABELS,
  todayIso,
} from '../utils/format';
import { useLanguagePreference } from './DesignSystem';
import {
  getContextualQuickActionsForScreen,
  resolveActiveScreenContext,
  type ContextualQuickActionItem,
} from '../config/navigationAndQuickActions';

export type QuickAddTab =
  | 'menu'
  | 'payments_menu'
  | 'payment'
  | 'property'
  | 'unit'
  | 'tenant'
  | 'tenancy'
  | 'maintenance'
  | 'notice'
  | 'expense';

export interface QuickAddPrefill {
  tenancyId?: string;
  tenantId?: string;
  unitId?: string;
  propertyId?: string;
}

interface QuickAddModalProps {
  isOpen: boolean;
  initialTab?: QuickAddTab;
  prefill?: QuickAddPrefill;
  onClose: () => void;
  properties: Property[];
  units: Unit[];
  tenants: TenantProfile[];
  tenancies: Tenancy[];
  charges?: Charge[];
  payments?: Payment[];
  adjustments?: LedgerAdjustment[];
  deposits?: DepositLiability[];
  maintenanceTickets?: MaintenanceTicket[];
  activeRole?: RoleType;
  activeUserName?: string;
  onSuccess?: (message: string) => void;
  onNavigate?: (path: string) => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  initialTab = 'menu',
  prefill,
  onClose,
  properties,
  units,
  tenants,
  tenancies,
  charges = [],
  payments = [],
  adjustments = [],
  deposits = [],
  maintenanceTickets = [],
  activeRole = 'owner',
  activeUserName = 'Landlord',
  onSuccess,
  onNavigate,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, contextualActions } = useLanguagePreference();

  const [activeTab, setActiveTab] = useState<QuickAddTab>(initialTab);
  const [originMenu, setOriginMenu] = useState<'menu' | 'payments_menu'>(
    initialTab === 'payments_menu' ? 'payments_menu' : 'menu'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateConfirmMsg, setDuplicateConfirmMsg] = useState<string | null>(null);
  const [payOpToken, setPayOpToken] = useState<string>(() => generateUUID());
  const [submitting, setSubmitting] = useState(false);

  // Post-payment Receipt Ready confirmation state
  const [completedReceipt, setCompletedReceipt] = useState<{
    receipt: Receipt;
    payment: Payment;
    tenant?: TenantProfile;
  } | null>(null);

  // Resolve current screen and entity context from active route & parameters
  const screenContext = useMemo(
    () =>
      resolveActiveScreenContext(location.pathname, location.search, {
        properties,
        units,
        tenants,
        tenancies,
        charges,
        maintenanceTickets,
      }),
    [
      location.pathname,
      location.search,
      properties,
      units,
      tenants,
      tenancies,
      charges,
      maintenanceTickets,
    ]
  );

  const contextualMenuConfig = useMemo(
    () => getContextualQuickActionsForScreen(screenContext, activeRole, contextualActions),
    [screenContext, activeRole, contextualActions]
  );

  const getUnpaidBalanceForTenancy = (targetTenancyId: string): number => {
    if (!targetTenancyId) return 0;
    const summary = computeTenancyLedgerSummary(
      targetTenancyId,
      charges,
      payments,
      adjustments,
      deposits
    );
    return Math.max(0, summary.netBalanceDueCents);
  };

  // 1. Payment Form State
  const [payTenancyId, setPayTenancyId] = useState('');
  const [payAmountRands, setPayAmountRands] = useState('');
  const [payDate, setPayDate] = useState(() => todayIso());
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payVerification, setPayVerification] =
    useState<PaymentVerificationStatus>('landlord-reported');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // 2. Property Form State
  const [propName, setPropName] = useState('');
  const [propCategory, setPropCategory] = useState<PropertyCategory>('residential');
  const [propStreet, setPropStreet] = useState('');
  const [propSuburb, setPropSuburb] = useState('');
  const [propCity, setPropCity] = useState('Johannesburg');
  const [propProvince, setPropProvince] = useState<Property['province']>('Gauteng');
  const [propPostal, setPropPostal] = useState('2000');

  // 3. Unit Form State
  const [unitPropId, setUnitPropId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitType] = useState<UnitType>('flat');
  const [unitStatus] = useState<UnitStatus>('vacant');
  const [unitRentRands, setUnitRentRands] = useState('3500.00');
  const [unitElecMeter] = useState('');

  // 4. Tenant Form State (+ optional instant vacant-unit assignment)
  const [tenFullName, setTenFullName] = useState('');
  const [tenProvisional] = useState('');
  const [tenPhone, setTenPhone] = useState('');
  const [tenAltPhone] = useState('');
  const [tenAltName] = useState('');
  const [tenDocType] = useState<DocumentationType>('not_provided');
  const [tenDocStatus, setTenDocStatus] = useState<DocumentationStatus>('not-provided');
  const [tenHasSmartphone, setTenHasSmartphone] = useState(true);
  const [tenHasBank, setTenHasBank] = useState(true);
  const [tenHasInternet] = useState(true);
  const [tenChannel] = useState<CommunicationChannel>('whatsapp');
  const [tenNotes] = useState('');
  const [tenAssignRentRands, setTenAssignRentRands] = useState('3500.00');
  const [tenAssignDepositRands, setTenAssignDepositRands] = useState('0.00');
  const [tenGenerateFirstCharge, setTenGenerateFirstCharge] = useState(true);

  // 5. Tenancy Form State
  const [lseUnitId, setLseUnitId] = useState('');
  const [lseTenantId, setLseTenantId] = useState('');
  const [lseCategory] = useState<LeaseCategory>('residential_standard');
  const [lseStartDate, setLseStartDate] = useState(() => `${currentPeriodKey()}-01`);
  const [lseRentRands, setLseRentRands] = useState('3500.00');
  const [lseDepositReqRands, setLseDepositReqRands] = useState('3500.00');
  const [lseDepositRecRands, setLseDepositRecRands] = useState('0.00');
  const [lseUtilRands] = useState('0.00');
  const [lseDueDay] = useState('1');

  // 6. Maintenance Form State
  const [mntPropId, setMntPropId] = useState('');
  const [mntUnitId, setMntUnitId] = useState('');
  const [mntTitle, setMntTitle] = useState('');
  const [mntDesc] = useState('');
  const [mntCategory] = useState<MaintenanceCategory>('plumbing_geyser');
  const [mntPriority, setMntPriority] = useState<MaintenancePriority>('medium');
  const [mntEstRands, setMntEstRands] = useState('650.00');
  const [mntContractor] = useState('');

  // 7. Notice Form State
  const [notTenantId, setNotTenantId] = useState('');
  const [notSubject, setNotSubject] = useState('Rent & Inspection Notice');
  const [notChannel, setNotChannel] = useState<CommunicationChannel>('whatsapp');
  const [notBody, setNotBody] = useState(
    'Dear Tenant, please note your upcoming rental payment / routine unit inspection scheduled for this week.'
  );

  // 8. Expense Form State
  const [expPropId, setExpPropId] = useState('');
  const [expCategory] = useState<Expense['category']>('municipal_rates_taxes');
  const [expDesc, setExpDesc] = useState('');
  const [expVendor] = useState('');
  const [expAmountRands, setExpAmountRands] = useState('1250.00');
  const [expDate, setExpDate] = useState(() => todayIso());

  const activeTenancies = useMemo(
    () => tenancies.filter((l) => !l.isDeleted && l.status !== 'ended' && l.status !== 'terminated'),
    [tenancies]
  );

  const vacantUnits = useMemo(
    () =>
      units.filter(
        (u) =>
          !u.isDeleted &&
          !activeTenancies.some((l) => l.unitId === u.id)
      ),
    [units, activeTenancies]
  );

  // Build context-aware reminder message for a specific tenant
  const buildReminderMessageForTenant = (targetTenantId?: string) => {
    const ten = tenants.find((x) => x.id === targetTenantId);
    if (!ten) {
      return 'Dear Tenant, this is a friendly reminder regarding your upcoming or overdue rental payment. Please share your proof of payment once completed.';
    }
    const tenancy =
      tenancies.find((l) => l.primaryTenantId === ten.id && l.status !== 'ended') ||
      tenancies.find((l) => l.primaryTenantId === ten.id);
    const unit = units.find((u) => u.id === tenancy?.unitId);
    const unpaidCents = tenancy ? getUnpaidBalanceForTenancy(tenancy.id) : 0;
    const balanceDisplay =
      unpaidCents > 0
        ? formatZAR(unpaidCents)
        : tenancy
          ? formatZAR(tenancy.rentAmountCents)
          : formatZAR(0);
    return `Dear ${ten.fullName}, friendly reminder regarding ${unit ? unit.unitNumber : 'your unit'}. Current balance due: ${balanceDisplay}. Reference: ${tenancy?.tenancyReference || ten.tenantCode}.`;
  };

  // Apply context-aware & explicit prefill when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setCompletedReceipt(null);
    setActiveTab(initialTab);
    if (initialTab === 'payments_menu' || initialTab === 'menu') {
      setOriginMenu(initialTab);
    }
    setErrorMsg(null);
    setDuplicateConfirmMsg(null);
    setPayOpToken(generateUUID());
    setPayDate(todayIso());
    setExpDate(todayIso());
    setLseStartDate(`${currentPeriodKey()}-01`);

    const resolvedPropId =
      prefill?.propertyId ||
      screenContext.propertyId ||
      (properties.length === 1 ? properties[0].id : '');
    const propUnits = resolvedPropId
      ? units.filter((u) => u.propertyId === resolvedPropId)
      : units;
    const resolvedUnitId =
      prefill?.unitId ||
      screenContext.unitId ||
      (propUnits.length === 1 ? propUnits[0].id : '');
    const resolvedTenantId =
      prefill?.tenantId ||
      screenContext.tenantId ||
      (tenants.length === 1 ? tenants[0].id : '');

    const prefillTenancy = prefill?.tenancyId
      ? tenancies.find((l) => l.id === prefill.tenancyId)
      : prefill?.tenantId
        ? activeTenancies.find((l) => l.primaryTenantId === prefill.tenantId)
        : undefined;

    const resolvedTenancyId =
      prefillTenancy?.id ||
      screenContext.tenancyId ||
      (activeTenancies.length === 1 ? activeTenancies[0].id : '');

    setUnitPropId(resolvedPropId);
    setMntPropId(resolvedPropId);
    setMntUnitId(prefill?.unitId || screenContext.unitId || '');
    setExpPropId(resolvedPropId);

    // For Tenant quick-add, only pre-select a unit if it is explicitly prefilled and vacant
    const prefilledVacantUnit =
      prefill?.unitId && vacantUnits.some((u) => u.id === prefill.unitId) ? prefill.unitId : '';
    setLseUnitId(initialTab === 'tenant' ? prefilledVacantUnit : resolvedUnitId);
    setLseTenantId(resolvedTenantId);

    const targetUnit = units.find((u) => u.id === (prefilledVacantUnit || resolvedUnitId));
    if (targetUnit && targetUnit.standardRentCents > 0) {
      const rentStr = (targetUnit.standardRentCents / 100).toFixed(2);
      setLseRentRands(rentStr);
      setTenAssignRentRands(rentStr);
      setUnitRentRands(rentStr);
    } else if (screenContext.standardRentCents) {
      const rentStr = (screenContext.standardRentCents / 100).toFixed(2);
      setLseRentRands(rentStr);
      setTenAssignRentRands(rentStr);
      setUnitRentRands(rentStr);
    }

    setPayTenancyId(resolvedTenancyId);
    if (resolvedTenancyId) {
      const unpaid = getUnpaidBalanceForTenancy(resolvedTenancyId);
      const foundTenancy = tenancies.find((l) => l.id === resolvedTenancyId);
      if (unpaid > 0) {
        setPayAmountRands((unpaid / 100).toFixed(2));
      } else if (foundTenancy && foundTenancy.rentAmountCents > 0) {
        setPayAmountRands((foundTenancy.rentAmountCents / 100).toFixed(2));
      } else {
        setPayAmountRands('');
      }
    } else {
      setPayAmountRands('');
    }

    setNotTenantId(resolvedTenantId);
    if (resolvedTenantId) {
      setNotBody(buildReminderMessageForTenant(resolvedTenantId));
    }

    if (screenContext.estimatedRepairCostCents && screenContext.estimatedRepairCostCents > 0) {
      setExpAmountRands((screenContext.estimatedRepairCostCents / 100).toFixed(2));
    }
  }, [isOpen, initialTab, prefill, screenContext]);

  useEffect(() => {
    setPayOpToken(generateUUID());
    setDuplicateConfirmMsg(null);
  }, [payTenancyId, payAmountRands, payDate, payMethod, payRef]);

  // Escape key & Android Back button handling when QuickAddModal is open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    let pushedHistoryState = false;
    try {
      if (window.history.state?.akaraiQuickActionsOpen !== true) {
        window.history.pushState(
          { ...window.history.state, akaraiQuickActionsOpen: true },
          ''
        );
        pushedHistoryState = true;
      }
    } catch {
      // ignore
    }

    const handlePopState = () => {
      pushedHistoryState = false;
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      if (pushedHistoryState && window.history.state?.akaraiQuickActionsOpen === true) {
        try {
          window.history.back();
        } catch {
          // ignore
        }
      }
    };
  }, [isOpen, onClose]);

  const selectedPayTenancy = useMemo(
    () => tenancies.find((l) => l.id === payTenancyId),
    [tenancies, payTenancyId]
  );

  const selectedPaySummary = useMemo(() => {
    if (!payTenancyId) return null;
    return computeTenancyLedgerSummary(payTenancyId, charges, payments, adjustments, deposits);
  }, [payTenancyId, charges, payments, adjustments, deposits]);

  const parsedPayAmountCents = useMemo(() => parseZARToCents(payAmountRands), [payAmountRands]);

  const projectedBalanceAfterPaymentCents = useMemo(() => {
    if (!selectedPaySummary) return null;
    return selectedPaySummary.netBalanceDueCents - Math.max(0, parsedPayAmountCents);
  }, [selectedPaySummary, parsedPayAmountCents]);

  if (!isOpen) return null;

  const handleSelectContextualAction = (item: ContextualQuickActionItem) => {
    setErrorMsg(null);

    if (item.targetRoute) {
      onClose();
      if (onNavigate) {
        onNavigate(item.targetRoute);
      } else {
        navigate(item.targetRoute);
      }
      return;
    }

    if (item.presetMode === 'issue_receipt') {
      setPayNotes('Official Rent Receipt Issued & Shared');
    } else if (item.presetMode === 'rent_reminder') {
      setNotSubject(t.commsMaintDocs.templateRentReminder);
      setNotBody(buildReminderMessageForTenant(notTenantId || screenContext.tenantId));
    }

    if (item.targetTab) {
      setActiveTab(item.targetTab);
    }
  };

  // Post-Payment Receipt Ready Confirmation Sheet (closes the payment -> receipt -> WhatsApp/PDF loop in 1 tap)
  if (completedReceipt) {
    const { receipt, payment, tenant } = completedReceipt;
    const balanceLine =
      receipt.balanceAfterPaymentCents > 0
        ? `Remaining balance: ${formatZAR(receipt.balanceAfterPaymentCents)}`
        : receipt.balanceAfterPaymentCents < 0
          ? `Advance credit: ${formatZAR(Math.abs(receipt.balanceAfterPaymentCents))}`
          : 'Account balance: R 0.00 (Settled)';
    const waReceiptMessage = `Receipt ${receipt.receiptNumber} from ${receipt.landlordName}\nTenant: ${receipt.tenantName}\nUnit: ${receipt.propertyUnitLabel}\nAmount Paid: ${formatZAR(receipt.amountCents)} (${PAYMENT_METHOD_LABELS[receipt.paymentMethod] || receipt.paymentMethod})\nDate: ${formatSADate(receipt.transactionDate)}\n${balanceLine}`;
    const waLink = buildWhatsAppUrl(
      tenant?.primaryPhone || tenant?.alternativePhone,
      waReceiptMessage
    );

    const handleCopyReceiptText = async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(waReceiptMessage);
          onSuccess?.(`Receipt ${receipt.receiptNumber} text copied`);
        }
      } catch {
        onSuccess?.('Receipt ready to share');
      }
    };

    const handleShareWhatsAppReceipt = async () => {
      if (tenant) {
        try {
          await logCommunicationEntry({
            tenantId: tenant.id,
            tenancyId: receipt.tenancyId,
            propertyId: receipt.propertyId,
            channel: 'whatsapp',
            templateType: 'payment_acknowledgement',
            subject: `Receipt ${receipt.receiptNumber}`,
            body: waReceiptMessage,
            recipientContact: tenant.primaryPhone || tenant.alternativePhone || 'WhatsApp',
            deliveryStatus: 'handed-off',
            statusEvidenceNote: 'Opened WhatsApp receipt share from Quick Payment confirmation.',
          });
        } catch {
          // Non-blocking audit log
        }
      }
    };

    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 dark:bg-black/70 backdrop-blur-[1px]"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Receipt Ready"
          className="w-full max-w-[430px] rounded-t-[28px] bg-[#F7F9FD] dark:bg-[#171C23] border-t border-[#E4E9F2] dark:border-[#272E38] px-5 pt-4 pb-6 shadow-2xl space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-[42px] h-[4px] rounded-full bg-[#94A3B8]/80 dark:bg-[#525B68] mx-auto" />

          <div className="flex flex-col items-center text-center pt-1">
            <div className="w-14 h-14 rounded-full bg-[#E8F8EE] dark:bg-[#113123] text-[#12A150] dark:text-[#23D160] flex items-center justify-center mb-2.5">
              <CheckCircle2 className="w-8 h-8 stroke-[2.2]" />
            </div>
            <h2 className="text-[20px] font-bold text-[#111318] dark:text-white tracking-tight">
              Payment Saved &amp; Receipt Ready
            </h2>
            <p className="text-[12.5px] text-[#626A78] dark:text-[#98A1B2] mt-0.5 font-mono">
              {receipt.receiptNumber} · {formatSADate(receipt.transactionDate)}
            </p>
          </div>

          <div className="rounded-[18px] bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E6ECF4] dark:border-[#2B333F] p-4 space-y-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-[#626A78] dark:text-[#98A1B2]">Tenant</span>
              <span className="font-bold text-[#111318] dark:text-white">{receipt.tenantName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#626A78] dark:text-[#98A1B2]">Amount Received</span>
              <span className="font-bold font-mono tabular-nums text-[#12A150] dark:text-[#23D160]">
                {formatZAR(receipt.amountCents)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-[#EDF1F5] dark:border-[#2B333F] pt-2">
              <span className="text-[#626A78] dark:text-[#98A1B2]">Updated Balance</span>
              <span
                className={`font-bold font-mono tabular-nums ${
                  receipt.balanceAfterPaymentCents > 0
                    ? 'text-[#E5252A] dark:text-[#FF5A5F]'
                    : 'text-[#12A150] dark:text-[#23D160]'
                }`}
              >
                {receipt.balanceAfterPaymentCents > 0
                  ? `${formatZAR(receipt.balanceAfterPaymentCents)} due`
                  : receipt.balanceAfterPaymentCents < 0
                    ? `${formatZAR(Math.abs(receipt.balanceAfterPaymentCents))} credit`
                    : 'R 0.00 (Settled)'}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleShareWhatsAppReceipt}
                className="w-full min-h-[48px] px-4 rounded-[15px] bg-[#12A150] hover:bg-[#0E8A44] text-white text-[14px] font-bold flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12A150]"
              >
                <MessageCircle className="w-[18px] h-[18px]" />
                <span>Send Receipt on WhatsApp</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-85" />
              </a>
            ) : (
              <button
                type="button"
                onClick={handleCopyReceiptText}
                className="w-full min-h-[48px] px-4 rounded-[15px] bg-[#0145F2] hover:bg-[#0039CC] text-white text-[14px] font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Copy className="w-[18px] h-[18px]" />
                <span>Copy Receipt Text</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => downloadReceiptPDF(receipt, payment)}
                className="min-h-[44px] px-3 rounded-[14px] bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E6ECF4] dark:border-[#2B333F] text-[#111318] dark:text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:border-[#0145F2]"
              >
                <Download className="w-4 h-4 text-[#0145F2] dark:text-[#68A2FF]" />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompletedReceipt(null);
                  setPayRef('');
                  setPayNotes('');
                  setPayOpToken(generateUUID());
                }}
                className="min-h-[44px] px-3 rounded-[14px] bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E6ECF4] dark:border-[#2B333F] text-[#111318] dark:text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:border-[#0145F2]"
              >
                <Plus className="w-4 h-4 text-[#0145F2] dark:text-[#68A2FF]" />
                <span>Log Another</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-[14px] bg-[#E8EFFA] dark:bg-[#262C36] text-[#0145F2] dark:text-[#E5E7EB] text-[13.5px] font-bold"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Contextual Quick Actions Bottom Sheet Menu (adapts dynamically to Home, Properties, Tenants, Payments & nested screens)
  if (activeTab === 'menu' || activeTab === 'payments_menu') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 dark:bg-black/65 backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={contextualMenuConfig.menuTitle}
          className="w-full max-w-[430px] rounded-t-[28px] bg-[#F7F9FD] dark:bg-[#171C23] border-t border-[#E4E9F2] dark:border-[#272E38] px-4 pt-3 pb-5 shadow-[0_-8px_30px_rgba(0,0,0,0.18)] dark:shadow-[0_-10px_36px_rgba(0,0,0,0.75)] transition-transform duration-200 ease-out motion-reduce:transition-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Drag Handle */}
          <div className="w-[42px] h-[4px] rounded-full bg-[#94A3B8]/80 dark:bg-[#525B68] mx-auto mb-3.5" />

          {/* Header & Active Entity Context Badge */}
          <div className="mb-3.5 px-0.5">
            {contextualMenuConfig.contextLabel && (
              <div className="mb-1.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] text-[11.5px] font-semibold">
                <span>{contextualActions.context.activeContextPrefix}:</span>
                <span className="font-bold truncate max-w-[260px]">
                  {contextualMenuConfig.contextLabel}
                </span>
              </div>
            )}
            <h2 className="text-[21px] font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] leading-tight">
              {contextualMenuConfig.menuTitle}
            </h2>
            <p className="text-[13px] text-[#374151] dark:text-[#C4C9D1] mt-1">
              {contextualMenuConfig.menuSubtitle}
            </p>
          </div>

          {/* Contextual Action Cards */}
          <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-0.5">
            {contextualMenuConfig.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectContextualAction(item)}
                  className="w-full min-h-[56px] rounded-[16px] px-3.5 py-2.5 bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E6ECF4] dark:border-[#2B333F] shadow-[0_1px_3px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50 dark:hover:border-[#3B4656] transition-colors flex items-center justify-between gap-3 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#0145F2] dark:text-[#1E80FF] shrink-0">
                      <Icon className="w-[22px] h-[22px] stroke-[2]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-snug break-words">
                        {item.title}
                      </div>
                      <div className="text-[12px] leading-[1.3] text-[#374151] dark:text-[#B8C0CC] whitespace-pre-line mt-0.5 break-words">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-[16px] h-[16px] text-[#374151] dark:text-[#9CA3AF] group-hover:translate-x-0.5 transition-transform shrink-0 stroke-[2]" />
                </button>
              );
            })}
          </div>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={onClose}
            className="mt-3.5 w-full h-[46px] rounded-[15px] bg-[#E2ECFC] dark:bg-[#262C36] hover:bg-[#D5E3FA] dark:hover:bg-[#2F3744] text-[#0145F2] dark:text-[#E5E7EB] text-[14.5px] font-bold flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
          >
            <X className="w-[17px] h-[17px] stroke-[2.3]" />
            <span>{t.common.cancel}</span>
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: QuickAddTab; label: string }[] = [
    { id: 'payment', label: t.common.payments },
    { id: 'tenant', label: t.common.tenant },
    { id: 'property', label: t.common.property },
    { id: 'unit', label: t.common.unit },
    { id: 'tenancy', label: t.common.tenancy },
    { id: 'maintenance', label: t.common.maintenance },
    { id: 'notice', label: t.common.notice },
    { id: 'expense', label: t.common.expense },
  ];

  // Filtered units when a property is selected in context or form
  const selectableUnitsForTenancy = screenContext.propertyId
    ? units.filter((u) => u.propertyId === screenContext.propertyId)
    : units;

  const selectableUnitsForMaintenance = mntPropId
    ? units.filter((u) => u.propertyId === mntPropId)
    : units;

  const submitRecord = async (confirmDistinctDuplicate = false) => {
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      if (activeTab === 'payment') {
        if (!payTenancyId) {
          throw new Error(contextualActions.context.confirmTenancyRequired);
        }
        const { payment, receipt } = await recordPaymentTransaction({
          tenancyId: payTenancyId,
          amountCents: parseZARToCents(payAmountRands),
          transactionDate: payDate,
          method: payMethod,
          verificationStatus: payVerification,
          externalReference: payRef,
          notes: payNotes,
          idempotencyToken: confirmDistinctDuplicate ? generateUUID() : payOpToken,
          confirmDistinctDuplicate,
        });
        const tenantObj = tenants.find((x) => x.id === receipt.tenantId);
        setDuplicateConfirmMsg(null);
        setPayRef('');
        setPayNotes('');
        onSuccess?.(`${t.quickActions.recordPaymentTitle}: ${receipt.receiptNumber}`);
        setCompletedReceipt({ receipt, payment, tenant: tenantObj });
      } else if (activeTab === 'property') {
        if (!propName.trim() || !propStreet.trim())
          throw new Error('Property name and street address are required.');
        const prop = await createPropertyRecord({
          name: propName,
          category: propCategory,
          streetAddress: propStreet,
          suburb: propSuburb || propCity || 'Johannesburg',
          city: propCity || 'Johannesburg',
          province: propProvince,
          postalCode: propPostal || '2000',
          buildingsCount: 1,
          floorsCount: 1,
        });
        setPropName('');
        setPropStreet('');
        onSuccess?.(`${t.common.property}: "${prop.name}"`);
        onClose();
      } else if (activeTab === 'unit') {
        if (!unitPropId) {
          throw new Error(contextualActions.context.confirmPropertyRequired);
        }
        if (!unitNumber.trim() || !unitName.trim())
          throw new Error('Unit code and unit name are required.');
        const u = await createUnitRecord({
          propertyId: unitPropId,
          unitNumber,
          name: unitName,
          unitType,
          status: unitStatus,
          standardRentCents: parseZARToCents(unitRentRands),
          amenities: ['Prepaid Sub-meter'],
          meterNumberElectricity: unitElecMeter,
        });
        setUnitNumber('');
        setUnitName('');
        onSuccess?.(`${t.common.unit}: ${u.unitNumber} (${u.name})`);
        onClose();
      } else if (activeTab === 'tenant') {
        if (!tenFullName.trim())
          throw new Error('Tenant name or provisional identifier is required.');
        const ten = await createTenantRecord({
          fullName: tenFullName,
          provisionalIdentifier: tenProvisional,
          primaryPhone: tenPhone,
          alternativePhone: tenAltPhone,
          alternativeContactName: tenAltName,
          hasSmartphone: tenHasSmartphone,
          hasBankAccount: tenHasBank,
          hasInternetAccess: tenHasInternet,
          documentationType: tenDocType,
          documentationStatus: tenDocStatus,
          preferredChannel: tenHasSmartphone ? tenChannel : 'in_person',
          occupantsCount: 1,
          portalAccessEnabled: tenHasSmartphone && tenHasInternet,
          notes: tenNotes,
        });
        if (lseUnitId) {
          const chosenUnit = units.find((u) => u.id === lseUnitId);
          if (chosenUnit) {
            const rentCents = parseZARToCents(tenAssignRentRands) || chosenUnit.standardRentCents;
            const depCents = parseZARToCents(tenAssignDepositRands);
            const lse = await createTenancyRecord({
              propertyId: chosenUnit.propertyId,
              unitId: chosenUnit.id,
              primaryTenantId: ten.id,
              leaseCategory: lseCategory,
              startDate: todayIso(),
              rentAmountCents: rentCents,
              dueDayOfMonth: 1,
              depositRequiredCents: depCents,
              depositReceivedCents: depCents,
              recurringUtilityChargeCents: 0,
              noticePeriodDays: 30,
              generateFirstMonthCharge: tenGenerateFirstCharge,
              firstChargePeriodKey: currentPeriodKey(),
            });
            setTenFullName('');
            setTenPhone('');
            onSuccess?.(`${ten.fullName} assigned to ${chosenUnit.unitNumber} (${lse.tenancyReference})`);
            onClose();
            return;
          }
        }
        setTenFullName('');
        setTenPhone('');
        onSuccess?.(`${t.common.tenant}: "${ten.fullName}" (${ten.tenantCode})`);
        onClose();
      } else if (activeTab === 'tenancy') {
        if (!lseUnitId || !lseTenantId) {
          throw new Error(contextualActions.context.confirmUnitAndTenantRequired);
        }
        const unitObj = units.find((u) => u.id === lseUnitId);
        const lse = await createTenancyRecord({
          propertyId: unitObj?.propertyId || screenContext.propertyId || properties[0]?.id || '',
          unitId: lseUnitId,
          primaryTenantId: lseTenantId,
          leaseCategory: lseCategory,
          startDate: lseStartDate,
          rentAmountCents: parseZARToCents(lseRentRands),
          dueDayOfMonth: parseInt(lseDueDay, 10) || 1,
          depositRequiredCents: parseZARToCents(lseDepositReqRands),
          depositReceivedCents: parseZARToCents(lseDepositRecRands),
          recurringUtilityChargeCents: parseZARToCents(lseUtilRands),
          recurringUtilityLabel: 'Water & Refuse Contribution',
          noticePeriodDays: 30,
          generateFirstMonthCharge: true,
          firstChargePeriodKey: lseStartDate.slice(0, 7) || currentPeriodKey(),
        });
        onSuccess?.(`${t.common.tenancy}: ${lse.tenancyReference}`);
        onClose();
      } else if (activeTab === 'maintenance') {
        if (!mntPropId) {
          throw new Error(contextualActions.context.confirmPropertyRequired);
        }
        if (!mntTitle.trim())
          throw new Error('Property and issue summary are required.');
        const ticket = await createMaintenanceTicketRecord({
          propertyId: mntPropId,
          unitId: mntUnitId || undefined,
          title: mntTitle,
          description: mntDesc || mntTitle,
          category: mntCategory,
          priority: mntPriority,
          reportedByRole: 'landlord',
          reporterName: activeUserName || 'Landlord',
          assignedContractorName: mntContractor,
          estimatedCostCents: parseZARToCents(mntEstRands),
        });
        setMntTitle('');
        onSuccess?.(`${t.common.maintenance}: ${ticket.ticketNumber}`);
        onClose();
      } else if (activeTab === 'notice') {
        const targetTenant = tenants.find((ten) => ten.id === notTenantId);
        if (!targetTenant) {
          throw new Error(contextualActions.context.confirmTenantRequired);
        }
        const tenancy = tenancies.find((ten) => ten.primaryTenantId === targetTenant.id);
        await logCommunicationEntry({
          tenantId: targetTenant.id,
          tenancyId: tenancy?.id,
          propertyId: tenancy?.propertyId,
          channel: notChannel,
          templateType: 'general_message',
          subject: notSubject || 'Landlord Notice',
          body: notBody,
          recipientContact:
            targetTenant.primaryPhone || targetTenant.alternativePhone || 'In-Person Delivery',
          deliveryStatus: notChannel === 'in_person' ? 'logged-offline' : 'drafted',
          statusEvidenceNote:
            notChannel === 'in_person'
              ? 'Logged as printed/in-person notice.'
              : 'Saved notice in Communication Center.',
        });
        onSuccess?.(`${t.common.notice}: "${notSubject}" (${targetTenant.fullName})`);
        onClose();
      } else if (activeTab === 'expense') {
        if (!expPropId) {
          throw new Error(contextualActions.context.confirmPropertyRequired);
        }
        if (!expDesc.trim())
          throw new Error('Property and expense description are required.');
        await recordExpenseEntry({
          propertyId: expPropId,
          category: expCategory,
          description: expDesc,
          vendorName: expVendor,
          amountCents: parseZARToCents(expAmountRands),
          incurredDate: expDate,
          paidStatus: 'paid',
          paymentMethod: 'eft',
        });
        setExpDesc('');
        onSuccess?.(`${t.common.expense}: ${expDesc}`);
        onClose();
      }
    } catch (err) {
      if (err instanceof DuplicatePaymentConfirmationError) {
        setDuplicateConfirmMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to save record.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitRecord(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 dark:bg-black/70 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={contextualMenuConfig.menuTitle}
        className="w-full max-w-[430px] rounded-t-[28px] bg-[#F6F8FC] dark:bg-[#171C23] border-t border-[#E4E9F2] dark:border-[#272E38] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-[42px] h-[4px] rounded-full bg-[#94A3B8]/80 dark:bg-[#525B68] mx-auto mt-3" />

        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E9F2] dark:border-[#272E38]">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab(originMenu)}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 text-[#0145F2] dark:text-[#1E80FF] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
              aria-label={t.common.back}
            >
              <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-bold text-[#111318] dark:text-[#FFFFFF] truncate">
                  {contextualMenuConfig.menuTitle}
                </h2>
                {screenContext.contextLabel && (
                  <span className="px-2 py-0.5 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] text-[10.5px] font-bold truncate max-w-[140px]">
                    {screenContext.contextLabel}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#4B5563] dark:text-[#B8C0CC] truncate">
                {t.quickActions.offlinePersistHint}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-[#4B5563] dark:text-[#B8C0CC] hover:bg-black/5 dark:hover:bg-white/10 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive Tab Selector */}
        <div className="flex items-center gap-1.5 px-4 py-2 bg-[#EDF1F7] dark:bg-[#12161C] border-b border-[#E4E9F2] dark:border-[#272E38] overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setErrorMsg(null);
              }}
              className={`min-h-[36px] px-3 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2] ${
                activeTab === tab.id
                  ? 'bg-[#0145F2] text-white'
                  : 'bg-[#FFFFFF] dark:bg-[#1E242D] text-[#4B5563] dark:text-[#B8C0CC] border border-[#E4E9F2] dark:border-[#2B333F]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-3.5 text-xs">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#FDECEE] dark:bg-[#331A1E] border border-[#F9D7DB] dark:border-[#4C2329] text-xs text-[#E5252A] dark:text-[#F85A5A]"
            >
              {errorMsg}
            </div>
          )}

          {duplicateConfirmMsg && activeTab === 'payment' && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#FEF2D6] dark:bg-[#3A2B12] border border-[#F5A623]/40 text-xs text-[#7A4B00] dark:text-[#FFD479] space-y-2"
            >
              <div className="font-bold">Possible Duplicate Same-Day Payment</div>
              <p className="leading-relaxed">{duplicateConfirmMsg}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitRecord(true)}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#0145F2] text-white font-semibold disabled:opacity-60"
                >
                  {submitting ? t.common.saving : 'Confirm Distinct Payment'}
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicateConfirmMsg(null)}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#A96B00]/30 font-semibold"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'payment' && (
            <>
              <div>
                <label
                  htmlFor="qa-pay-tenancy"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.tenancyUnit}
                </label>
                <select
                  id="qa-pay-tenancy"
                  value={payTenancyId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setPayTenancyId(nextId);
                    if (nextId) {
                      const unpaid = getUnpaidBalanceForTenancy(nextId);
                      const found = tenancies.find((l) => l.id === nextId);
                      if (unpaid > 0) {
                        setPayAmountRands((unpaid / 100).toFixed(2));
                      } else if (found) {
                        setPayAmountRands((found.rentAmountCents / 100).toFixed(2));
                      }
                    } else {
                      setPayAmountRands('');
                    }
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] text-[#111318] dark:text-[#FFFFFF]"
                >
                  <option value="">{contextualActions.context.selectTenancyPrompt}</option>
                  {tenancies.map((tenancyItem) => {
                    const ten = tenants.find((x) => x.id === tenancyItem.primaryTenantId);
                    const unit = units.find((u) => u.id === tenancyItem.unitId);
                    const dueCents = getUnpaidBalanceForTenancy(tenancyItem.id);
                    return (
                      <option key={tenancyItem.id} value={tenancyItem.id}>
                        {ten?.fullName || t.common.tenant} · {unit?.unitNumber || t.common.unit}
                        {dueCents > 0 ? ` (${formatZAR(dueCents)} due)` : ' (Settled)'}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Quick-Amount Chips when a tenancy is selected */}
              {selectedPayTenancy && selectedPaySummary && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedPaySummary.netBalanceDueCents > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setPayAmountRands((selectedPaySummary.netBalanceDueCents / 100).toFixed(2))
                        }
                        className="min-h-[34px] px-2.5 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] text-[11px] font-bold font-mono tabular-nums"
                      >
                        Full Due: {formatZAR(selectedPaySummary.netBalanceDueCents)}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPayAmountRands(
                            (Math.round(selectedPaySummary.netBalanceDueCents / 2) / 100).toFixed(2)
                          )
                        }
                        className="min-h-[34px] px-2.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E4E9F2] dark:border-[#2B333F] text-[#4B5563] dark:text-[#C4C9D1] text-[11px] font-semibold font-mono tabular-nums"
                      >
                        Half: {formatZAR(Math.round(selectedPaySummary.netBalanceDueCents / 2))}
                      </button>
                    </>
                  )}
                  {selectedPayTenancy.rentAmountCents !== selectedPaySummary.netBalanceDueCents && (
                    <button
                      type="button"
                      onClick={() =>
                        setPayAmountRands((selectedPayTenancy.rentAmountCents / 100).toFixed(2))
                      }
                      className="min-h-[34px] px-2.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E4E9F2] dark:border-[#2B333F] text-[#4B5563] dark:text-[#C4C9D1] text-[11px] font-semibold font-mono tabular-nums"
                    >
                      1 Mo Rent: {formatZAR(selectedPayTenancy.rentAmountCents)}
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-pay-amount"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.amountReceivedZar}
                  </label>
                  <input
                    id="qa-pay-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={payAmountRands}
                    onChange={(e) => setPayAmountRands(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-pay-date"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.transactionDate}
                  </label>
                  <input
                    id="qa-pay-date"
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-pay-method"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.paymentMethod}
                  </label>
                  <select
                    id="qa-pay-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="cash">{t.domainLabels.paymentMethods.cash}</option>
                    <option value="eft">{t.domainLabels.paymentMethods.eft}</option>
                    <option value="atm_cash_deposit">
                      {t.domainLabels.paymentMethods.atm_cash_deposit}
                    </option>
                    <option value="ewallet_voucher">
                      {t.domainLabels.paymentMethods.ewallet_voucher}
                    </option>
                    <option value="debit_order">{t.domainLabels.paymentMethods.debit_order}</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="qa-pay-verification"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.verificationStatus}
                  </label>
                  <select
                    id="qa-pay-verification"
                    value={payVerification}
                    onChange={(e) =>
                      setPayVerification(e.target.value as PaymentVerificationStatus)
                    }
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="landlord-reported">
                      {t.domainLabels.verificationStatuses['landlord-reported']}
                    </option>
                    <option value="evidence-attached">
                      {t.domainLabels.verificationStatuses['evidence-attached']}
                    </option>
                    <option value="reconciled">{t.financialsReportsSettings.reconciledLabel}</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="qa-pay-ref"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.referenceNotesOpt}
                </label>
                <input
                  id="qa-pay-ref"
                  type="text"
                  placeholder="e.g. EFT Ref or Cash slip note"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>

              {/* Live Post-Payment Balance Preview */}
              {selectedPaySummary && projectedBalanceAfterPaymentCents !== null && (
                <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E4E9F2] dark:border-[#2B333F] px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                      Balance Before → After
                    </div>
                    <div className="text-[12.5px] font-bold font-mono tabular-nums text-[#111318] dark:text-white mt-0.5">
                      {formatZAR(selectedPaySummary.netBalanceDueCents)} →{' '}
                      <span
                        className={
                          projectedBalanceAfterPaymentCents > 0
                            ? 'text-[#E5252A] dark:text-[#FF5A5F]'
                            : 'text-[#12A150] dark:text-[#23D160]'
                        }
                      >
                        {projectedBalanceAfterPaymentCents < 0
                          ? `${formatZAR(Math.abs(projectedBalanceAfterPaymentCents))} credit`
                          : formatZAR(projectedBalanceAfterPaymentCents)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold ${
                      projectedBalanceAfterPaymentCents <= 0
                        ? 'bg-[#E8F8EE] dark:bg-[#113123] text-[#12A150] dark:text-[#23D160]'
                        : 'bg-[#FFF4E0] dark:bg-[#3A2B12] text-[#B45309] dark:text-[#FFD479]'
                    }`}
                  >
                    {projectedBalanceAfterPaymentCents < 0
                      ? 'Advance Credit'
                      : projectedBalanceAfterPaymentCents === 0
                        ? 'Settled'
                        : 'Partial'}
                  </span>
                </div>
              )}
            </>
          )}

          {activeTab === 'property' && (
            <>
              <div>
                <label
                  htmlFor="qa-prop-name"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.propertyName}
                </label>
                <input
                  id="qa-prop-name"
                  type="text"
                  required
                  placeholder="e.g. Oakwood Apartments"
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
              <div>
                <label
                  htmlFor="qa-prop-cat"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.propertyCategory}
                </label>
                <select
                  id="qa-prop-cat"
                  value={propCategory}
                  onChange={(e) => setPropCategory(e.target.value as PropertyCategory)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                >
                  <option value="residential">
                    {t.domainLabels.propertyCategories.residential}
                  </option>
                  <option value="backyard_accommodation">
                    {t.domainLabels.propertyCategories.backyard_accommodation}
                  </option>
                  <option value="mixed_use">
                    {t.domainLabels.propertyCategories.mixed_use}
                  </option>
                  <option value="commercial">
                    {t.domainLabels.propertyCategories.commercial}
                  </option>
                  <option value="industrial_storage">
                    {t.domainLabels.propertyCategories.industrial_storage}
                  </option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-prop-street"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.streetAddress}
                  </label>
                  <input
                    id="qa-prop-street"
                    type="text"
                    required
                    placeholder="e.g. 15 Main Road"
                    value={propStreet}
                    onChange={(e) => setPropStreet(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-prop-city"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.citySuburb}
                  </label>
                  <input
                    id="qa-prop-city"
                    type="text"
                    required
                    placeholder="e.g. Johannesburg"
                    value={propCity}
                    onChange={(e) => {
                      setPropCity(e.target.value);
                      setPropSuburb(e.target.value);
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'tenant' && (
            <>
              <div>
                <label
                  htmlFor="qa-ten-name"
                  className="block text-[13px] font-bold text-[#111318] dark:text-[#FFFFFF] mb-1.5"
                >
                  {t.quickActions.fields.fullName}
                </label>
                <input
                  id="qa-ten-name"
                  type="text"
                  required
                  placeholder="e.g. Abdiis Dhababaa / ዳዊት ተስፋዬ"
                  value={tenFullName}
                  onChange={(e) => setTenFullName(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 py-2.5 rounded-[14px] border-2 border-[#0145F2] bg-[#FFFFFF] dark:bg-[#111317] text-[15px] font-medium text-[#111318] dark:text-[#FFFFFF] focus:outline-none focus:border-[#0145F2]"
                />
              </div>
              <div>
                <label
                  htmlFor="qa-ten-unit"
                  className="block text-[13px] font-bold text-[#111318] dark:text-[#FFFFFF] mb-1.5"
                >
                  {t.quickActions.fields.unit} (Optional — Assign Vacant Unit Now)
                </label>
                <select
                  id="qa-ten-unit"
                  value={lseUnitId}
                  onChange={(e) => {
                    const nextUnitId = e.target.value;
                    setLseUnitId(nextUnitId);
                    const found = units.find((u) => u.id === nextUnitId);
                    if (found) {
                      setTenAssignRentRands((found.standardRentCents / 100).toFixed(2));
                    }
                  }}
                  className="w-full min-h-[46px] px-3.5 py-2.5 rounded-[14px] border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#161920] text-[14.5px] font-medium text-[#111318] dark:text-[#FFFFFF] focus:outline-none focus:border-[#0145F2]"
                >
                  <option value="">Register tenant profile only (assign unit later)</option>
                  {vacantUnits.map((u) => {
                    const prop = properties.find((p) => p.id === u.propertyId);
                    return (
                      <option key={u.id} value={u.id}>
                        {u.unitNumber} {u.name ? `· ${u.name}` : ''} ({prop?.name || 'Property'}) —{' '}
                        {formatZAR(u.standardRentCents)}/mo
                      </option>
                    );
                  })}
                </select>
                {vacantUnits.length === 0 && (
                  <p className="text-[11px] text-[#626A78] dark:text-[#98A1B2] mt-1">
                    No vacant units currently available — tenant will be saved to your directory.
                  </p>
                )}
              </div>

              {lseUnitId && (
                <div className="rounded-xl bg-[#E7F0FF]/50 dark:bg-[#132247]/40 border border-[#C6DBFC] dark:border-[#26417A] p-3 space-y-2.5">
                  <div className="text-[11.5px] font-bold text-[#0145F2] dark:text-[#68A2FF]">
                    Instant Move-In Terms (Creates Active Tenancy)
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="qa-ten-rent"
                        className="block text-[11px] font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                      >
                        Monthly Rent (ZAR)
                      </label>
                      <input
                        id="qa-ten-rent"
                        type="number"
                        step="0.01"
                        value={tenAssignRentRands}
                        onChange={(e) => setTenAssignRentRands(e.target.value)}
                        className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="qa-ten-deposit"
                        className="block text-[11px] font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                      >
                        Deposit Held (ZAR)
                      </label>
                      <input
                        id="qa-ten-deposit"
                        type="number"
                        step="0.01"
                        value={tenAssignDepositRands}
                        onChange={(e) => setTenAssignDepositRands(e.target.value)}
                        className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[11.5px] text-[#111318] dark:text-[#E5E7EB]">
                    <input
                      type="checkbox"
                      checked={tenGenerateFirstCharge}
                      onChange={(e) => setTenGenerateFirstCharge(e.target.checked)}
                    />
                    Generate current month ({currentPeriodKey()}) rent charge automatically
                  </label>
                </div>
              )}

              <div>
                <label
                  htmlFor="qa-ten-phone"
                  className="block text-[13px] font-bold text-[#111318] dark:text-[#FFFFFF] mb-1.5"
                >
                  {t.quickActions.fields.phone}
                </label>
                <input
                  id="qa-ten-phone"
                  type="tel"
                  placeholder="+27 71 234 5678"
                  value={tenPhone}
                  onChange={(e) => setTenPhone(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 py-2.5 rounded-[14px] border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#161920] text-[14.5px] font-medium text-[#111318] dark:text-[#FFFFFF] focus:outline-none focus:border-[#0145F2]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="qa-ten-doc"
                    className="block text-xs font-semibold text-[#626A78] dark:text-[#98A1B2] mb-1"
                  >
                    {t.quickActions.fields.docStatus}
                  </label>
                  <select
                    id="qa-ten-doc"
                    value={tenDocStatus}
                    onChange={(e) => setTenDocStatus(e.target.value as DocumentationStatus)}
                    className="w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="not-provided">
                      {t.domainLabels.docStatuses['not-provided']}
                    </option>
                    <option value="pending-review">
                      {t.domainLabels.docStatuses['pending-review']}
                    </option>
                    <option value="reviewed-but-unverified">
                      {t.domainLabels.docStatuses['reviewed-but-unverified']}
                    </option>
                    <option value="verified">{t.domainLabels.docStatuses.verified}</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-4">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={tenHasSmartphone}
                      onChange={(e) => setTenHasSmartphone(e.target.checked)}
                    />
                    {t.quickActions.fields.smartphone}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={tenHasBank}
                      onChange={(e) => setTenHasBank(e.target.checked)}
                    />
                    {t.quickActions.fields.bank}
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'maintenance' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-mnt-prop"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.property}
                  </label>
                  <select
                    id="qa-mnt-prop"
                    value={mntPropId}
                    onChange={(e) => {
                      setMntPropId(e.target.value);
                      setMntUnitId('');
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="">{contextualActions.context.selectPropertyPrompt}</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="qa-mnt-unit"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.unit}
                  </label>
                  <select
                    id="qa-mnt-unit"
                    value={mntUnitId}
                    onChange={(e) => setMntUnitId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="">{contextualActions.context.optionalUnitNone}</option>
                    {selectableUnitsForMaintenance.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitNumber} — {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="qa-mnt-title"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.issueSummary}
                </label>
                <input
                  id="qa-mnt-title"
                  type="text"
                  required
                  placeholder="e.g. Leaking tap – Unit 3A"
                  value={mntTitle}
                  onChange={(e) => setMntTitle(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-mnt-priority"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.priority}
                  </label>
                  <select
                    id="qa-mnt-priority"
                    value={mntPriority}
                    onChange={(e) => setMntPriority(e.target.value as MaintenancePriority)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="low">{t.quickActions.fields.priorityLow}</option>
                    <option value="medium">{t.quickActions.fields.priorityMedium}</option>
                    <option value="high">{t.quickActions.fields.priorityHigh}</option>
                    <option value="urgent">{t.quickActions.fields.priorityUrgent}</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="qa-mnt-cost"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.estCostZar}
                  </label>
                  <input
                    id="qa-mnt-cost"
                    type="number"
                    step="0.01"
                    value={mntEstRands}
                    onChange={(e) => setMntEstRands(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'notice' && (
            <>
              <div>
                <label
                  htmlFor="qa-not-tenant"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.recipientTenant}
                </label>
                <select
                  id="qa-not-tenant"
                  value={notTenantId}
                  onChange={(e) => {
                    const nextTenantId = e.target.value;
                    setNotTenantId(nextTenantId);
                    if (nextTenantId) {
                      setNotBody(buildReminderMessageForTenant(nextTenantId));
                    }
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                >
                  <option value="">{contextualActions.context.selectTenantPrompt}</option>
                  {tenants.map((ten) => (
                    <option key={ten.id} value={ten.id}>
                      {ten.fullName} ({ten.tenantCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-not-subj"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.noticeSubject}
                  </label>
                  <input
                    id="qa-not-subj"
                    type="text"
                    required
                    value={notSubject}
                    onChange={(e) => setNotSubject(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-not-channel"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.deliveryChannel}
                  </label>
                  <select
                    id="qa-not-channel"
                    value={notChannel}
                    onChange={(e) => setNotChannel(e.target.value as CommunicationChannel)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="whatsapp">{t.quickActions.fields.channelWhatsapp}</option>
                    <option value="sms">{t.quickActions.fields.channelSms}</option>
                    <option value="in_person">{t.quickActions.fields.channelInPerson}</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="qa-not-body"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.noticeMessage}
                </label>
                <textarea
                  id="qa-not-body"
                  rows={3}
                  required
                  value={notBody}
                  onChange={(e) => setNotBody(e.target.value)}
                  className="w-full p-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
            </>
          )}

          {activeTab === 'unit' && (
            <>
              <div>
                <label
                  htmlFor="qa-unit-prop"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.property}
                </label>
                <select
                  id="qa-unit-prop"
                  value={unitPropId}
                  onChange={(e) => setUnitPropId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                >
                  <option value="">{contextualActions.context.selectPropertyPrompt}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-unit-num"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.unitCode}
                  </label>
                  <input
                    id="qa-unit-num"
                    type="text"
                    required
                    placeholder="e.g. Unit 3A"
                    value={unitNumber}
                    onChange={(e) => setUnitNumber(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-unit-name"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.unitName}
                  </label>
                  <input
                    id="qa-unit-name"
                    type="text"
                    required
                    placeholder="e.g. 1-Bed Apartment"
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="qa-unit-rent"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  Standard Monthly Rent (ZAR)
                </label>
                <input
                  id="qa-unit-rent"
                  type="number"
                  step="0.01"
                  value={unitRentRands}
                  onChange={(e) => setUnitRentRands(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                />
              </div>
            </>
          )}

          {activeTab === 'tenancy' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-lse-unit"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.unit}
                  </label>
                  <select
                    id="qa-lse-unit"
                    value={lseUnitId}
                    onChange={(e) => {
                      const nextUnitId = e.target.value;
                      setLseUnitId(nextUnitId);
                      const unitObj = units.find((u) => u.id === nextUnitId);
                      if (unitObj) {
                        const rStr = (unitObj.standardRentCents / 100).toFixed(2);
                        setLseRentRands(rStr);
                        setLseDepositReqRands(rStr);
                      }
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="">{contextualActions.context.selectUnitPrompt}</option>
                    {selectableUnitsForTenancy.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitNumber} — {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="qa-lse-tenant"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.common.tenant}
                  </label>
                  <select
                    id="qa-lse-tenant"
                    value={lseTenantId}
                    onChange={(e) => setLseTenantId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  >
                    <option value="">{contextualActions.context.selectTenantPrompt}</option>
                    {tenants.map((ten) => (
                      <option key={ten.id} value={ten.id}>
                        {ten.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-lse-rent"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.monthlyRentZar}
                  </label>
                  <input
                    id="qa-lse-rent"
                    type="number"
                    step="0.01"
                    value={lseRentRands}
                    onChange={(e) => setLseRentRands(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-lse-start"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.quickActions.fields.startDate}
                  </label>
                  <input
                    id="qa-lse-start"
                    type="date"
                    value={lseStartDate}
                    onChange={(e) => setLseStartDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-lse-dep-req"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    Deposit Required (ZAR)
                  </label>
                  <input
                    id="qa-lse-dep-req"
                    type="number"
                    step="0.01"
                    value={lseDepositReqRands}
                    onChange={(e) => setLseDepositReqRands(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-lse-dep-rec"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    Deposit Received (ZAR)
                  </label>
                  <input
                    id="qa-lse-dep-rec"
                    type="number"
                    step="0.01"
                    value={lseDepositRecRands}
                    onChange={(e) => setLseDepositRecRands(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'expense' && (
            <>
              <div>
                <label
                  htmlFor="qa-exp-prop"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.property}
                </label>
                <select
                  id="qa-exp-prop"
                  value={expPropId}
                  onChange={(e) => setExpPropId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                >
                  <option value="">{contextualActions.context.selectPropertyPrompt}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="qa-exp-desc"
                  className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                >
                  {t.quickActions.fields.expenseDescription}
                </label>
                <input
                  id="qa-exp-desc"
                  type="text"
                  required
                  placeholder="e.g. Municipal Water & Rates"
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="qa-exp-amt"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.payments.amountZarLabel}
                  </label>
                  <input
                    id="qa-exp-amt"
                    type="number"
                    step="0.01"
                    required
                    value={expAmountRands}
                    onChange={(e) => setExpAmountRands(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="qa-exp-date"
                    className="block text-xs font-semibold text-[#111318] dark:text-[#E5E7EB] mb-1"
                  >
                    {t.common.date}
                  </label>
                  <input
                    id="qa-exp-date"
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setActiveTab(originMenu)}
              className="flex-1 h-[46px] rounded-[14px] bg-[#E8EFFA] dark:bg-[#262C36] text-[#0145F2] dark:text-[#E5E7EB] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
            >
              {t.common.back}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-2 h-[46px] px-5 rounded-[14px] bg-[#0145F2] hover:bg-[#0139C9] text-white text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2] disabled:opacity-60"
            >
              {submitting ? t.common.saving : t.common.saveRecord}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
