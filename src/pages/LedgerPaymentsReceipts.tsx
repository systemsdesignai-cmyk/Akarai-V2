import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Download,
  FileText,
  Layers,
  MessageCircle,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
} from 'lucide-react';
import type { QuickAddPrefill, QuickAddTab } from '../components/QuickAddModal';
import { useLanguagePreference } from '../components/DesignSystem';
import type {
  ApplicationSettings,
  Charge,
  DepositLiability,
  LedgerAdjustment,
  Payment,
  PaymentMethod,
  PaymentVerificationStatus,
  Property,
  Receipt,
  Tenancy,
  TenantProfile,
  Unit,
} from '../types/domain';
import {
  applyChargeAdjustment,
  computeTenancyLedgerSummary,
  DuplicatePaymentConfirmationError,
  generateChargeForTenancy,
  logCommunicationEntry,
  recordDepositMovement,
  recordPaymentTransaction,
  reversePaymentTransaction,
} from '../services/domainService';
import { downloadReceiptPDF, downloadTenancyStatementPDF } from '../services/pdfService';
import {
  buildWhatsAppUrl,
  currentPeriodKey,
  formatMonthPeriodLabel,
  formatSADate,
  formatSADateTime,
  formatZAR,
  generateUUID,
  parseZARToCents,
  PAYMENT_METHOD_LABELS,
  PAYMENT_VERIFICATION_LABELS,
  todayIso,
} from '../utils/format';

function formatRandWhole(cents: number): string {
  const rands = Math.round(cents / 100);
  return `R${rands.toLocaleString('en-US')}`;
}

