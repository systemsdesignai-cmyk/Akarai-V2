import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  HardDriveDownload,
  MessageCircle,
  Plus,
  Shield,
  Sparkles,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import type {
  ApplicationSettings,
  Charge,
  DepositLiability,
  Expense,
  LedgerAdjustment,
  MaintenanceTicket,
  Payment,
  Property,
  Receipt,
  RoleType,
  SyncOperation,
  Tenancy,
  TenantProfile,
  Unit,
} from '../types/domain';
import {
  clearSampleDataToEmptyWorkspace,
  computeTenancyLedgerSummary,
  reloadFictionalSampleData,
  updateApplicationPreferences,
} from '../services/domainService';
import type { QuickAddPrefill, QuickAddTab } from '../components/QuickAddModal';
import { tFormat, useLanguagePreference } from '../components/DesignSystem';
import { db } from '../db/database';
import { resolveAssetUrl } from '../utils/assetUrl';
import {
  addDaysIso,
  buildWhatsAppUrl,
  currentPeriodKey,
  formatMonthPeriodLabel,
  formatSADate,
  formatZAR,
  getTimeOfDayGreeting,
  todayIso,
} from '../utils/format';

/**
 * Crisp Waving Hand SVG matching the warm golden hand icon in the Home greeting
 */
const WavingHandIcon: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg
    viewBox="0 0 36 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M7.5 11.5C6.2 13.3 5.8 15.5 6.3 17.6"
      stroke="#D97706"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M27.2 7.5C29.1 8.8 30.3 10.7 30.7 12.9"
      stroke="#D97706"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M17.8 5.2C18.9 4.9 20 5.6 20.3 6.7L22.3 14.3L24 8.3C24.3 7.2 25.4 6.6 26.5 6.9C27.6 7.2 28.2 8.4 27.9 9.5L25.4 18.2L27.6 14.9C28.3 13.9 29.6 13.7 30.5 14.3C31.4 15 31.7 16.3 31 17.2L25.8 25C23.5 28.5 19.2 30.1 15.1 29C11 27.8 8.3 23.9 8.5 19.6L8.9 11.8C9 10.7 10 9.8 11.1 9.9C12.2 10 13.1 11 13 12.1L12.7 16.9L11.6 8.3C11.4 7.2 12.2 6.1 13.3 6C14.4 5.8 15.5 6.6 15.6 7.7L16.7 15.3L16.4 7.3C16.4 6.1 16.8 5.4 17.8 5.2Z"
      fill="#F5B027"
      stroke="#D97706"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