export const RentLedgerScreen: React.FC<{
  tenancies: Tenancy[];
  tenants: TenantProfile[];
  units: Unit[];
  properties: Property[];
  charges: Charge[];
  payments: Payment[];
  adjustments: LedgerAdjustment[];
  deposits: DepositLiability[];
  onNotify: (msg: string) => void;
}> = ({
  tenancies,
  tenants,
  units,
  properties,
  charges,
  payments,
  adjustments,
  deposits,
  onNotify,
}) => {
  const { t, sidebarNav } = useLanguagePreference();
  const [searchParams] = useSearchParams();
  const paramTenancyId = searchParams.get('tenancyId');
  const paramView = searchParams.get('view');

  const [selectedTenancyId, setSelectedTenancyId] = useState<string>(paramTenancyId || 'all');
  const [genPeriodMonth, setGenPeriodMonth] = useState<string>(() => currentPeriodKey());
  const [adjustingCharge, setAdjustingCharge] = useState<Charge | null>(null);
  const [adjType, setAdjType] = useState<'waiver' | 'debit_correction'>('waiver');
  const [adjAmountRands, setAdjAmountRands] = useState('100.00');
  const [adjReason, setAdjReason] = useState('');

  const [reversingPayment, setReversingPayment] = useState<Payment | null>(null);
  const [revReason, setRevReason] = useState('');

  const [managingDeposit, setManagingDeposit] = useState<{
    deposit: DepositLiability;
    label: string;
  } | null>(null);
  const [depMoveType, setDepMoveType] = useState<'receive' | 'deduction' | 'refund'>('receive');
  const [depAmountRands, setDepAmountRands] = useState('500.00');
  const [depReason, setDepReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (paramTenancyId) {
      setSelectedTenancyId(paramTenancyId);
    }
  }, [paramTenancyId]);

  const filteredTenancies =
    selectedTenancyId === 'all' ? tenancies : tenancies.filter((x) => x.id === selectedTenancyId);

  const totalDepositsHeldCents = filteredTenancies.reduce((sum, tenancy) => {
    const summary = computeTenancyLedgerSummary(tenancy.id, charges, payments, adjustments, deposits);
    return sum + summary.depositHeldLiabilityCents;
  }, 0);

  const handleBatchGenerateCharges = async () => {
    if (submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      let createdCount = 0;
      let skippedCount = 0;
      for (const tenancy of filteredTenancies) {
        if (
          tenancy.status === 'active' ||
          tenancy.status === 'notice_given' ||
          tenancy.status === 'renewing'
        ) {
          const res = await generateChargeForTenancy({
            tenancyId: tenancy.id,
            periodMonth: genPeriodMonth,
            includeUtilities: true,
          });
          createdCount += res.createdCharges.length;
          skippedCount += res.skippedDuplicates.length;
        }
      }
      const periodLabel = formatMonthPeriodLabel(genPeriodMonth);
      if (createdCount === 0 && skippedCount > 0) {
        onNotify(`${periodLabel}: all ${skippedCount} charges already billed`);
      } else if (createdCount === 0) {
        onNotify(`${periodLabel}: no active tenancies to bill`);
      } else {
        onNotify(
          `${periodLabel}: generated ${createdCount} charge${createdCount === 1 ? '' : 's'}${
            skippedCount > 0 ? ` (${skippedCount} already billed)` : ''
          }`
        );
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to generate charges.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingCharge || !adjReason.trim() || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await applyChargeAdjustment({
        chargeId: adjustingCharge.id,
        adjustmentType: adjType,
        amountCents: parseZARToCents(adjAmountRands),
        reason: adjReason,
      });
      onNotify(`Adjusted R${adjAmountRands} — "${adjustingCharge.description}"`);
      setAdjustingCharge(null);
      setAdjReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to apply charge adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReversePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingPayment || !revReason.trim() || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const revReceipt = await reversePaymentTransaction(reversingPayment.id, revReason);
      onNotify(`Reversal issued: ${revReceipt.receiptNumber}`);
      setReversingPayment(null);
      setRevReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to reverse payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDepositMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingDeposit || !depReason.trim() || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const updated = await recordDepositMovement({
        depositId: managingDeposit.deposit.id,
        movementType: depMoveType,
        amountCents: parseZARToCents(depAmountRands),
        reason: depReason,
      });
      const held = Math.max(
        0,
        updated.receivedDepositCents +
          updated.accruedInterestCents -
          updated.deductionsCents -
          updated.refundedCents
      );
      onNotify(`Deposit ${depMoveType} recorded · Held liability: ${formatZAR(held)}`);
      setManagingDeposit(null);
      setDepReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to record deposit movement.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="pt-1 space-y-1">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
          {t.payments.ledgerTitle}
        </h1>
        <p className="text-[13px] text-[#4B5563] dark:text-[#C4C9D1]">
          {t.payments.ledgerSubtitle}
        </p>
      </div>

      {/* Monthly Billing Generator Card */}
      <div className="rounded-[20px] p-4 bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[10px] bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF] flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[13.5px] font-bold text-[#111318] dark:text-white">
                Monthly Rent Billing
              </div>
              <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                Safe &amp; idempotent — duplicates are automatically skipped
              </div>
            </div>
          </div>
          <Link
            to="/payments/new"
            className="min-h-[38px] px-3 rounded-full bg-[#D9F7E4] dark:bg-[#0D3820] text-[#059D23] dark:text-[#2CE058] text-[12px] font-semibold inline-flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Log Pay
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={genPeriodMonth}
            onChange={(e) => setGenPeriodMonth(e.target.value)}
            className="min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[12.5px] font-mono text-[#111318] dark:text-white"
            aria-label={t.payments.colPeriodKey}
          />
          <button
            type="button"
            disabled={submitting}
            onClick={handleBatchGenerateCharges}
            className="flex-1 min-h-[44px] px-4 rounded-[14px] bg-[#0145F2] hover:bg-[#0039CC] text-white text-[12.5px] font-semibold disabled:opacity-60"
          >
            {submitting
              ? t.common.saving
              : `Generate ${formatMonthPeriodLabel(genPeriodMonth)} Rent`}
          </button>
        </div>
      </div>

      {/* Tenancy Filter Selector */}
      <select
        value={selectedTenancyId}
        onChange={(e) => setSelectedTenancyId(e.target.value)}
        className="w-full min-h-[44px] px-3.5 rounded-[16px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#FFFFFF] dark:bg-[#171A1F] text-[13px] font-semibold text-[#111318] dark:text-white"
      >
        <option value="all">
          {t.payments.allActiveTenancies} ({tenancies.length})
        </option>
        {tenancies.map((tenancy) => {
          const tenant = tenants.find((x) => x.id === tenancy.primaryTenantId);
          const unit = units.find((u) => u.id === tenancy.unitId);
          return (
            <option key={tenancy.id} value={tenancy.id}>
              {tenancy.tenancyReference} — {tenant?.fullName} ({unit?.unitNumber})
            </option>
          );
        })}
      </select>

      {actionError && !adjustingCharge && !reversingPayment && !managingDeposit && (
        <div
          role="alert"
          className="p-3 rounded-[14px] bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-xs text-[#E5252A] dark:text-[#FF7A82]"
        >
          {actionError}
        </div>
      )}

      {paramView === 'deposits' && (
        <div className="p-4 rounded-[20px] bg-[#E7F0FF] dark:bg-[#132247] border border-[#0145F2]/25 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#0145F2] dark:text-[#68A2FF]">
              {sidebarNav.items.deposits}
            </div>
            <div className="text-[14px] font-bold text-[#111318] dark:text-white mt-0.5">
              {t.payments.depositHeldLiabilityPrefix} ({filteredTenancies.length})
            </div>
            <div className="text-[11px] text-[#4B5563] dark:text-[#C4C9D1] mt-0.5">
              Held strictly as tenant liability — never mixed into rental income.
            </div>
          </div>
          <div className="text-[18px] font-mono font-bold tabular-nums text-[#0145F2] dark:text-[#68A2FF] shrink-0">
            {formatZAR(totalDepositsHeldCents)}
          </div>
        </div>
      )}

      {/* Per-Tenancy Mobile-First Ledger Cards */}
      {filteredTenancies.length === 0 ? (
        <div className="rounded-[20px] p-6 bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] text-center text-xs text-[#626A78] dark:text-[#98A1B2]">
          No tenancies in the ledger yet. Create a tenancy to begin tracking rent charges and payments.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTenancies.map((tenancy) => {
            const tenant = tenants.find((x) => x.id === tenancy.primaryTenantId);
            const unit = units.find((u) => u.id === tenancy.unitId);
            const property = properties.find((p) => p.id === tenancy.propertyId);
            const summary = computeTenancyLedgerSummary(
              tenancy.id,
              charges,
              payments,
              adjustments,
              deposits
            );
            const tenancyCharges = charges
              .filter((c) => c.tenancyId === tenancy.id && !c.isDeleted)
              .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
            const tenancyPayments = payments
              .filter((p) => p.tenancyId === tenancy.id && !p.isDeleted)
              .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
            const tenancyDeposit = deposits.find((d) => d.tenancyId === tenancy.id);

            return (
              <div
                key={tenancy.id}
                className="rounded-[22px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] overflow-hidden"
              >
                {/* Tenancy Header */}
                <div className="p-4 bg-[#F9FBFE] dark:bg-[#1B1F26] border-b border-[#E6ECF3] dark:border-[#262B31] space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/tenancies/${tenancy.id}`}
                        className="text-[16px] font-bold text-[#111318] dark:text-white hover:text-[#0145F2] block truncate"
                      >
                        {tenant?.fullName || 'Tenant'} — {unit?.unitNumber || 'Unit'}
                      </Link>
                      <div className="text-[11.5px] text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                        {property?.name} · <span className="font-mono">{tenancy.tenancyReference}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        downloadTenancyStatementPDF({
                          tenancy,
                          tenant,
                          propertyUnitLabel: `${property?.name || ''} — ${unit?.unitNumber || ''}`,
                          summary,
                          charges: tenancyCharges,
                          payments: tenancyPayments,
                        })
                      }
                      className="min-h-[36px] px-3 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF] text-[11.5px] font-semibold inline-flex items-center gap-1 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t.payments.statementBtn}
                    </button>
                  </div>

                  {/* Derived Totals Grid */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-[12px] p-2.5 bg-[#FFFFFF] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31]">
                      <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                        {t.payments.chargedLabel}
                      </div>
                      <div className="font-mono font-bold tabular-nums text-[#111318] dark:text-white mt-0.5">
                        {formatZAR(summary.totalChargedCents)}
                      </div>
                    </div>
                    <div className="rounded-[12px] p-2.5 bg-[#FFFFFF] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31]">
                      <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                        {t.payments.allocatedPaidLabel}
                      </div>
                      <div className="font-mono font-bold tabular-nums text-[#059D23] dark:text-[#2CE058] mt-0.5">
                        {formatZAR(summary.totalAllocatedPaidCents)}
                      </div>
                    </div>
                    <div className="rounded-[12px] p-2.5 bg-[#FFFFFF] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31]">
                      <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                        {t.payments.derivedBalanceLabel}
                      </div>
                      <div
                        className={`font-mono font-bold tabular-nums mt-0.5 ${
                          summary.netBalanceDueCents > 0
                            ? 'text-[#E5252A] dark:text-[#FF7A82]'
                            : 'text-[#059D23] dark:text-[#2CE058]'
                        }`}
                      >
                        {summary.netBalanceDueCents > 0
                          ? formatZAR(summary.netBalanceDueCents)
                          : summary.netBalanceDueCents < 0
                            ? `${formatZAR(Math.abs(summary.netBalanceDueCents))} Cr`
                            : 'R 0.00'}
                      </div>
                    </div>
                  </div>

                  {/* Deposit Liability Bar + Quick Log Payment */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] pt-0.5">
                    <div className="flex items-center gap-2 text-[#4B5563] dark:text-[#C4C9D1]">
                      <Shield className="w-3.5 h-3.5 text-[#0145F2] dark:text-[#5CA2FF]" />
                      <span>
                        Deposit Held:{' '}
                        <strong className="font-mono tabular-nums text-[#111318] dark:text-white">
                          {formatZAR(summary.depositHeldLiabilityCents)}
                        </strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {tenancyDeposit && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setDepMoveType(
                              summary.depositHeldLiabilityCents > 0 ? 'refund' : 'receive'
                            );
                            setDepAmountRands(
                              summary.depositHeldLiabilityCents > 0
                                ? (summary.depositHeldLiabilityCents / 100).toFixed(2)
                                : '500.00'
                            );
                            setDepReason('');
                            setManagingDeposit({
                              deposit: tenancyDeposit,
                              label: `${tenant?.fullName || 'Tenant'} — ${unit?.unitNumber || ''}`,
                            });
                          }}
                          className="min-h-[34px] px-2.5 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF] font-semibold"
                        >
                          Manage Deposit
                        </button>
                      )}
                      <Link
                        to={`/payments/new?tenancyId=${tenancy.id}`}
                        className="min-h-[34px] px-3 rounded-full bg-[#0145F2] text-white font-semibold inline-flex items-center"
                      >
                        Log Payment
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Mobile-First Charges List */}
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#626A78] dark:text-[#98A1B2]">
                      {t.payments.chargesAdjustmentsHeading} ({tenancyCharges.length})
                    </h3>
                    {tenancyCharges.length === 0 ? (
                      <div className="text-xs text-[#626A78] dark:text-[#98A1B2] py-2">
                        No charges billed yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {tenancyCharges.map((c) => {
                          const netRem = Math.max(
                            0,
                            c.amountCents + c.adjustedCents - c.allocatedPaidCents
                          );
                          const isPaid = c.status === 'paid' || netRem === 0;
                          const isOverdue = !isPaid && (c.status === 'overdue' || c.dueDate < todayIso());

                          return (
                            <div
                              key={c.id}
                              className="p-3 rounded-[14px] bg-[#F5F7FA] dark:bg-[#1E222A] border border-[#E6ECF3] dark:border-[#262B31] space-y-2 text-xs"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-bold text-[#111318] dark:text-white truncate">
                                    {c.description}
                                  </div>
                                  <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                                    Due {formatSADate(c.dueDate)} ·{' '}
                                    <span className="font-mono">{c.periodKey}</span>
                                  </div>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 ${
                                    isPaid
                                      ? 'bg-[#D9F7E4] dark:bg-[#0D3820] text-[#059D23] dark:text-[#2CE058]'
                                      : isOverdue
                                        ? 'bg-[#FEE2E4] dark:bg-[#471D23] text-[#E5252A] dark:text-[#FF7A82]'
                                        : 'bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF]'
                                  }`}
                                >
                                  {c.status}
                                </span>
                              </div>

                              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#E6ECF3] dark:border-[#262B31]">
                                <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
                                  <span className="text-[#4B5563] dark:text-[#C4C9D1]">
                                    Billed: <strong>{formatZAR(c.amountCents)}</strong>
                                  </span>
                                  <span className="text-[#059D23] dark:text-[#2CE058]">
                                    Paid: <strong>{formatZAR(c.allocatedPaidCents)}</strong>
                                  </span>
                                  {netRem > 0 && (
                                    <span className="text-[#E5252A] dark:text-[#FF7A82]">
                                      Rem: <strong>{formatZAR(netRem)}</strong>
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionError(null);
                                    setAdjustingCharge(c);
                                  }}
                                  className="text-[11.5px] font-semibold text-[#0145F2] dark:text-[#5CA2FF] hover:underline shrink-0"
                                >
                                  {t.payments.waiveAdjustBtn}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Mobile-First Payments List */}
                  {tenancyPayments.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-[#E6ECF3] dark:border-[#262B31]">
                      <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#626A78] dark:text-[#98A1B2]">
                        {t.payments.recordedPaymentsReversalsHeading} ({tenancyPayments.length})
                      </h3>
                      <div className="space-y-2">
                        {tenancyPayments.map((p) => (
                          <div
                            key={p.id}
                            className="p-3 rounded-[14px] bg-[#F5F7FA] dark:bg-[#1E222A] border border-[#E6ECF3] dark:border-[#262B31] flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-[#111318] dark:text-white truncate">
                                {t.domainLabels.paymentMethods[p.method] ||
                                  PAYMENT_METHOD_LABELS[p.method]}
                                {p.externalReference ? ` · ${p.externalReference}` : ''}
                              </div>
                              <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                                {formatSADate(p.transactionDate)} · {p.recordedByName}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span
                                className={`font-mono font-bold tabular-nums ${
                                  p.verificationStatus === 'reversed'
                                    ? 'line-through text-[#626A78]'
                                    : 'text-[#059D23] dark:text-[#2CE058]'
                                }`}
                              >
                                {formatZAR(p.amountCents)}
                              </span>
                              {p.verificationStatus !== 'reversed' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionError(null);
                                    setReversingPayment(p);
                                  }}
                                  className="text-[#E5252A] dark:text-[#FF7A82] font-semibold inline-flex items-center gap-1 hover:underline"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  {t.payments.reverseBtn}
                                </button>
                              ) : (
                                <span className="text-[11px] text-[#626A78]">
                                  {t.payments.reversedLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Charge Waiver / Adjustment Modal */}
      {adjustingCharge && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3">
          <form
            onSubmit={handleApplyAdjustment}
            className="w-full max-w-[420px] rounded-[24px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-5 space-y-4 text-xs"
          >
            <div>
              <h3 className="text-[16px] font-bold text-[#111318] dark:text-white">
                {t.payments.adjustModalTitle}
              </h3>
              <p className="text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                {adjustingCharge.description}
              </p>
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.adjustmentTypeLabel}
              </label>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as 'waiver' | 'debit_correction')}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              >
                <option value="waiver">{t.payments.creditWaiverOption}</option>
                <option value="debit_correction">{t.payments.debitCorrectionOption}</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.amountZarLabel}
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={adjAmountRands}
                onChange={(e) => setAdjAmountRands(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] font-mono text-[#111318] dark:text-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.auditReasonLabel}
              </label>
              <input
                type="text"
                required
                placeholder={t.payments.auditReasonPlaceholder}
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              />
            </div>
            {actionError && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-[#E5252A] dark:text-[#FF7A82]"
              >
                {actionError}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setAdjustingCharge(null);
                  setActionError(null);
                }}
                className="flex-1 min-h-[44px] rounded-full border border-[#E6ECF3] dark:border-[#262B31] font-semibold text-[#111318] dark:text-white"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[44px] rounded-full bg-[#0145F2] text-white font-semibold disabled:opacity-60"
              >
                {submitting ? t.common.saving : t.payments.applyAdjustmentBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Payment Reversal Modal */}
      {reversingPayment && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3">
          <form
            onSubmit={handleReversePayment}
            className="w-full max-w-[420px] rounded-[24px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-5 space-y-4 text-xs"
          >
            <h3 className="text-[16px] font-bold text-[#E5252A] dark:text-[#FF7A82]">
              {t.payments.reverseModalTitle}
            </h3>
            <p className="text-[#4B5563] dark:text-[#C4C9D1]">
              {formatZAR(reversingPayment.amountCents)} (
              {t.domainLabels.paymentMethods[reversingPayment.method] ||
                PAYMENT_METHOD_LABELS[reversingPayment.method]}
              ) — {t.payments.reverseModalDesc}
            </p>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.reversalReasonLabel}
              </label>
              <input
                type="text"
                required
                placeholder={t.payments.reversalReasonPlaceholder}
                value={revReason}
                onChange={(e) => setRevReason(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              />
            </div>
            {actionError && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-[#E5252A] dark:text-[#FF7A82]"
              >
                {actionError}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setReversingPayment(null);
                  setActionError(null);
                }}
                className="flex-1 min-h-[44px] rounded-full border border-[#E6ECF3] dark:border-[#262B31] font-semibold text-[#111318] dark:text-white"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[44px] rounded-full bg-[#E5252A] text-white font-semibold disabled:opacity-60"
              >
                {submitting ? t.common.saving : t.payments.confirmReversalBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Deposit Liability Movement Modal */}
      {managingDeposit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3">
          <form
            onSubmit={handleDepositMovement}
            className="w-full max-w-[420px] rounded-[24px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-5 space-y-4 text-xs"
          >
            <div>
              <h3 className="text-[16px] font-bold text-[#111318] dark:text-white">
                Manage Deposit Liability
              </h3>
              <p className="text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                {managingDeposit.label} · Held:{' '}
                <strong className="font-mono text-[#111318] dark:text-white">
                  {formatZAR(
                    Math.max(
                      0,
                      managingDeposit.deposit.receivedDepositCents +
                        managingDeposit.deposit.accruedInterestCents -
                        managingDeposit.deposit.deductionsCents -
                        managingDeposit.deposit.refundedCents
                    )
                  )}
                </strong>
              </p>
              <p className="text-[11px] text-[#0145F2] dark:text-[#5CA2FF] mt-1">
                Deposits are held as tenant liabilities and never counted as rental income.
              </p>
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                Movement Type
              </label>
              <select
                value={depMoveType}
                onChange={(e) =>
                  setDepMoveType(e.target.value as 'receive' | 'deduction' | 'refund')
                }
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              >
                <option value="receive">Receive Deposit Instalment (+Liability)</option>
                <option value="deduction">Record Validated Deduction (-Liability)</option>
                <option value="refund">Record Tenant Refund (-Liability)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.amountZarLabel}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={depAmountRands}
                onChange={(e) => setDepAmountRands(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] font-mono text-[#111318] dark:text-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.auditReasonLabel}
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Move-out key return refund / Paint repair deduction"
                value={depReason}
                onChange={(e) => setDepReason(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              />
            </div>
            {actionError && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-[#E5252A] dark:text-[#FF7A82]"
              >
                {actionError}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setManagingDeposit(null);
                  setActionError(null);
                }}
                className="flex-1 min-h-[44px] rounded-full border border-[#E6ECF3] dark:border-[#262B31] font-semibold text-[#111318] dark:text-white"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[44px] rounded-full bg-[#0145F2] text-white font-semibold disabled:opacity-60"
              >
                {submitting ? t.common.saving : 'Save Deposit Entry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const RecordPaymentScreen: React.FC<{
  tenancies: Tenancy[];
  tenants: TenantProfile[];
  units: Unit[];
  charges?: Charge[];
  payments?: Payment[];
  adjustments?: LedgerAdjustment[];
  deposits?: DepositLiability[];
  onNotify: (msg: string) => void;
}> = ({
  tenancies,
  tenants,
  units,
  charges = [],
  payments = [],
  adjustments = [],
  deposits = [],
  onNotify,
}) => {
  const { t } = useLanguagePreference();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const paramTenancyId = searchParams.get('tenancyId');

  const [tenancyId, setTenancyId] = useState(paramTenancyId || tenancies[0]?.id || '');
  const [amountRands, setAmountRands] = useState('');
  const [txDate, setTxDate] = useState(() => todayIso());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [verification, setVerification] = useState<PaymentVerificationStatus>('landlord-reported');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [opToken, setOpToken] = useState<string>(() => generateUUID());
  const [pendingDuplicateConfirm, setPendingDuplicateConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (paramTenancyId) {
      setTenancyId(paramTenancyId);
    } else if (!tenancyId && tenancies[0]?.id) {
      setTenancyId(tenancies[0].id);
    }
  }, [paramTenancyId, tenancies, tenancyId]);

  const selectedTenancy = tenancies.find((x) => x.id === tenancyId) || tenancies[0];
  const selectedSummary = selectedTenancy
    ? computeTenancyLedgerSummary(selectedTenancy.id, charges, payments, adjustments, deposits)
    : undefined;

  // Auto-fill exact unpaid balance (or monthly rent) whenever tenancy changes
  useEffect(() => {
    if (!selectedTenancy) return;
    const dueCents = selectedSummary ? Math.max(0, selectedSummary.netBalanceDueCents) : 0;
    const defaultCents = dueCents > 0 ? dueCents : selectedTenancy.rentAmountCents;
    setAmountRands((defaultCents / 100).toFixed(2));
  }, [selectedTenancy?.id]);

  useEffect(() => {
    setOpToken(generateUUID());
    setPendingDuplicateConfirm(null);
  }, [tenancyId, amountRands, txDate, method, reference]);

  const enteredCents = Math.max(0, parseZARToCents(amountRands || '0'));
  const balanceBeforeCents = selectedSummary ? selectedSummary.netBalanceDueCents : 0;
  const balanceAfterCents = balanceBeforeCents - enteredCents;

  const executeRecord = async (confirmDistinctDuplicate: boolean) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const targetId = tenancyId || tenancies[0]?.id;
      if (!targetId) throw new Error('Select a tenancy');
      const { receipt } = await recordPaymentTransaction({
        tenancyId: targetId,
        amountCents: parseZARToCents(amountRands),
        transactionDate: txDate,
        method,
        verificationStatus: verification,
        externalReference: reference,
        notes,
        idempotencyToken: confirmDistinctDuplicate ? generateUUID() : opToken,
        confirmDistinctDuplicate,
      });
      setPendingDuplicateConfirm(null);
      onNotify(`Receipt issued: ${receipt.receiptNumber}`);
      navigate(`/receipts/${receipt.id}`);
    } catch (err) {
      if (err instanceof DuplicatePaymentConfirmationError) {
        setPendingDuplicateConfirm(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Could not record payment');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeRecord(false);
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-2 text-xs text-[#626A78] dark:text-[#98A1B2]">
        <Link
          to="/ledger"
          className="min-h-[36px] inline-flex items-center gap-1.5 font-semibold hover:text-[#0145F2]"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.payments.backToLedgerLink}
        </Link>
      </div>

      <div className="p-4 rounded-[22px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] space-y-4">
        <div>
          <h1 className="text-[20px] font-bold text-[#111318] dark:text-[#FFFFFF]">
            {t.payments.recordExternalTitle}
          </h1>
          <p className="text-[12px] text-[#626A78] dark:text-[#98A1B2] mt-1 leading-relaxed">
            {t.payments.recordExternalDesc}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-[14px] bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-xs text-[#E5252A] dark:text-[#FF7A82]"
          >
            {error}
          </div>
        )}

        {pendingDuplicateConfirm && (
          <div
            role="alert"
            className="p-3.5 rounded-[16px] bg-[#FEF2D6] dark:bg-[#3A2B12] border border-[#F5A623]/40 text-xs text-[#7A4B00] dark:text-[#FFD479] space-y-2.5"
          >
            <div className="font-bold">Possible Duplicate Same-Day Payment</div>
            <p className="leading-relaxed">{pendingDuplicateConfirm}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => executeRecord(true)}
                className="min-h-[40px] px-4 rounded-full bg-[#0145F2] text-white font-semibold disabled:opacity-60"
              >
                {submitting ? t.common.saving : 'Confirm Distinct Payment'}
              </button>
              <button
                type="button"
                onClick={() => setPendingDuplicateConfirm(null)}
                className="min-h-[40px] px-4 rounded-full border border-[#A96B00]/30 font-semibold"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
              {t.payments.tenancyTenantUnitLabel}
            </label>
            <select
              value={tenancyId}
              onChange={(e) => setTenancyId(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
            >
              {tenancies.map((tenancy) => {
                const tenant = tenants.find((x) => x.id === tenancy.primaryTenantId);
                const unit = units.find((u) => u.id === tenancy.unitId);
                return (
                  <option key={tenancy.id} value={tenancy.id}>
                    {tenancy.tenancyReference} — {tenant?.fullName} ({unit?.unitNumber})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Live Balance Before -> After Preview */}
          {selectedTenancy && selectedSummary && (
            <div className="p-3 rounded-[16px] bg-[#F5F7FA] dark:bg-[#1E222A] border border-[#E6ECF3] dark:border-[#262B31] space-y-2.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[#626A78] dark:text-[#98A1B2]">Balance Before → After</span>
                <span className="font-mono font-bold tabular-nums">
                  <span className="text-[#111318] dark:text-white">
                    {formatZAR(Math.max(0, balanceBeforeCents))}
                  </span>{' '}
                  →{' '}
                  <span
                    className={
                      balanceAfterCents > 0
                        ? 'text-[#E5252A] dark:text-[#FF7A82]'
                        : 'text-[#059D23] dark:text-[#2CE058]'
                    }
                  >
                    {balanceAfterCents >= 0
                      ? formatZAR(balanceAfterCents)
                      : `${formatZAR(Math.abs(balanceAfterCents))} Credit`}
                  </span>
                </span>
              </div>

              {/* 1-Tap Quick Amount Chips */}
              <div className="flex flex-wrap gap-1.5">
                {balanceBeforeCents > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmountRands((balanceBeforeCents / 100).toFixed(2))}
                    className="min-h-[34px] px-3 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF] font-semibold"
                  >
                    Full Due ({formatRandWhole(balanceBeforeCents)})
                  </button>
                )}
                {balanceBeforeCents > 100 && (
                  <button
                    type="button"
                    onClick={() => setAmountRands((Math.round(balanceBeforeCents / 2) / 100).toFixed(2))}
                    className="min-h-[34px] px-3 rounded-full bg-[#FFFFFF] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] text-[#111318] dark:text-white font-semibold"
                  >
                    Half ({formatRandWhole(Math.round(balanceBeforeCents / 2))})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAmountRands((selectedTenancy.rentAmountCents / 100).toFixed(2))}
                  className="min-h-[34px] px-3 rounded-full bg-[#FFFFFF] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] text-[#111318] dark:text-white font-semibold"
                >
                  1 Mo Rent ({formatRandWhole(selectedTenancy.rentAmountCents)})
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.amountReceivedZarLabel}
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={amountRands}
                onChange={(e) => setAmountRands(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] font-mono text-sm text-[#111318] dark:text-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.transactionDateLabel}
              </label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.paymentMethodLabel}
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
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
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.payments.settlementVerificationLabel}
              </label>
              <select
                value={verification}
                onChange={(e) => setVerification(e.target.value as PaymentVerificationStatus)}
                className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              >
                <option value="landlord-reported">
                  {t.domainLabels.verificationStatuses['landlord-reported']}
                </option>
                <option value="evidence-attached">
                  {t.domainLabels.verificationStatuses['evidence-attached']}
                </option>
                <option value="reconciled">
                  {t.domainLabels.verificationStatuses.reconciled}
                </option>
                <option value="disputed">{t.domainLabels.verificationStatuses.disputed}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
              {t.payments.bankCashRefLabel}
            </label>
            <input
              type="text"
              placeholder={t.payments.bankCashRefPlaceholder}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
              {t.common.notes}
            </label>
            <input
              type="text"
              placeholder={t.payments.optionalReceiptNotePlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
            />
          </div>

          <div className="pt-2 flex gap-2.5">
            <Link
              to="/ledger"
              className="flex-1 min-h-[44px] px-4 rounded-full border border-[#E6ECF3] dark:border-[#262B31] flex items-center justify-center font-semibold text-[#111318] dark:text-white"
            >
              {t.common.cancel}
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 min-h-[44px] px-5 rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-white font-semibold disabled:opacity-60"
            >
              {submitting ? t.common.saving : t.payments.recordIssueReceiptBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

type PaymentsFilterTab = 'overview' | 'received' | 'pending' | 'overdue';

export const ReceiptsScreen: React.FC<{
  settings?: ApplicationSettings;
  receipts: Receipt[];
  payments: Payment[];
  charges?: Charge[];
  tenancies?: Tenancy[];
  tenants?: TenantProfile[];
  units?: Unit[];
  deposits?: DepositLiability[];
  onOpenQuickAdd?: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
}> = ({
  receipts,
  payments,
  charges = [],
  tenants = [],
  units = [],
  deposits = [],
  onOpenQuickAdd,
}) => {
  const { currentLanguage, t } = useLanguagePreference();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PaymentsFilterTab>('overview');
  const [showStatementsDrawer, setShowStatementsDrawer] = useState(false);

  const today = todayIso();

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (
      tabParam === 'overdue' ||
      tabParam === 'received' ||
      tabParam === 'pending' ||
      tabParam === 'overview'
    ) {
      setActiveTab(tabParam);
      setShowStatementsDrawer(false);
    } else if (tabParam === 'statements') {
      setShowStatementsDrawer(true);
    }
  }, [searchParams]);

  const filterTabs: { id: PaymentsFilterTab; label: string }[] = [
    { id: 'overview', label: t.payments.tabOverview },
    { id: 'received', label: t.payments.tabReceived },
    { id: 'pending', label: t.payments.tabPending },
    { id: 'overdue', label: t.payments.tabOverdue },
  ];

  const overdueCharges = charges.filter(
    (c) =>
      !c.isDeleted &&
      c.status !== 'reversed' &&
      c.status !== 'paid' &&
      c.status !== 'waived' &&
      Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents) > 0 &&
      (c.status === 'overdue' || c.dueDate < today)
  );

  const pendingCharges = charges.filter(
    (c) =>
      !c.isDeleted &&
      c.status !== 'reversed' &&
      c.status !== 'paid' &&
      c.status !== 'waived' &&
      Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents) > 0 &&
      c.status !== 'overdue' &&
      c.dueDate >= today
  );

  const validPayments = payments.filter((p) => !p.isDeleted && p.verificationStatus !== 'reversed');
  const liveCollectedCents = validPayments.reduce((sum, p) => sum + p.amountCents, 0);
  const liveOverdueCents = overdueCharges.reduce(
    (sum, c) => sum + Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents),
    0
  );
  const livePendingCents = pendingCharges.reduce(
    (sum, c) => sum + Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents),
    0
  );
  const liveDepositsHeldCents = deposits.reduce(
    (sum, d) =>
      sum +
      Math.max(
        0,
        d.receivedDepositCents + d.accruedInterestCents - d.deductionsCents - d.refundedCents
      ),
    0
  );

  const totalBilledCents = charges
    .filter((c) => !c.isDeleted && c.status !== 'reversed' && c.status !== 'waived')
    .reduce((sum, c) => sum + Math.max(0, c.amountCents + c.adjustedCents), 0);
  const collectionPct =
    totalBilledCents > 0
      ? Math.min(100, Math.round((liveCollectedCents / totalBilledCents) * 100))
      : 0;

  // Sort real receipts newest first
  const sortedReceipts = [...receipts].sort((a, b) =>
    (b.issuedAt || b.transactionDate).localeCompare(a.issuedAt || a.transactionDate)
  );

  const recentCards = sortedReceipts.slice(0, 6).map((r, idx) => ({
    id: r.id,
    receiptId: r.id,
    isReversal: r.isCorrectionOrReversal,
    initials: r.tenantName
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
    avatarClass:
      idx % 2 === 0
        ? 'bg-[#DAE9FD] text-[#0145F2] dark:bg-[#22344D] dark:text-[#FFFFFF]'
        : 'bg-[#EFEDFD] text-[#4C35B5] dark:bg-[#313355] dark:text-[#FFFFFF]',
    name: r.tenantName,
    sublabel: `${r.propertyUnitLabel.split('—').pop()?.trim() || 'Unit'} • ${formatSADate(r.transactionDate)}`,
    amountText: `${r.isCorrectionOrReversal ? '-' : '+'}${formatRandWhole(Math.abs(r.amountCents))}`,
  }));

  return (
    <div className="w-full space-y-3.5 pb-28 relative">
      {/* Page Heading */}
      <div className="pt-1">
        <h1 className="text-[31px] leading-[1.12] font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
          {currentLanguage.uiStrings.paymentsTitle}
        </h1>
        <p className="text-[14.2px] leading-[1.35] text-[#374151] dark:text-[#C4C9D1] mt-1">
          {currentLanguage.uiStrings.paymentsSubtitle}
        </p>
      </div>

      {/* 4 Filter Pills: Overview | Received | Pending | Overdue */}
      <div
        role="tablist"
        aria-label={currentLanguage.uiStrings.paymentsTitle}
        className="grid grid-cols-4 gap-2 pt-0.5"
      >
        {filterTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActiveTab(tab.id);
                setShowStatementsDrawer(false);
              }}
              className={`min-h-[44px] px-2 rounded-full text-[13px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center ${
                isActive
                  ? 'bg-[#0145F2] text-[#FFFFFF] border border-[#0145F2] shadow-[0_2px_8px_rgba(1,69,242,0.25)]'
                  : 'bg-[#F9FBFE] dark:bg-[#171A20] text-[#111318] dark:text-[#E5E7EB] border border-[#E4E9F0] dark:border-[#262B32] shadow-[0_1px_4px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Truthful Live Rental Income Hero Card */}
      <div className="rounded-[22px] px-4 py-3.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#374151] dark:text-[#D1D5DB]">
            {formatMonthPeriodLabel(currentPeriodKey())} · Collected
          </div>
          <div className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em] tabular-nums text-[#111318] dark:text-[#FFFFFF] mt-1">
            {formatRandWhole(liveCollectedCents)}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-[#D9F7E4] dark:bg-[#0B3B21] text-[#059E23] dark:text-[#2CE058] text-[12px] font-semibold leading-none tabular-nums">
              {collectionPct}%
            </span>
            <span className="text-[12px] text-[#374151] dark:text-[#C4C9D1] tabular-nums">
              {validPayments.length} {validPayments.length === 1 ? 'payment' : 'payments'} recorded
            </span>
          </div>
        </div>

        {/* Visual Collection Progress Bars */}
        <div className="flex items-end gap-[7px] h-[54px] pt-1 pr-0.5 shrink-0" aria-hidden="true">
          <div className="w-[14px] h-[14px] rounded-[4px] bg-[#A6C8FC] dark:bg-[#083A8C]" />
          <div className="w-[14px] h-[22px] rounded-[4px] bg-[#7FB0FA] dark:bg-[#0A4CB5]" />
          <div className="w-[14px] h-[32px] rounded-[4px] bg-[#5795F8] dark:bg-[#0D5ED8]" />
          <div className="w-[14px] h-[42px] rounded-[4px] bg-[#2C72F5] dark:bg-[#156EEF]" />
          <div className="w-[14px] h-[52px] rounded-[4px] bg-[#0145F2] dark:bg-[#1D7AFC]" />
        </div>
      </div>

      {/* 3-Column Live Summary Cards: Received | Pending | Overdue */}
      <div className="grid grid-cols-3 gap-2.5 pt-0.5">
        <button
          type="button"
          onClick={() => setActiveTab('received')}
          className="rounded-[20px] py-3 px-2 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] flex flex-col items-center justify-center text-center min-h-[94px] transition-transform active:scale-[0.99]"
        >
          <CheckCircle2 className="w-[22px] h-[22px] text-[#12A138] dark:text-[#25D35A] stroke-[2] shrink-0" />
          <div className="text-[16.5px] leading-tight font-bold tabular-nums tracking-[-0.015em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {formatRandWhole(liveCollectedCents)}
          </div>
          <div className="text-[12px] text-[#374151] dark:text-[#C4C9D1] mt-0.5 font-normal">
            {t.payments.receivedLabel}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className="rounded-[20px] py-3 px-2 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] flex flex-col items-center justify-center text-center min-h-[94px] transition-transform active:scale-[0.99]"
        >
          <Clock className="w-[22px] h-[22px] text-[#0145F2] dark:text-[#1D7AFC] stroke-[2] shrink-0" />
          <div className="text-[16.5px] leading-tight font-bold tabular-nums tracking-[-0.015em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {formatRandWhole(livePendingCents)}
          </div>
          <div className="text-[12px] text-[#374151] dark:text-[#C4C9D1] mt-0.5 font-normal">
            {t.payments.pendingLabel}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('overdue')}
          className={`rounded-[20px] py-3 px-2 border flex flex-col items-center justify-center text-center min-h-[94px] transition-transform active:scale-[0.99] ${
            liveOverdueCents > 0
              ? 'bg-[#FFEEF0] dark:bg-[#2A171B] border-[#FAD6DA] dark:border-[#462127]'
              : 'bg-[#F9FBFE] dark:bg-[#15181C] border-[#E6ECF3] dark:border-[#262B31]'
          }`}
        >
          <AlertTriangle
            className={`w-[22px] h-[22px] stroke-[2] shrink-0 ${
              liveOverdueCents > 0
                ? 'text-[#E5252A] dark:text-[#F85A5A]'
                : 'text-[#6B7280] dark:text-[#9CA3AF]'
            }`}
          />
          <div className="text-[16.5px] leading-tight font-bold tabular-nums tracking-[-0.015em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {formatRandWhole(liveOverdueCents)}
          </div>
          <div
            className={`text-[12px] mt-0.5 font-medium ${
              liveOverdueCents > 0
                ? 'text-[#E5252A] dark:text-[#F85A5A]'
                : 'text-[#374151] dark:text-[#C4C9D1]'
            }`}
          >
            {t.payments.overdueLabel}
          </div>
        </button>
      </div>

      {/* Navigation Rows: Upcoming | Rent Ledger | Deposits Liability | Statements */}
      <div className="space-y-2 pt-0.5">
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className="w-full rounded-[18px] px-3.5 py-2.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[36px] h-[36px] rounded-[11px] bg-[#EBF2FE] dark:bg-[#21262D] flex items-center justify-center text-[#0145F2] dark:text-[#5CA2FF] shrink-0">
              <Calendar className="w-[19px] h-[19px] stroke-[2]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-tight">
                {t.payments.upcomingPaymentsTitle}
              </div>
              <div className="text-[12px] text-[#374151] dark:text-[#B8C0CC] truncate mt-0.5">
                {pendingCharges.length} due · {overdueCharges.length} overdue
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[15px] font-bold tabular-nums text-[#111318] dark:text-[#FFFFFF]">
              {formatRandWhole(livePendingCents + liveOverdueCents)}
            </span>
            <ChevronRight className="w-[16px] h-[16px] text-[#4B5563] dark:text-[#9CA3AF] stroke-[2]" />
          </div>
        </button>

        <Link
          to="/ledger"
          className="w-full rounded-[18px] px-3.5 py-2.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[36px] h-[36px] rounded-[11px] bg-[#EBF2FE] dark:bg-[#21262D] flex items-center justify-center text-[#0145F2] dark:text-[#5CA2FF] shrink-0">
              <Layers className="w-[19px] h-[19px] stroke-[2]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-tight">
                {t.payments.paymentHistoryTitle}
              </div>
              <div className="text-[12px] text-[#374151] dark:text-[#B8C0CC] truncate mt-0.5">
                Generate monthly rent, waive charges &amp; audit ledger
              </div>
            </div>
          </div>
          <ChevronRight className="w-[16px] h-[16px] text-[#4B5563] dark:text-[#9CA3AF] stroke-[2] shrink-0" />
        </Link>

        <Link
          to="/ledger?view=deposits"
          className="w-full rounded-[18px] px-3.5 py-2.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[36px] h-[36px] rounded-[11px] bg-[#EBF2FE] dark:bg-[#21262D] flex items-center justify-center text-[#0145F2] dark:text-[#5CA2FF] shrink-0">
              <Shield className="w-[19px] h-[19px] stroke-[2]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-tight">
                Deposits Held (Liability)
              </div>
              <div className="text-[12px] text-[#374151] dark:text-[#B8C0CC] truncate mt-0.5">
                Receive, deduct or refund tenant deposits
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[14.5px] font-bold tabular-nums text-[#0145F2] dark:text-[#5CA2FF]">
              {formatRandWhole(liveDepositsHeldCents)}
            </span>
            <ChevronRight className="w-[16px] h-[16px] text-[#4B5563] dark:text-[#9CA3AF] stroke-[2]" />
          </div>
        </Link>

        <button
          type="button"
          onClick={() => setShowStatementsDrawer((prev) => !prev)}
          className="w-full rounded-[18px] px-3.5 py-2.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[36px] h-[36px] rounded-[11px] bg-[#EBF2FE] dark:bg-[#21262D] flex items-center justify-center text-[#0145F2] dark:text-[#5CA2FF] shrink-0">
              <FileText className="w-[19px] h-[19px] stroke-[2]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-tight">
                {t.payments.statementsReceiptsTitle}
              </div>
              <div className="text-[12px] text-[#374151] dark:text-[#B8C0CC] truncate mt-0.5">
                {receipts.length} official numbered receipts ready
              </div>
            </div>
          </div>
          <ChevronRight className="w-[16px] h-[16px] text-[#4B5563] dark:text-[#9CA3AF] stroke-[2] shrink-0" />
        </button>
      </div>

      {/* Expandable Official Numbered Receipts Drawer */}
      {(showStatementsDrawer || activeTab === 'received') && (
        <div className="rounded-[20px] p-3.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#111318] dark:text-[#FFFFFF]">
              {t.payments.officialReceiptsHeading} ({sortedReceipts.length})
            </span>
            {activeTab !== 'overview' && (
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className="text-xs font-semibold text-[#0145F2] dark:text-[#5CA2FF] hover:underline"
              >
                {t.payments.backToOverviewBtn}
              </button>
            )}
          </div>
          <div className="divide-y divide-[#E6ECF3] dark:divide-[#262B31] text-xs">
            {sortedReceipts.length === 0 ? (
              <div className="py-3 text-[#626A78] dark:text-[#98A1B2] text-center">
                {t.financialsReportsSettings.noReceiptsRecorded}
              </div>
            ) : (
              sortedReceipts.map((r) => {
                const pay = payments.find((p) => p.id === r.paymentId);
                return (
                  <div key={r.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/receipts/${r.id}`}
                        className="font-bold text-[#111318] dark:text-[#FFFFFF] hover:text-[#0145F2] truncate block"
                      >
                        {r.tenantName} · {r.receiptNumber}
                      </Link>
                      <div className="text-[11px] text-[#4B5563] dark:text-[#A1A1AA] truncate">
                        {r.propertyUnitLabel} • {formatSADate(r.transactionDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-bold tabular-nums ${
                          r.isCorrectionOrReversal
                            ? 'text-[#E5252A] dark:text-[#FF7A82]'
                            : 'text-[#059D23] dark:text-[#1ED753]'
                        }`}
                      >
                        {r.isCorrectionOrReversal ? '-' : '+'}
                        {formatRandWhole(Math.abs(r.amountCents))}
                      </span>
                      <button
                        type="button"
                        onClick={() => downloadReceiptPDF(r, pay)}
                        className="min-h-[32px] px-2.5 rounded-full bg-[#EBF2FE] dark:bg-[#21262D] text-[#0145F2] dark:text-[#5CA2FF] text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> {t.common.pdf}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Pending Charges View */}
      {activeTab === 'pending' && (
        <div className="rounded-[20px] p-3.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#111318] dark:text-[#FFFFFF]">
              {t.payments.pendingUpcomingHeading} ({pendingCharges.length})
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="text-[#0145F2] dark:text-[#5CA2FF] font-semibold hover:underline"
            >
              {t.payments.backToOverviewBtn}
            </button>
          </div>
          {pendingCharges.length === 0 ? (
            <div className="py-2 text-[#626A78] dark:text-[#98A1B2]">
              No pending upcoming charges right now.
            </div>
          ) : (
            pendingCharges.map((c) => {
              const rem = Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents);
              const tenant = tenants.find((x) => x.id === c.tenantId);
              const unit = units.find((u) => u.id === c.unitId);
              return (
                <div
                  key={c.id}
                  className="py-2.5 border-t border-[#E6ECF3] dark:border-[#262B31] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[#111318] dark:text-[#FFFFFF] truncate">
                      {tenant?.fullName || c.description}
                      {unit ? ` · ${unit.unitNumber}` : ''}
                    </div>
                    <div className="text-[11px] text-[#4B5563] dark:text-[#A1A1AA]">
                      {c.description} · {t.payments.duePrefix} {formatSADate(c.dueDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular-nums text-[#0145F2] dark:text-[#5CA2FF]">
                      {formatRandWhole(rem)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenQuickAdd?.('payment', {
                          tenancyId: c.tenancyId,
                          tenantId: c.tenantId,
                        })
                      }
                      className="min-h-[32px] px-2.5 rounded-full bg-[#0145F2] text-white text-[11px] font-semibold"
                    >
                      Log
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Overdue Charges View with 1-Tap Log Payment */}
      {activeTab === 'overdue' && (
        <div className="rounded-[20px] p-3.5 bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#E5252A] dark:text-[#FF7A82]">
              {t.payments.overdueChargesHeading} ({overdueCharges.length})
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="text-[#111318] dark:text-[#FFFFFF] font-semibold hover:underline"
            >
              {t.payments.backToOverviewBtn}
            </button>
          </div>
          {overdueCharges.length === 0 ? (
            <div className="py-2 text-[#059D23] dark:text-[#2CE058] font-semibold">
              All billed rent is up to date.
            </div>
          ) : (
            overdueCharges.map((c) => {
              const rem = Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents);
              const tenant = tenants.find((x) => x.id === c.tenantId);
              const unit = units.find((u) => u.id === c.unitId);
              return (
                <div
                  key={c.id}
                  className="py-2.5 border-t border-[#FAD6DA] dark:border-[#462127] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[#111318] dark:text-[#FFFFFF] truncate">
                      {tenant?.fullName || c.description}
                      {unit ? ` · ${unit.unitNumber}` : ''}
                    </div>
                    <div className="text-[11px] text-[#E5252A] dark:text-[#FF7A82]">
                      {c.description} · {t.payments.duePrefix} {formatSADate(c.dueDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular-nums text-[#E5252A] dark:text-[#FF7A82]">
                      {formatRandWhole(rem)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenQuickAdd?.('payment', {
                          tenancyId: c.tenancyId,
                          tenantId: c.tenantId,
                        })
                      }
                      className="min-h-[34px] px-3 rounded-full bg-[#0145F2] text-white text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <CreditCard className="w-3 h-3" />
                      Log
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Truthful Recent Payments Section */}
      <div className="pt-1 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[17.5px] font-bold tracking-[-0.015em] text-[#111318] dark:text-[#FFFFFF]">
            {t.payments.recentPaymentsHeading}
          </h2>
          <button
            type="button"
            onClick={() => setShowStatementsDrawer((prev) => !prev)}
            className="text-[13px] font-semibold text-[#0145F2] dark:text-[#1E78FF] hover:opacity-85 flex items-center gap-0.5"
          >
            <span>{t.common.viewAll}</span>
            <ChevronRight className="w-[15px] h-[15px] stroke-[2.25]" />
          </button>
        </div>

        <div className="space-y-2">
          {recentCards.length === 0 ? (
            <div className="rounded-[18px] px-4 py-5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] text-center text-[13px] text-[#626A78] dark:text-[#98A1B2]">
              {t.financialsReportsSettings.noReceiptsRecorded}
            </div>
          ) : (
            recentCards.map((card) => (
              <Link
                key={card.id}
                to={`/receipts/${card.receiptId}`}
                className="rounded-[18px] px-3.5 py-2.5 bg-[#F9FBFE] dark:bg-[#15181C] border border-[#E6ECF3] dark:border-[#262B31] hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-[40px] h-[40px] rounded-full flex items-center justify-center text-[14px] font-bold tracking-[-0.01em] shrink-0 ${card.avatarClass}`}
                  >
                    {card.initials}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-tight truncate">
                      {card.name}
                    </div>
                    <div className="text-[12.5px] text-[#374151] dark:text-[#B8C0CC] mt-0.5 truncate">
                      {card.sublabel}
                    </div>
                  </div>
                </div>

                <div
                  className={`text-[15px] font-bold tabular-nums shrink-0 pr-1 ${
                    card.isReversal
                      ? 'text-[#E5252A] dark:text-[#FF7A82]'
                      : 'text-[#059D23] dark:text-[#1ED753]'
                  }`}
                >
                  {card.amountText}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Unified Floating Primary Action Button (+) */}
      <div className="fixed bottom-[92px] left-1/2 -translate-x-1/2 w-full max-w-[430px] px-4 pointer-events-none z-30 flex justify-end">
        <button
          type="button"
          onClick={() => onOpenQuickAdd?.('payments_menu')}
          aria-label={t.quickActions.paymentsTitle}
          className="pointer-events-auto w-[56px] h-[56px] rounded-full bg-[#0145F2] hover:bg-[#0039CC] active:scale-95 text-[#FFFFFF] shadow-[0_8px_22px_rgba(1,69,242,0.42)] flex items-center justify-center transition-all"
        >
          <Plus className="w-7 h-7 stroke-[2.25]" />
        </button>
      </div>
    </div>
  );
};

export const ReceiptDetailScreen: React.FC<{
  receipts: Receipt[];
  payments: Payment[];
  tenants?: TenantProfile[];
  onNotify?: (msg: string) => void;
}> = ({ receipts, payments, tenants = [], onNotify }) => {
  const { t } = useLanguagePreference();
  const { receiptId } = useParams<{ receiptId: string }>();
  const receipt = receipts.find((r) => r.id === receiptId) || receipts[0];

  if (!receipt) {
    return (
      <div className="p-6 text-center text-sm text-[#626A78] dark:text-[#98A1B2]">
        {t.payments.receiptNotFound}
      </div>
    );
  }

  const payment = payments.find((p) => p.id === receipt.paymentId);
  const tenant = tenants.find((x) => x.id === receipt.tenantId);
  const methodLabel =
    t.domainLabels.paymentMethods[receipt.paymentMethod] ||
    PAYMENT_METHOD_LABELS[receipt.paymentMethod];

  const shareText = `Official Rent Receipt ${receipt.receiptNumber}\nLandlord: ${receipt.landlordName}\nTenant: ${receipt.tenantName} (${receipt.propertyUnitLabel})\nAmount Paid: ${formatZAR(receipt.amountCents)} via ${methodLabel}\nDate: ${formatSADate(receipt.transactionDate)}\nBalance After Payment: ${formatZAR(receipt.balanceAfterPaymentCents)}`;

  const contactPhone = tenant?.primaryPhone || tenant?.alternativePhone;
  const whatsappUrl = contactPhone ? buildWhatsAppUrl(contactPhone, shareText) : null;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      onNotify?.('Receipt summary copied to clipboard');
    } catch {
      onNotify?.('Could not access clipboard');
    }
  };

  const handleLogWhatsAppShare = async () => {
    if (!tenant || !contactPhone) return;
    try {
      await logCommunicationEntry({
        tenantId: tenant.id,
        tenancyId: receipt.tenancyId,
        channel: 'whatsapp',
        templateType: 'payment_acknowledgement',
        subject: `Receipt ${receipt.receiptNumber}`,
        body: shareText,
        recipientContact: contactPhone,
        deliveryStatus: 'handed-off',
        statusEvidenceNote: 'Opened WhatsApp receipt handoff from Receipt Detail screen.',
      });
      onNotify?.(`Logged WhatsApp receipt handoff for ${tenant.fullName}`);
    } catch {
      // non-blocking audit log
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2 text-xs text-[#626A78] dark:text-[#98A1B2]">
        <Link
          to="/receipts"
          className="min-h-[36px] inline-flex items-center gap-1.5 font-semibold hover:text-[#0145F2]"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.payments.allReceiptsLink}
        </Link>
        <span className="font-mono font-semibold text-[#111318] dark:text-white">
          {receipt.receiptNumber}
        </span>
      </div>

      {/* Receipt Preview Card */}
      <div className="rounded-[24px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] overflow-hidden">
        <div className="px-5 py-4 bg-[#0145F2] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-white/80">
              {t.payments.officialReceiptBadge}
            </div>
            <h1 className="text-[20px] font-bold font-mono mt-0.5">{receipt.receiptNumber}</h1>
          </div>
          <div className="text-[11.5px] text-white/85 sm:text-right">
            <div>
              {t.payments.transactionDateLabel}: {formatSADate(receipt.transactionDate)}
            </div>
            <div>
              {t.payments.issuedPrefix}: {formatSADateTime(receipt.issuedAt)}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {receipt.isCorrectionOrReversal && (
            <div className="p-3 rounded-[14px] bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-[#E5252A] dark:text-[#FF7A82] font-semibold">
              {t.payments.correctionReversalPrefix}: {receipt.correctionNote}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                {t.payments.landlordEntityLabel}
              </div>
              <div className="font-bold text-[14px] text-[#111318] dark:text-white mt-0.5">
                {receipt.landlordName}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                {t.payments.receivedFromTenantLabel}
              </div>
              <div className="font-bold text-[14px] text-[#111318] dark:text-white mt-0.5">
                {receipt.tenantName}
              </div>
              <div className="text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                {receipt.propertyUnitLabel}
              </div>
            </div>
          </div>

          <div className="p-4 rounded-[18px] bg-[#F5F7FA] dark:bg-[#1E222A] border border-[#E6ECF3] dark:border-[#262B31] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[#626A78] dark:text-[#98A1B2]">
                {t.payments.amountRecordedLabel}
              </span>
              <span className="text-[19px] font-bold font-mono tabular-nums text-[#059D23] dark:text-[#2CE058]">
                {formatZAR(receipt.amountCents)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#626A78] dark:text-[#98A1B2]">
                {t.payments.externalPaymentMethodLabel}
              </span>
              <span className="font-semibold text-[#111318] dark:text-white">{methodLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#626A78] dark:text-[#98A1B2]">
                {t.payments.settlementVerificationLabel}
              </span>
              <span className="font-semibold text-[#111318] dark:text-white">
                {t.domainLabels.verificationStatuses[receipt.paymentVerificationStatus] ||
                  PAYMENT_VERIFICATION_LABELS[receipt.paymentVerificationStatus]}
              </span>
            </div>
            {payment?.externalReference && (
              <div className="flex items-center justify-between">
                <span className="text-[#626A78] dark:text-[#98A1B2]">
                  {t.payments.externalReferenceLabel}
                </span>
                <span className="font-mono text-[#111318] dark:text-white">
                  {payment.externalReference}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-[#E6ECF3] dark:border-[#262B31]">
              <span className="text-[#626A78] dark:text-[#98A1B2]">
                {t.payments.remainingBalanceAfterLabel}
              </span>
              <span className="font-mono font-bold tabular-nums text-[#111318] dark:text-white">
                {formatZAR(receipt.balanceAfterPaymentCents)}
              </span>
            </div>
          </div>

          {/* Truthful Share & Download Action Bar */}
          <div className="space-y-2 pt-1">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleLogWhatsAppShare}
                className="w-full min-h-[46px] px-4 rounded-full bg-[#059D23] hover:bg-[#04841D] text-white text-[13px] font-semibold flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                Send Receipt on WhatsApp
              </a>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => downloadReceiptPDF(receipt, payment)}
                className="min-h-[44px] px-3 rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-white text-[12.5px] font-semibold flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleCopyText}
                className="min-h-[44px] px-3 rounded-full bg-[#F5F7FA] dark:bg-[#1E222A] border border-[#E6ECF3] dark:border-[#262B31] text-[#111318] dark:text-white text-[12.5px] font-semibold flex items-center justify-center gap-1.5"
              >
                <Copy className="w-4 h-4" />
                Copy Text
              </button>
            </div>
          </div>

          <p className="text-[11px] text-[#626A78] dark:text-[#98A1B2] leading-relaxed">
            {t.payments.auditNoticeReceipt}
          </p>
        </div>
      </div>
    </div>
  );
};