interface DashboardScreenProps {
  settings?: ApplicationSettings;
  properties: Property[];
  units: Unit[];
  tenants: TenantProfile[];
  tenancies: Tenancy[];
  charges: Charge[];
  payments: Payment[];
  adjustments: LedgerAdjustment[];
  deposits: DepositLiability[];
  receipts: Receipt[];
  expenses: Expense[];
  maintenanceTickets: MaintenanceTicket[];
  syncOperations: SyncOperation[];
  activeUserName?: string;
  onOpenQuickAdd: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
  onNotify: (msg: string) => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  settings,
  properties,
  units,
  tenants,
  tenancies,
  charges,
  payments,
  adjustments,
  deposits,
  receipts,
  maintenanceTickets,
  activeUserName = 'Landlord',
  onOpenQuickAdd,
  onNotify,
}) => {
  const { languageCode, currentLanguage, t } = useLanguagePreference();
  const navigate = useNavigate();
  const [switchingToClean, setSwitchingToClean] = useState(false);

  const isManager = settings?.activeRole === 'manager';
  const isDemoWorkspace = settings?.isSampleDataLoaded === true;
  const today = todayIso();
  const renewalHorizon = addDaysIso(today, 60);
  const currentMonthLabel = formatMonthPeriodLabel(currentPeriodKey());

  const allowedPropIds = isManager
    ? settings?.assignedPropertyIdsForManager || ['prop-bree-mixed', 'prop-cedar']
    : properties.map((p) => p.id);

  const visibleProperties = properties.filter((p) => allowedPropIds.includes(p.id) && !p.isDeleted);
  const visibleUnits = units.filter((u) => allowedPropIds.includes(u.propertyId) && !u.isDeleted);
  const visibleCharges = charges.filter(
    (c) => allowedPropIds.includes(c.propertyId) && !c.isDeleted && c.status !== 'reversed'
  );
  const visiblePayments = payments.filter(
    (p) => allowedPropIds.includes(p.propertyId) && !p.isDeleted && p.verificationStatus !== 'reversed'
  );
  const visibleTenancies = tenancies.filter(
    (l) => allowedPropIds.includes(l.propertyId) && !l.isDeleted
  );
  const visibleActiveTenancies = visibleTenancies.filter(
    (l) => l.status !== 'ended' && l.status !== 'terminated'
  );
  const visibleReceipts = receipts.filter((r) => allowedPropIds.includes(r.propertyId));
  const visibleTickets = maintenanceTickets.filter(
    (m) =>
      allowedPropIds.includes(m.propertyId) &&
      m.status !== 'resolved' &&
      m.status !== 'closed'
  );

  // Scoped tenants count (managers only see tenants on assigned properties; owners see all tenants)
  const visibleTenantsCount = useMemo(() => {
    if (!isManager) return tenants.filter((x) => !x.isDeleted).length;
    const ids = new Set(visibleTenancies.map((l) => l.primaryTenantId));
    return ids.size;
  }, [isManager, tenants, visibleTenancies]);

  // 100% live financial calculations (zero demo overrides)
  const totalBilledCents = visibleCharges.reduce(
    (sum, c) => sum + Math.max(0, c.amountCents + c.adjustedCents),
    0
  );
  const totalAllocatedPaidCents = visibleCharges.reduce((sum, c) => sum + c.allocatedPaidCents, 0);
  const liveCollectedCents = visiblePayments.reduce((sum, p) => sum + p.amountCents, 0);
  const collectionRatePct =
    totalBilledCents > 0
      ? Math.min(100, Math.round((totalAllocatedPaidCents / totalBilledCents) * 100))
      : 0;

  // Per-tenancy live overdue queue sorted by highest arrears
  const overdueTenancyQueue = useMemo(() => {
    return visibleActiveTenancies
      .map((tenancy) => {
        const summary = computeTenancyLedgerSummary(
          tenancy.id,
          charges,
          payments,
          adjustments,
          deposits,
          today
        );
        const tenant = tenants.find((x) => x.id === tenancy.primaryTenantId);
        const unit = visibleUnits.find((u) => u.id === tenancy.unitId);
        return { tenancy, tenant, unit, summary };
      })
      .filter((item) => item.summary.overdueAmountCents > 0)
      .sort((a, b) => b.summary.overdueAmountCents - a.summary.overdueAmountCents);
  }, [visibleActiveTenancies, charges, payments, adjustments, deposits, today, tenants, visibleUnits]);

  const liveOverdueTotalCents = overdueTenancyQueue.reduce(
    (sum, item) => sum + item.summary.overdueAmountCents,
    0
  );

  const liveUpcomingTotalCents = visibleCharges
    .filter(
      (c) =>
        c.status !== 'paid' &&
        c.status !== 'waived' &&
        c.status !== 'overdue' &&
        c.dueDate >= today
    )
    .reduce(
      (sum, c) => sum + Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents),
      0
    );

  const renewalsDisplayCount = visibleActiveTenancies.filter(
    (l) => l.status === 'renewing' || (l.endDate && l.endDate >= today && l.endDate <= renewalHorizon)
  ).length;

  const settledTenanciesCount = Math.max(
    0,
    visibleActiveTenancies.length - overdueTenancyQueue.length
  );

  const latestReceipt = [...visibleReceipts]
    .filter((r) => !r.isCorrectionOrReversal)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];

  const formatWholeRands = (cents: number) =>
    `R${Math.round(cents / 100).toLocaleString('en-US')}`;

  // Clean greeting name: first name or business display name (never hardcoded "Abel")
  const greetingName = useMemo(() => {
    const clean = activeUserName.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (!clean) return 'Landlord';
    return clean.split(/\s+/)[0];
  }, [activeUserName]);

  const greetingLine =
    languageCode === 'en' ? `${getTimeOfDayGreeting()},` : currentLanguage.uiStrings.greetingPrefix;

  // Backup freshness check for real (non-demo) workspaces
  const needsBackupReminder = useMemo(() => {
    if (isDemoWorkspace) return false;
    if (visibleProperties.length === 0 && visiblePayments.length === 0) return false;
    if (!settings?.lastBackupExportedAt) return true;
    const daysSinceBackup =
      (Date.now() - new Date(settings.lastBackupExportedAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceBackup >= 7;
  }, [isDemoWorkspace, visibleProperties.length, visiblePayments.length, settings?.lastBackupExportedAt]);

  // 4-step Endowed Setup Checklist for clean workspaces
  const setupSteps = [
    {
      id: 'property',
      label: 'Add your first property',
      done: visibleProperties.length > 0,
      action: () => onOpenQuickAdd('property'),
    },
    {
      id: 'unit',
      label: 'Add rentable units',
      done: visibleUnits.length > 0,
      action: () => onOpenQuickAdd('unit'),
    },
    {
      id: 'tenant',
      label: 'Register a tenant & lease',
      done: visibleTenantsCount > 0 && visibleTenancies.length > 0,
      action: () => onOpenQuickAdd('tenant'),
    },
    {
      id: 'payment',
      label: 'Log first rent payment & receipt',
      done: visiblePayments.length > 0,
      action: () => onOpenQuickAdd('payment'),
    },
  ];
  const completedSetupSteps = setupSteps.filter((s) => s.done).length;
  const showSetupChecklist =
    !isDemoWorkspace && !settings?.setupChecklistDismissed && completedSetupSteps < setupSteps.length;

  const handleStartCleanPortfolio = async () => {
    if (switchingToClean) return;
    setSwitchingToClean(true);
    try {
      await clearSampleDataToEmptyWorkspace();
      onNotify('Clean workspace ready — add your first property.');
    } finally {
      setSwitchingToClean(false);
    }
  };

  // Empty Workspace State with guided 4-step setup
  if (visibleProperties.length === 0) {
    return (
      <div className="w-full space-y-4 pb-28 pt-1">
        <div>
          <div className="text-[17px] font-semibold text-[#626A78] dark:text-[#98A1B2]">
            {greetingLine}
          </div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] leading-[1.15] mt-0.5 flex items-center gap-2">
            <span>{greetingName}</span>
            <WavingHandIcon className="w-[26px] h-[26px] shrink-0" />
          </h1>
        </div>

        <div className="p-6 rounded-[22px] bg-[#FFFFFF] dark:bg-[#181C21] border border-[#E6ECF3] dark:border-[#262B31] text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-[18px] font-bold text-[#111318] dark:text-[#FFFFFF]">
              {t.dashboard.emptyTitle}
            </h2>
            <p className="text-[13px] text-[#4B5563] dark:text-[#C4C9D1] leading-relaxed mt-1">
              {t.dashboard.emptyDesc}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onOpenQuickAdd('property')}
              className="w-full sm:w-auto min-h-[46px] px-5 py-2.5 rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-[#FFFFFF] text-[13.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
            >
              {t.dashboard.addFirstPropertyBtn}
            </button>
            <button
              type="button"
              onClick={async () => {
                await reloadFictionalSampleData();
                onNotify(t.dashboard.sampleLoadedToast);
              }}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-full border border-[#E6ECF3] dark:border-[#262B31] text-[13px] font-semibold text-[#111318] dark:text-white"
            >
              {t.dashboard.loadSamplePortfolioBtn}
            </button>
          </div>
        </div>

        {/* 4-Step Endowed Setup Roadmap */}
        <div className="rounded-[20px] p-4 bg-[#F9FBFE] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-bold text-[#111318] dark:text-white">
              Quick Setup Checklist
            </span>
            <span className="text-[12px] font-mono tabular-nums text-[#0145F2] dark:text-[#68A2FF] font-semibold">
              {completedSetupSteps}/{setupSteps.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {setupSteps.map((step, idx) => (
              <button
                key={step.id}
                type="button"
                onClick={step.action}
                className="w-full min-h-[44px] px-3 py-2 rounded-[14px] bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E6ECF3] dark:border-[#2B333F] flex items-center justify-between gap-3 text-left hover:border-[#0145F2]/60"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] text-[11.5px] font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <span className="text-[13px] font-semibold text-[#111318] dark:text-white">
                    {step.label}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-[#6B7280] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3.5 pb-28 relative">
      {/* Slim Demo Mode Off-Ramp Banner */}
      {isDemoWorkspace && (
        <div className="rounded-[16px] px-3.5 py-2.5 bg-[#E7F0FF] dark:bg-[#132247] border border-[#C6DBFC] dark:border-[#243F7A] flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-[#0145F2] dark:text-[#68A2FF] shrink-0" />
            <span className="text-[12px] font-semibold text-[#0B1B3B] dark:text-[#DCE8FF] truncate">
              Sample Portfolio
            </span>
          </div>
          <button
            type="button"
            disabled={switchingToClean}
            onClick={handleStartCleanPortfolio}
            className="min-h-[34px] px-3 rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-white text-[11.5px] font-bold whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
          >
            {switchingToClean ? 'Starting...' : 'Start My Portfolio'}
          </button>
        </div>
      )}

      {/* Calm Backup Freshness Nudge for Real Workspaces */}
      {needsBackupReminder && (
        <Link
          to="/backup"
          className="rounded-[16px] px-3.5 py-2.5 bg-[#FFFFFF] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] hover:border-[#0145F2]/50 flex items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2 min-w-0">
            <HardDriveDownload className="w-4 h-4 text-[#0145F2] dark:text-[#68A2FF] shrink-0" />
            <span className="text-[12px] text-[#374151] dark:text-[#D1D5DB] truncate">
              {settings?.lastBackupExportedAt
                ? `Last backup: ${formatSADate(settings.lastBackupExportedAt)}`
                : 'Stored on this device only — save a backup'}
            </span>
          </div>
          <span className="text-[11.5px] font-bold text-[#0145F2] dark:text-[#68A2FF] whitespace-nowrap shrink-0">
            Back up
          </span>
        </Link>
      )}

      {/* 1. Personalized Greeting Block (Live Clock + Active User) */}
      <div className="pt-0.5">
        <div className="text-[18px] font-semibold tracking-[-0.01em] text-[#4B5563] dark:text-[#C4C9D1] leading-snug">
          {greetingLine}
        </div>
        <h1 className="text-[29px] font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] leading-[1.15] mt-0.5 flex items-center gap-2">
          <span className="truncate">{greetingName}</span>
          <WavingHandIcon className="w-[27px] h-[27px] shrink-0" />
        </h1>
        <p className="text-[13.5px] text-[#4B5563] dark:text-[#D1D5DB] mt-1">
          {currentLanguage.uiStrings.homeSubtitle}
        </p>
      </div>

      {/* Endowed 4-Step Setup Checklist (for Clean Workspace in progress) */}
      {showSetupChecklist && (
        <div className="rounded-[20px] p-4 bg-[#F9FBFE] dark:bg-[#171B20] border border-[#C6DBFC] dark:border-[#26417A] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[14px] font-bold text-[#111318] dark:text-white">
                Finish Portfolio Setup ({completedSetupSteps}/{setupSteps.length})
              </div>
              <div className="text-[11.5px] text-[#626A78] dark:text-[#98A1B2]">
                Complete these steps to start tracking monthly rent
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateApplicationPreferences({ setupChecklistDismissed: true })}
              aria-label="Dismiss setup checklist"
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#626A78] hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="w-full h-2 rounded-full bg-[#E6ECF3] dark:bg-[#262B31] overflow-hidden">
            <div
              className="h-full bg-[#0145F2] rounded-full transition-all"
              style={{ width: `${Math.round((completedSetupSteps / setupSteps.length) * 100)}%` }}
            />
          </div>
          <div className="space-y-1.5">
            {setupSteps.map((step) => (
              <button
                key={step.id}
                type="button"
                disabled={step.done}
                onClick={step.action}
                className={`w-full min-h-[42px] px-3 py-2 rounded-[12px] flex items-center justify-between gap-2 text-left text-[12.5px] ${
                  step.done
                    ? 'bg-[#E8F8EE]/60 dark:bg-[#113123]/40 text-[#12A150] dark:text-[#23D160] line-through'
                    : 'bg-[#FFFFFF] dark:bg-[#1E242D] border border-[#E6ECF3] dark:border-[#2B333F] text-[#111318] dark:text-white font-semibold hover:border-[#0145F2]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${step.done ? 'opacity-100' : 'opacity-30'}`}
                  />
                  {step.label}
                </span>
                {!step.done && <ChevronRight className="w-4 h-4 text-[#0145F2] shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. Three Truthful Summary Metric Cards: Properties | Tenants | Overdue */}
      <div className="grid grid-cols-3 gap-2.5 pt-0.5">
        <Link
          to="/properties"
          className="rounded-[18px] p-3.5 bg-[#F9FBFE] dark:bg-[#191D21] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50 transition-colors flex flex-col justify-between min-h-[104px]"
        >
          <div className="w-[28px] h-[28px] rounded-[7px] bg-[#E8F0FE] dark:bg-transparent flex items-center justify-center dark:justify-start text-[#0145F2] dark:text-[#1D7AFC]">
            <Building2 className="w-[20px] h-[20px] stroke-[2]" />
          </div>
          <div className="mt-2">
            <div className="text-[23px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
              {visibleProperties.length}
            </div>
            <div className="text-[12.5px] text-[#4B5563] dark:text-[#C8CDD5] mt-1 font-normal">
              {currentLanguage.navLabels.properties}
            </div>
          </div>
        </Link>

        <Link
          to="/tenants"
          className="rounded-[18px] p-3.5 bg-[#F9FBFE] dark:bg-[#191D21] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50 transition-colors flex flex-col justify-between min-h-[104px]"
        >
          <div className="w-[28px] h-[28px] rounded-[7px] bg-[#E8F0FE] dark:bg-transparent flex items-center justify-center dark:justify-start text-[#0145F2] dark:text-[#1D7AFC]">
            <Users className="w-[20px] h-[20px] stroke-[2]" />
          </div>
          <div className="mt-2">
            <div className="text-[23px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
              {visibleTenantsCount}
            </div>
            <div className="text-[12.5px] text-[#4B5563] dark:text-[#C8CDD5] mt-1 font-normal">
              {currentLanguage.navLabels.tenants}
            </div>
          </div>
        </Link>

        <Link
          to="/ledger"
          className={`rounded-[18px] p-3.5 border transition-colors flex flex-col justify-between min-h-[104px] ${
            overdueTenancyQueue.length > 0
              ? 'bg-[#FFEEF0] dark:bg-[#331A1E] border-[#FAD6DA] dark:border-[#4B2329] hover:border-[#E5252A]/60'
              : 'bg-[#E8F8EE] dark:bg-[#113123] border-[#BDE8CC] dark:border-[#1E563B]'
          }`}
        >
          <div
            className={`w-[28px] h-[28px] flex items-center justify-start ${
              overdueTenancyQueue.length > 0
                ? 'text-[#E5252A] dark:text-[#F85A5A]'
                : 'text-[#12A150] dark:text-[#23D160]'
            }`}
          >
            {overdueTenancyQueue.length > 0 ? (
              <AlertTriangle className="w-[20px] h-[20px] stroke-[2]" />
            ) : (
              <CheckCircle2 className="w-[20px] h-[20px] stroke-[2]" />
            )}
          </div>
          <div className="mt-2">
            <div className="text-[23px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
              {overdueTenancyQueue.length}
            </div>
            <div
              className={`text-[12.5px] mt-1 font-medium ${
                overdueTenancyQueue.length > 0
                  ? 'text-[#E5252A] dark:text-[#F85A5A]'
                  : 'text-[#12A150] dark:text-[#23D160]'
              }`}
            >
              {currentLanguage.uiStrings.overdueLabel}
            </div>
          </div>
        </Link>
      </div>

      {/* 3. Live Monthly Rent Collection Progress Card (replaces decorative +12% chart) */}
      <Link
        to="/payments"
        className="block rounded-[20px] p-4 bg-[#F9FBFE] dark:bg-[#181C21] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50 transition-colors space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-[#4B5563] dark:text-[#C4C9D1]">
              Rent Collected · {currentMonthLabel}
            </div>
            <div className="text-[28px] leading-[1.15] font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] mt-1">
              {formatZAR(liveCollectedCents)}
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] text-[12px] font-bold font-mono tabular-nums shrink-0">
            {collectionRatePct}%
          </span>
        </div>

        {/* Live Collection Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full h-2.5 rounded-full bg-[#E6ECF3] dark:bg-[#262B31] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#0145F2] transition-all duration-300"
              style={{ width: `${collectionRatePct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[12px] text-[#4B5563] dark:text-[#C4C9D1] tabular-nums">
            <span>
              {formatZAR(totalAllocatedPaidCents)} of {formatZAR(totalBilledCents)} billed
            </span>
            <span className="font-semibold text-[#111318] dark:text-white">
              {settledTenanciesCount}/{visibleActiveTenancies.length} leases current
            </span>
          </div>
        </div>
      </Link>

      {/* 4. Upcoming Rent Horizontal Pill Card */}
      <Link
        to="/ledger"
        className="group rounded-[18px] px-3.5 py-3 bg-[#F9FBFE] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-[#EBF1FA] dark:bg-[#232830] flex items-center justify-center text-[#0145F2] dark:text-[#E5E7EB] shrink-0">
            <Calendar className="w-[19px] h-[19px] stroke-[2]" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-snug">
              {t.dashboard.upcomingRentTitle}
            </div>
            <div className="text-[12px] text-[#4B5563] dark:text-[#C4C9D1] truncate mt-0.5">
              {liveUpcomingTotalCents > 0
                ? 'Open charges due on or after today'
                : 'No unpaid upcoming charges billed yet'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[15px] font-bold tabular-nums text-[#111318] dark:text-[#FFFFFF]">
            {formatWholeRands(liveUpcomingTotalCents)}
          </span>
          <ChevronRight className="w-[16px] h-[16px] text-[#6B7280] dark:text-[#9CA3AF] group-hover:translate-x-0.5 transition-transform stroke-[2]" />
        </div>
      </Link>

      {/* 5. Actionable Needs Attention Queue (Overdue Tenants with 1-Tap Pay & WhatsApp + Maintenance + Renewals) */}
      <div className="pt-1 space-y-2.5">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-[#111318] dark:text-[#FFFFFF]">
            {t.dashboard.needsAttentionTitle}
          </h2>
          <Link
            to="/ledger"
            className="text-[13px] font-semibold text-[#0145F2] dark:text-[#2574FF] hover:underline flex items-center gap-0.5"
          >
            <span>{t.common.viewAll}</span>
            <ChevronRight className="w-[15px] h-[15px] stroke-[2.2]" />
          </Link>
        </div>

        {/* Inline Overdue Tenants Action Cards */}
        {overdueTenancyQueue.length > 0 && (
          <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171B20] border border-[#FAD6DA] dark:border-[#4B2329] divide-y divide-[#F5E1E4] dark:divide-[#2F1E22] overflow-hidden">
            <div className="px-3.5 py-2.5 bg-[#FFEEF0] dark:bg-[#2A171B] flex items-center justify-between">
              <span className="text-[12px] font-bold text-[#E5252A] dark:text-[#FF7A82]">
                {overdueTenancyQueue.length} Overdue{' '}
                {overdueTenancyQueue.length === 1 ? 'Account' : 'Accounts'}
              </span>
              <span className="text-[12px] font-bold font-mono tabular-nums text-[#E5252A] dark:text-[#FF7A82]">
                {formatZAR(liveOverdueTotalCents)}
              </span>
            </div>

            {overdueTenancyQueue.slice(0, 3).map(({ tenancy, tenant, unit, summary }) => {
              const reminderText = `Hello ${tenant?.fullName || 'Tenant'}, friendly reminder from Akarai regarding ${unit?.unitNumber || 'your unit'}. Overdue balance: ${formatZAR(summary.overdueAmountCents)}. Ref: ${tenancy.tenancyReference}.`;
              const waUrl = buildWhatsAppUrl(
                tenant?.primaryPhone || tenant?.alternativePhone,
                reminderText
              );

              return (
                <div key={tenancy.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={tenant ? `/tenants/${tenant.id}` : `/ledger?tenancyId=${tenancy.id}`}
                      className="min-w-0 hover:underline"
                    >
                      <div className="text-[14px] font-bold text-[#111318] dark:text-white truncate">
                        {tenant?.fullName || 'Tenant'}
                      </div>
                      <div className="text-[12px] text-[#626A78] dark:text-[#98A1B2] truncate">
                        {unit?.unitNumber || tenancy.tenancyReference} · Ref {tenancy.tenancyReference}
                      </div>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="text-[14.5px] font-bold font-mono tabular-nums text-[#E5252A] dark:text-[#FF5A5F]">
                        {formatZAR(summary.overdueAmountCents)}
                      </div>
                      <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                        overdue
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenQuickAdd('payment', {
                          tenancyId: tenancy.id,
                          tenantId: tenant?.id,
                        })
                      }
                      className="min-h-[40px] px-3 rounded-[12px] bg-[#0145F2] hover:bg-[#0039CC] text-white text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2]"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>Log Payment</span>
                    </button>

                    {waUrl ? (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] px-3 rounded-[12px] bg-[#E8F8EE] dark:bg-[#113123] text-[#0E8A44] dark:text-[#23D160] border border-[#BDE8CC] dark:border-[#1E563B] text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>WhatsApp</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/communications?tenantId=${tenant?.id || ''}&template=rent_reminder`
                          )
                        }
                        className="min-h-[40px] px-3 rounded-[12px] bg-[#EDF1F5] dark:bg-[#232830] text-[#111318] dark:text-white text-[12px] font-semibold flex items-center justify-center gap-1.5"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Remind</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Maintenance & Renewals Summary Rows */}
        <div className="rounded-[20px] bg-[#F9FBFE] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none divide-y divide-[#E8EEF5] dark:divide-[#262B31] overflow-hidden">
          <Link
            to="/maintenance"
            className="group px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-[32px] h-[32px] flex items-center justify-center text-[#0145F2] dark:text-[#1D7AFC] shrink-0">
                <Wrench className="w-[21px] h-[21px] stroke-[2]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-snug">
                  {visibleTickets.length} {t.dashboard.maintenanceRequestCount}
                </div>
                <div className="text-[12.5px] text-[#4B5563] dark:text-[#C4C9D1] truncate mt-0.5">
                  {visibleTickets[0]?.title || t.common.resolved}
                </div>
              </div>
            </div>
            <ChevronRight className="w-[16px] h-[16px] text-[#6B7280] dark:text-[#9CA3AF] group-hover:translate-x-0.5 transition-transform shrink-0 stroke-[2]" />
          </Link>

          <Link
            to="/tenancies"
            className="group px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-[32px] h-[32px] flex items-center justify-center text-[#111318] dark:text-[#E5E7EB] shrink-0">
                <Calendar className="w-[21px] h-[21px] stroke-[2]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-snug">
                  {renewalsDisplayCount} {t.dashboard.leaseRenewalsCount}
                </div>
                <div className="text-[12.5px] text-[#4B5563] dark:text-[#C4C9D1] truncate mt-0.5">
                  {visibleActiveTenancies.length} active{' '}
                  {visibleActiveTenancies.length === 1 ? 'lease' : 'leases'}
                </div>
              </div>
            </div>
            <ChevronRight className="w-[16px] h-[16px] text-[#6B7280] dark:text-[#9CA3AF] group-hover:translate-x-0.5 transition-transform shrink-0 stroke-[2]" />
          </Link>
        </div>
      </div>

      {/* 6. Recent Activity Section (100% live latest receipt, no pr-14 overlap hack) */}
      <div className="pt-1 space-y-2.5">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[17.5px] font-bold tracking-[-0.01em] text-[#111318] dark:text-[#FFFFFF]">
            {t.dashboard.recentActivityTitle}
          </h2>
          <Link
            to="/receipts"
            className="text-[13px] font-semibold text-[#0145F2] dark:text-[#2574FF] hover:underline flex items-center gap-0.5"
          >
            <span>{t.common.viewAll}</span>
            <ChevronRight className="w-[15px] h-[15px] stroke-[2.2]" />
          </Link>
        </div>

        <Link
          to={latestReceipt ? `/receipts/${latestReceipt.id}` : '/receipts'}
          className="rounded-[18px] px-3.5 py-3 bg-[#F9FBFE] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[36px] h-[36px] rounded-[10px] bg-[#E3F8EA] dark:bg-[#14261D] flex items-center justify-center text-[#12A138] dark:text-[#25D35A] shrink-0">
              <CheckCircle2 className="w-[19px] h-[19px] stroke-[2.1]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-snug">
                {latestReceipt ? t.dashboard.rentReceivedTitle : 'No receipts recorded yet'}
              </div>
              <div className="text-[12px] text-[#4B5563] dark:text-[#C4C9D1] truncate mt-0.5">
                {latestReceipt
                  ? `${latestReceipt.tenantName} • ${latestReceipt.receiptNumber} · ${formatSADate(latestReceipt.transactionDate)}`
                  : t.financialsReportsSettings.noReceiptsRecorded}
              </div>
            </div>
          </div>

          <div className="text-[14.5px] font-bold tabular-nums text-[#059D23] dark:text-[#2CE058] shrink-0">
            {latestReceipt ? `+${formatZAR(latestReceipt.amountCents)}` : 'R 0.00'}
          </div>
        </Link>
      </div>

      {/* 7. Unified Circular Electric-Blue Floating Action Button ("+") */}
      <div className="fixed bottom-[92px] left-0 right-0 z-30 pointer-events-none">
        <div className="max-w-[430px] mx-auto px-4 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenQuickAdd('menu')}
            aria-label={t.dashboard.openQuickActionsAria}
            title={t.quickActions.title}
            className="pointer-events-auto w-[56px] h-[56px] rounded-full bg-[#0145F2] hover:bg-[#0139C9] active:scale-95 text-[#FFFFFF] shadow-[0_6px_20px_rgba(1,69,242,0.42)] flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0145F2]"
          >
            <Plus className="w-[27px] h-[27px] stroke-[2.2]" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const WelcomeOnboardingScreen: React.FC<{
  settings?: ApplicationSettings;
  onNotify: (msg: string) => void;
}> = ({ settings, onNotify }) => {
  const navigate = useNavigate();
  const { t } = useLanguagePreference();
  const [stepIdx, setStepIdx] = useState(0);
  const [pendingAction, setPendingAction] = useState<'clear' | 'reload' | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = t.onboarding.steps;
  const currentStep = steps[stepIdx] || steps[0];
  const isLastStep = stepIdx >= steps.length - 1;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Phase 6: Welcome & Splash Branding Hero with Approved Vertical Akarai Logo */}
      <div className="relative overflow-hidden rounded-[24px] bg-[#FFFFFF] border border-[#E6ECF3] dark:border-[#262B31] px-6 pt-7 pb-10 text-center shadow-[0_4px_20px_rgba(11,27,59,0.06)] transition-all duration-500 motion-reduce:transition-none">
        <div className="relative z-10 flex flex-col items-center">
          <img
            src={resolveAssetUrl('akarai-logo-vertical.png')}
            alt="Akarai — Property & Rent Management"
            className="w-[186px] sm:w-[210px] h-auto object-contain select-none transition-transform duration-500 ease-out motion-reduce:transition-none"
            draggable={false}
          />
        </div>
        {/* Subtle bottom wave vector matching the Akarai brand board (#0145F2 & #8EC5FF) */}
        <svg
          viewBox="0 0 430 70"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute bottom-0 left-0 right-0 w-full h-[46px] pointer-events-none select-none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 44C95 62 195 14 310 30C365 38 402 22 430 12V70H0V44Z"
            fill="#8EC5FF"
            fillOpacity="0.35"
          />
          <path
            d="M0 54C115 32 225 66 345 36C382 26 410 18 430 22V70H0V54Z"
            fill="#0145F2"
            fillOpacity="0.85"
          />
        </svg>
      </div>

      <div className="p-5 sm:p-6 rounded-2xl bg-[#FFFFFF] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] space-y-4">
        <div className="text-xs font-mono text-[#0145F2] dark:text-[#60A5FA]">
          {t.onboarding.badge}
        </div>
        <h1 className="text-2xl font-bold text-[#111318] dark:text-[#FFFFFF]">
          {t.onboarding.title}
        </h1>
        <p className="text-sm text-[#4B5563] dark:text-[#C4C9D1] leading-relaxed">
          {t.onboarding.subtitle}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
          <div className="p-4 rounded-xl bg-[#F8FAFD] dark:bg-[#12161B] border border-[#E6ECF3] dark:border-[#262B31] space-y-1.5">
            <div className="font-bold text-[#111318] dark:text-[#FFFFFF]">
              {t.onboarding.card1Title}
            </div>
            <p className="text-[#4B5563] dark:text-[#B8C0CC]">
              {t.onboarding.card1Body}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[#F8FAFD] dark:bg-[#12161B] border border-[#E6ECF3] dark:border-[#262B31] space-y-1.5">
            <div className="font-bold text-[#111318] dark:text-[#FFFFFF]">
              {t.onboarding.card2Title}
            </div>
            <p className="text-[#4B5563] dark:text-[#B8C0CC]">
              {t.onboarding.card2Body}
            </p>
          </div>
        </div>

        {/* Interactive Step-by-Step Walkthrough Tour */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#E8F0FE]/60 dark:bg-[#0D1A36]/60 border border-[#C6DBFC] dark:border-[#1E3A6E] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#0145F2] dark:text-[#68A2FF]">
              {t.onboarding.tourHeading}
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#0145F2] text-[#FFFFFF] text-[11px] font-bold">
              {tFormat(t.onboarding.tourStepCounter, {
                current: stepIdx + 1,
                total: steps.length,
              })}
            </span>
          </div>

          {/* Step progress indicators */}
          <div className="grid grid-cols-4 gap-1.5">
            {steps.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setStepIdx(idx)}
                aria-label={`${idx + 1}`}
                className={`h-1.5 rounded-full transition-colors ${
                  idx <= stepIdx
                    ? 'bg-[#0145F2]'
                    : 'bg-[#C6DBFC] dark:bg-[#1E3A6E]'
                }`}
              />
            ))}
          </div>

          {currentStep && (
            <div className="space-y-2 pt-1">
              <h2 className="text-[16px] font-bold text-[#111318] dark:text-[#FFFFFF]">
                {currentStep.title}
              </h2>
              <p className="text-xs text-[#374151] dark:text-[#D1D5DB] leading-relaxed">
                {currentStep.description}
              </p>
              <div className="p-3 rounded-xl bg-[#FFFFFF] dark:bg-[#141820] border border-[#DCE8FA] dark:border-[#24324C] text-[11.5px] font-medium text-[#0145F2] dark:text-[#8AB8FF]">
                {currentStep.tip}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={stepIdx === 0}
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                className="min-h-[38px] px-3.5 py-1.5 rounded-full border border-[#C6DBFC] dark:border-[#29467A] bg-[#FFFFFF] dark:bg-[#151A22] text-xs font-semibold disabled:opacity-40"
              >
                {t.onboarding.prevBtn}
              </button>
              {!isLastStep ? (
                <button
                  type="button"
                  onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
                  className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#0145F2] text-[#FFFFFF] text-xs font-semibold"
                >
                  {t.onboarding.nextBtn}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onNotify(t.onboarding.tourCompletedMsg);
                    navigate('/');
                  }}
                  className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#059D23] text-[#FFFFFF] text-xs font-semibold"
                >
                  {t.onboarding.finishTourBtn}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-xs font-semibold text-[#4B5563] dark:text-[#9CA3AF] hover:underline px-2 py-1"
            >
              {t.onboarding.skipTourBtn}
            </button>
          </div>
        </div>

        {pendingAction && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#4B2329] space-y-2.5 text-xs"
          >
            <div className="font-bold text-[#E5252A] dark:text-[#FF7A82]">
              {pendingAction === 'clear'
                ? 'Confirm Clear All Operational Data'
                : 'Confirm Reload Fictional Demo Dataset'}
            </div>
            <p className="text-[#4B5563] dark:text-[#D1D5DB] leading-relaxed">
              {pendingAction === 'clear'
                ? 'This permanently clears all properties, tenants, tenancies, charges, payments, receipts, maintenance tickets, and documents in this browser. Export a JSON backup first if you want to keep current records.'
                : 'This replaces your current local workspace records with the fictional demonstration dataset while preserving your theme and plan selection.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (pendingAction === 'clear') {
                      await clearSampleDataToEmptyWorkspace();
                      onNotify(t.onboarding.sampleRemovedToast);
                    } else {
                      await reloadFictionalSampleData();
                      onNotify(t.onboarding.sampleReloadedToast);
                    }
                    setPendingAction(null);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#E5252A] text-white font-semibold disabled:opacity-50"
              >
                {pendingAction === 'clear' ? t.onboarding.removeSampleBtn : t.onboarding.reloadSampleBtn}
              </button>
              <Link
                to="/backup"
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-[#E6ECF3] dark:border-[#262B31] bg-white dark:bg-[#15181C] font-semibold inline-flex items-center"
              >
                Backup First
              </Link>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingAction(null)}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-[#E6ECF3] dark:border-[#262B31] font-semibold"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#E6ECF3] dark:border-[#262B31]">
          <div className="flex flex-wrap items-center gap-3">
            {settings?.isSampleDataLoaded ? (
              <button
                type="button"
                onClick={() => setPendingAction('clear')}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#FAD6DA] dark:border-[#4B2329] text-[#E5252A] dark:text-[#F85A5A] text-xs font-semibold"
              >
                {t.onboarding.removeSampleBtn}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPendingAction('reload')}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#E6ECF3] dark:border-[#262B31] text-xs font-semibold"
              >
                {t.onboarding.reloadSampleBtn}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigate('/')}
            className="min-h-[42px] px-5 py-2 rounded-xl bg-[#0145F2] text-white text-xs font-semibold"
          >
            {t.onboarding.goHomeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};

export const SignInAccountStateScreen: React.FC<{
  settings?: ApplicationSettings;
  tenants: TenantProfile[];
  onNotify: (msg: string) => void;
}> = ({ settings, tenants, onNotify }) => {
  const { t } = useLanguagePreference();
  const activeRole = settings?.activeRole || 'owner';

  const setRoleAndTenant = async (role: RoleType, tenantId?: string) => {
    if (!settings) return;
    await db.applicationSettings.update(settings.id, {
      activeRole: role,
      activeTenantIdForPortal: tenantId || settings.activeTenantIdForPortal,
    });
    onNotify(tFormat(t.signInRole.switchedRoleToast, { role: role.toUpperCase() }));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="p-6 rounded-2xl bg-[#FFFFFF] dark:bg-[#171B20] border border-[#E6ECF3] dark:border-[#262B31] space-y-4">
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 font-semibold">
          <Shield className="w-4 h-4" />
          {t.signInRole.badge}
        </div>
        <h1 className="text-xl font-bold text-[#111318] dark:text-[#FFFFFF]">
          {t.signInRole.title}
        </h1>
        <p className="text-xs text-[#4B5563] dark:text-[#B8C0CC] leading-relaxed">
          {t.signInRole.subtitle}
        </p>
        <div className="p-3 rounded-xl bg-[#FEF2D6]/60 dark:bg-[#3A2B12]/60 border border-[#F5A623]/30 text-[11.5px] text-[#A96B00] dark:text-[#FFC24B]">
          Local Prototype Preview Only: Role switching previews Owner, Manager, Tenant, and Visitor
          screens inside this browser. It is not a server-enforced authentication or security boundary.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <button
            type="button"
            onClick={() => setRoleAndTenant('owner')}
            className={`p-4 rounded-xl border text-left transition-colors ${
              activeRole === 'owner'
                ? 'border-[#0145F2] bg-[#E8F0FE]/50 dark:bg-[#072156]/50'
                : 'border-[#E6ECF3] dark:border-[#262B31]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{t.signInRole.ownerTitle}</span>
              {activeRole === 'owner' && <CheckCircle2 className="w-4 h-4 text-[#0145F2]" />}
            </div>
            <p className="text-xs text-[#4B5563] dark:text-[#B8C0CC] mt-1">
              {t.signInRole.ownerDesc}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setRoleAndTenant('manager')}
            className={`p-4 rounded-xl border text-left transition-colors ${
              activeRole === 'manager'
                ? 'border-[#0145F2] bg-[#E8F0FE]/50 dark:bg-[#072156]/50'
                : 'border-[#E6ECF3] dark:border-[#262B31]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{t.signInRole.managerTitle}</span>
              {activeRole === 'manager' && <CheckCircle2 className="w-4 h-4 text-[#0145F2]" />}
            </div>
            <p className="text-xs text-[#4B5563] dark:text-[#B8C0CC] mt-1">
              {t.signInRole.managerDesc}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setRoleAndTenant('tenant', 'tenant-grace')}
            className={`p-4 rounded-xl border text-left transition-colors ${
              activeRole === 'tenant'
                ? 'border-[#0145F2] bg-[#E8F0FE]/50 dark:bg-[#072156]/50'
                : 'border-[#E6ECF3] dark:border-[#262B31]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{t.signInRole.tenantTitle}</span>
              {activeRole === 'tenant' && <CheckCircle2 className="w-4 h-4 text-[#0145F2]" />}
            </div>
            <p className="text-xs text-[#4B5563] dark:text-[#B8C0CC] mt-1">
              {t.signInRole.tenantDesc}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setRoleAndTenant('unauthenticated')}
            className={`p-4 rounded-xl border text-left transition-colors ${
              activeRole === 'unauthenticated'
                ? 'border-[#0145F2] bg-[#E8F0FE]/50 dark:bg-[#072156]/50'
                : 'border-[#E6ECF3] dark:border-[#262B31]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{t.signInRole.visitorTitle}</span>
              {activeRole === 'unauthenticated' && <CheckCircle2 className="w-4 h-4 text-[#0145F2]" />}
            </div>
            <p className="text-xs text-[#4B5563] dark:text-[#B8C0CC] mt-1">
              {t.signInRole.visitorDesc}
            </p>
          </button>
        </div>

        {activeRole === 'tenant' && (
          <div className="pt-4 border-t border-[#E6ECF3] dark:border-[#262B31]">
            <label className="block text-xs font-semibold mb-1.5">
              {t.signInRole.selectTenantLabel}
            </label>
            <select
              value={settings?.activeTenantIdForPortal || 'tenant-grace'}
              onChange={(e) => setRoleAndTenant('tenant', e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#E6ECF3] dark:border-[#262B31] bg-[#FFFFFF] dark:bg-[#12161B] text-xs"
            >
              {tenants.map((ten) => (
                <option key={ten.id} value={ten.id}>
                  {ten.fullName} ({ten.tenantCode})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};

