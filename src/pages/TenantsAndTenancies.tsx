import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import type {
  ApplicationSettings,
  Charge,
  CommunicationChannel,
  ConsentRecord,
  DepositLiability,
  DocumentationStatus,
  IdentityEvidence,
  LedgerAdjustment,
  LeaseVersion,
  MessageLog,
  Payment,
  Property,
  Tenancy,
  TenancyParticipant,
  TenantProfile,
  Unit,
} from '../types/domain';
import {
  computeTenancyLedgerSummary,
  updateTenancyStatus,
  updateTenantRecord,
} from '../services/domainService';
import { downloadTenancyStatementPDF } from '../services/pdfService';
import {
  addDaysIso,
  buildWhatsAppUrl,
  DOC_STATUS_LABELS,
  DOC_TYPE_LABELS,
  formatSADate,
  formatZAR,
  todayIso,
} from '../utils/format';
import type { QuickAddPrefill, QuickAddTab } from '../components/QuickAddModal';
import { useLanguagePreference } from '../components/DesignSystem';
import { db } from '../db/database';

type TenantStatusFilter = 'all' | 'paid' | 'overdue' | 'renewal';

const TENANT_AVATAR_STYLES: Record<string, { initials: string; className: string }> = {
  'tenant-dawit': {
    initials: 'DT',
    className: 'bg-[#DAE9FD] text-[#0145F2] dark:bg-[#154778] dark:text-[#FFFFFF]',
  },
  'tenant-meron': {
    initials: 'MH',
    className: 'bg-[#EFEDFD] text-[#4C35B5] dark:bg-[#4C4C89] dark:text-[#FFFFFF]',
  },
  'tenant-yonas': {
    initials: 'YK',
    className: 'bg-[#F8DDEE] text-[#A3215C] dark:bg-[#7B3A43] dark:text-[#FFFFFF]',
  },
  'tenant-selam': {
    initials: 'SB',
    className: 'bg-[#D9E8FE] text-[#0145F2] dark:bg-[#154878] dark:text-[#FFFFFF]',
  },
  'tenant-abebe': {
    initials: 'AB',
    className: 'bg-[#D5F1E2] text-[#0B6B3A] dark:bg-[#066D3B] dark:text-[#FFFFFF]',
  },
};

function getInitials(fullName: string): string {
  const parts = fullName
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'TN';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatRandWhole(cents: number): string {
  const rands = Math.round(cents / 100);
  return `R${rands.toLocaleString('en-US')}`;
}

export const TenantDirectoryScreen: React.FC<{
  settings?: ApplicationSettings;
  tenants: TenantProfile[];
  tenancies: Tenancy[];
  units: Unit[];
  properties?: Property[];
  charges?: Charge[];
  onOpenQuickAdd: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
}> = ({
  tenants,
  tenancies,
  units,
  properties = [],
  charges = [],
  onOpenQuickAdd,
}) => {
  const { currentLanguage, t } = useLanguagePreference();
  const [statusFilter, setStatusFilter] = useState<TenantStatusFilter>('all');
  const [docFilter, setDocFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  const today = todayIso();
  const renewalCutoff = addDaysIso(today, 60);

  const fallbackPalettes = [
    'bg-[#DAE9FD] text-[#0145F2] dark:bg-[#154778] dark:text-[#FFFFFF]',
    'bg-[#EFEDFD] text-[#4C35B5] dark:bg-[#4C4C89] dark:text-[#FFFFFF]',
    'bg-[#F8DDEE] text-[#A3215C] dark:bg-[#7B3A43] dark:text-[#FFFFFF]',
    'bg-[#D9E8FE] text-[#0145F2] dark:bg-[#154878] dark:text-[#FFFFFF]',
    'bg-[#D5F1E2] text-[#0B6B3A] dark:bg-[#066D3B] dark:text-[#FFFFFF]',
  ];

  // Build truthful enriched rows for every tenant in Dexie
  const enrichedTenants = tenants.map((tenant, idx) => {
    const activeTenancy =
      tenancies.find(
        (l) =>
          l.primaryTenantId === tenant.id &&
          l.status !== 'ended' &&
          l.status !== 'terminated'
      ) || tenancies.find((l) => l.primaryTenantId === tenant.id);

    const unit = activeTenancy
      ? units.find((u) => u.id === activeTenancy.unitId)
      : undefined;
    const property = activeTenancy
      ? properties.find((p) => p.id === activeTenancy.propertyId)
      : unit
      ? properties.find((p) => p.id === unit.propertyId)
      : undefined;

    const unitLabel = unit?.unitNumber || activeTenancy?.tenancyReference || 'Unassigned Unit';
    const propertyLabel = property?.name || 'No Property Assigned';
    const rentCents = activeTenancy?.rentAmountCents || unit?.standardRentCents || 0;

    const tenantCharges = charges.filter(
      (c) =>
        c.tenantId === tenant.id &&
        !c.isDeleted &&
        c.status !== 'reversed' &&
        c.status !== 'waived'
    );
    const hasOverdueCharge = tenantCharges.some(
      (c) =>
        c.status !== 'paid' &&
        Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents) > 0 &&
        (c.status === 'overdue' || c.dueDate < today)
    );

    const isRenewalSoon =
      activeTenancy?.status === 'renewing' ||
      activeTenancy?.status === 'notice_given' ||
      Boolean(
        activeTenancy?.endDate &&
          activeTenancy.endDate >= today &&
          activeTenancy.endDate <= renewalCutoff
      );

    const badgeType: 'paid' | 'overdue' | 'renewal' = hasOverdueCharge
      ? 'overdue'
      : isRenewalSoon
      ? 'renewal'
      : 'paid';

    const avatarMeta = TENANT_AVATAR_STYLES[tenant.id] || {
      initials: getInitials(tenant.fullName),
      className: fallbackPalettes[idx % fallbackPalettes.length],
    };

    return {
      tenant,
      activeTenancy,
      unitLabel,
      propertyLabel,
      rentCents,
      badgeType,
      avatarMeta,
    };
  });

  // Sort overdue first, then renewals, then alphabetically
  const sortedTenants = [...enrichedTenants].sort((a, b) => {
    const rank = { overdue: 0, renewal: 1, paid: 2 };
    if (rank[a.badgeType] !== rank[b.badgeType]) {
      return rank[a.badgeType] - rank[b.badgeType];
    }
    return a.tenant.fullName.localeCompare(b.tenant.fullName);
  });

  const q = search.trim().toLowerCase();

  const visibleTenants = sortedTenants.filter((row) => {
    if (statusFilter === 'paid' && row.badgeType !== 'paid') return false;
    if (statusFilter === 'overdue' && row.badgeType !== 'overdue') return false;
    if (statusFilter === 'renewal' && row.badgeType !== 'renewal') return false;

    if (docFilter !== 'all' && row.tenant.documentationStatus !== docFilter) {
      return false;
    }

    if (q) {
      const matchesName = row.tenant.fullName.toLowerCase().includes(q);
      const matchesUnit = row.unitLabel.toLowerCase().includes(q);
      const matchesProperty = row.propertyLabel.toLowerCase().includes(q);
      const matchesCode = row.tenant.tenantCode.toLowerCase().includes(q);
      const matchesPhone = Boolean(
        row.tenant.primaryPhone && row.tenant.primaryPhone.toLowerCase().includes(q)
      );
      const matchesProvisional = Boolean(
        row.tenant.provisionalIdentifier &&
          row.tenant.provisionalIdentifier.toLowerCase().includes(q)
      );
      return (
        matchesName ||
        matchesUnit ||
        matchesProperty ||
        matchesCode ||
        matchesPhone ||
        matchesProvisional
      );
    }

    return true;
  });

  const livePaidCount = enrichedTenants.filter((r) => r.badgeType === 'paid').length;
  const liveOverdueCount = enrichedTenants.filter((r) => r.badgeType === 'overdue').length;
  const liveRenewalCount = enrichedTenants.filter((r) => r.badgeType === 'renewal').length;

  const statusTabs: { id: TenantStatusFilter; label: string }[] = [
    { id: 'all', label: t.tenants.filterAll },
    { id: 'paid', label: t.tenants.filterPaid },
    { id: 'overdue', label: t.tenants.filterOverdue },
    { id: 'renewal', label: t.tenants.filterRenewal },
  ];

  return (
    <div className="w-full space-y-3.5 pb-28 relative">
      {/* Page Heading */}
      <div className="pt-1">
        <h1 className="text-[31px] leading-[1.12] font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
          {currentLanguage.uiStrings.tenantsTitle}
        </h1>
        <p className="text-[14.5px] leading-[1.35] text-[#4B5563] dark:text-[#C4C9D1] mt-1">
          {currentLanguage.uiStrings.tenantsSubtitle}
        </p>
      </div>

      {/* 4 Filter Pills: All | Paid | Overdue | Renewal */}
      <div
        role="tablist"
        aria-label={t.tenants.docFilterHeading}
        className="grid grid-cols-4 gap-2 pt-0.5"
      >
        {statusTabs.map((tab) => {
          const isActive = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[44px] px-2.5 rounded-full text-[13px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center ${
                isActive
                  ? 'bg-[#0145F2] text-[#FFFFFF] border border-[#0145F2] shadow-[0_2px_8px_rgba(1,69,242,0.25)]'
                  : 'bg-[#FFFFFF] dark:bg-[#171A20] text-[#111318] dark:text-[#E5E7EB] border border-[#E4E9F0] dark:border-[#262B32] shadow-[0_1px_4px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 4-Column Truthful Live Summary Metric Cards */}
      <div className="grid grid-cols-4 gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className="rounded-[20px] py-3 px-2 bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.02)] dark:shadow-none flex flex-col items-center justify-start text-center min-h-[104px] transition-transform active:scale-[0.99]"
        >
          <Users className="w-[21px] h-[21px] text-[#0145F2] dark:text-[#1D7AFC] stroke-[2] shrink-0" />
          <div className="text-[21px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {tenants.length}
          </div>
          <div className="text-[11px] leading-[1.2] text-[#374151] dark:text-[#C4C9D1] mt-1 font-normal">
            {t.tenants.totalTenantsLine1}
            <br />
            {t.tenants.totalTenantsLine2}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('paid')}
          className="rounded-[20px] py-3 px-2 bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.02)] dark:shadow-none flex flex-col items-center justify-start text-center min-h-[104px] transition-transform active:scale-[0.99]"
        >
          <CheckCircle2 className="w-[21px] h-[21px] text-[#12A138] dark:text-[#25D35A] stroke-[2] shrink-0" />
          <div className="text-[21px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {livePaidCount}
          </div>
          <div className="text-[11px] leading-[1.2] text-[#374151] dark:text-[#C4C9D1] mt-1 font-normal">
            {t.tenants.paidPeriodLine1}
            <br />
            {t.tenants.paidPeriodLine2}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('overdue')}
          className={`rounded-[20px] py-3 px-2 border flex flex-col items-center justify-start text-center min-h-[104px] transition-transform active:scale-[0.99] ${
            liveOverdueCount > 0
              ? 'bg-[#FFEEF0] dark:bg-[#2A171B] border-[#FAD6DA] dark:border-[#462127] shadow-[0_2px_8px_rgba(229,37,42,0.03)] dark:shadow-none'
              : 'bg-[#F9FBFE] dark:bg-[#171A1F] border-[#E6ECF3] dark:border-[#262B31]'
          }`}
        >
          <AlertTriangle
            className={`w-[21px] h-[21px] stroke-[2] shrink-0 ${
              liveOverdueCount > 0
                ? 'text-[#E5252A] dark:text-[#F85A5A]'
                : 'text-[#6B7280] dark:text-[#9CA3AF]'
            }`}
          />
          <div className="text-[21px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {liveOverdueCount}
          </div>
          <div
            className={`text-[11px] leading-[1.2] mt-2 font-medium ${
              liveOverdueCount > 0
                ? 'text-[#E5252A] dark:text-[#F85A5A]'
                : 'text-[#374151] dark:text-[#C4C9D1]'
            }`}
          >
            {t.tenants.filterOverdue}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('renewal')}
          className="rounded-[20px] py-3 px-2 bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.02)] dark:shadow-none flex flex-col items-center justify-start text-center min-h-[104px] transition-transform active:scale-[0.99]"
        >
          <Calendar className="w-[21px] h-[21px] text-[#7C5CFA] dark:text-[#9D84FF] stroke-[2] shrink-0" />
          <div className="text-[21px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF] mt-1.5">
            {liveRenewalCount}
          </div>
          <div className="text-[11px] leading-[1.2] text-[#374151] dark:text-[#C4C9D1] mt-1 font-normal">
            {t.tenants.renewalDaysLine1}
            <br />
            {t.tenants.renewalDaysLine2}
          </div>
        </button>
      </div>

      {/* Search Bar + Filter Sliders Button */}
      <div className="flex items-center gap-2.5 pt-0.5">
        <div className="flex-1 min-h-[44px] rounded-full px-3.5 bg-[#EDF2F8] dark:bg-[#161A20] border border-[#E2E8F0] dark:border-[#262B32] flex items-center gap-2.5">
          <Search className="w-[17px] h-[17px] text-[#374151] dark:text-[#C4C9D1] stroke-[2] shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.tenants.searchPlaceholder}
            aria-label={t.tenants.searchPlaceholder}
            className="w-full bg-transparent text-[13.5px] text-[#111318] dark:text-[#FFFFFF] placeholder:text-[#5A6270] dark:placeholder:text-[#B0B7C3] focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilterDrawer((prev) => !prev)}
          aria-label={t.tenants.docFilterHeading}
          aria-expanded={showFilterDrawer}
          className={`w-[44px] h-[44px] rounded-full flex items-center justify-center border transition-colors shrink-0 ${
            showFilterDrawer || docFilter !== 'all'
              ? 'bg-[#0145F2] text-[#FFFFFF] border-[#0145F2]'
              : 'bg-[#F9FBFE] dark:bg-[#161A20] text-[#0145F2] dark:text-[#D1D5DB] border-[#E4E9F0] dark:border-[#262B32]'
          }`}
        >
          <SlidersHorizontal className="w-[18px] h-[18px] stroke-[2]" />
        </button>
      </div>

      {/* Expandable POPIA Documentation Filter Drawer */}
      {showFilterDrawer && (
        <div className="rounded-[18px] p-3.5 bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#111318] dark:text-[#FFFFFF]">
              {t.tenants.docFilterHeading}
            </span>
            <span className="text-[11px] text-[#626A78] dark:text-[#98A1B2] tabular-nums">
              {visibleTenants.length} / {tenants.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: t.tenants.allStatuses },
              {
                id: 'not-provided',
                label:
                  t.domainLabels.docStatuses['not-provided'] ||
                  DOC_STATUS_LABELS['not-provided'],
              },
              {
                id: 'pending-review',
                label:
                  t.domainLabels.docStatuses['pending-review'] ||
                  DOC_STATUS_LABELS['pending-review'],
              },
              {
                id: 'reviewed-but-unverified',
                label:
                  t.domainLabels.docStatuses['reviewed-but-unverified'] ||
                  DOC_STATUS_LABELS['reviewed-but-unverified'],
              },
              {
                id: 'verified',
                label: t.domainLabels.docStatuses.verified || DOC_STATUS_LABELS.verified,
              },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDocFilter(item.id)}
                className={`min-h-[36px] px-3 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
                  docFilter === item.id
                    ? 'bg-[#0145F2] text-white border-[#0145F2]'
                    : 'bg-white dark:bg-[#111318] text-[#4B5563] dark:text-[#A1A1AA] border-[#E4E9F0] dark:border-[#262B32]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tenant Cards List */}
      {visibleTenants.length === 0 ? (
        <div className="rounded-[20px] p-6 bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] text-center space-y-2.5">
          <Users className="w-7 h-7 text-[#0145F2] mx-auto" />
          <div className="text-sm font-bold text-[#111318] dark:text-[#FFFFFF]">
            {t.tenants.noMatchTitle}
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            {(statusFilter !== 'all' || docFilter !== 'all' || search) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setDocFilter('all');
                  setSearch('');
                }}
                className="min-h-[40px] px-4 py-1.5 rounded-full bg-[#0145F2] text-white text-xs font-semibold"
              >
                {t.tenants.resetFiltersBtn}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenQuickAdd('tenant')}
              className="min-h-[40px] px-4 py-1.5 rounded-full border border-[#E4E9F0] dark:border-[#262B32] text-xs font-semibold text-[#111318] dark:text-white"
            >
              {t.tenants.addTenantBtn}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 pt-0.5">
          {visibleTenants.map((row) => (
            <Link
              key={row.tenant.id}
              to={`/tenants/${row.tenant.id}`}
              className="group rounded-[20px] px-3.5 py-3 bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] shadow-[0_2px_8px_rgba(17,19,24,0.02)] dark:shadow-none hover:border-[#0145F2]/50 transition-colors flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-[44px] h-[44px] rounded-full flex items-center justify-center text-[15px] font-bold tracking-[-0.01em] shrink-0 ${row.avatarMeta.className}`}
                >
                  {row.avatarMeta.initials}
                </div>
                <div className="min-w-0">
                  <div className="text-[15.5px] leading-[1.22] font-bold text-[#111318] dark:text-[#FFFFFF] truncate">
                    {row.tenant.fullName}
                  </div>
                  <div className="text-[12.5px] leading-[1.3] text-[#4B5563] dark:text-[#C4C9D1] mt-0.5 truncate">
                    {row.unitLabel} • {row.propertyLabel}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-end">
                  <div className="text-[15.5px] leading-[1.2] font-bold tabular-nums text-[#111318] dark:text-[#FFFFFF]">
                    {row.rentCents > 0 ? formatRandWhole(row.rentCents) : '—'}
                  </div>
                  {row.badgeType === 'paid' && (
                    <span className="mt-1 inline-flex items-center gap-1 px-2.5 py-[2px] rounded-full text-[11.5px] font-semibold bg-[#D9F7E4] dark:bg-[#0D3820] text-[#059D23] dark:text-[#2CE058]">
                      <CheckCircle2 className="w-[12px] h-[12px] stroke-[2.25]" />
                      {t.tenants.filterPaid}
                    </span>
                  )}
                  {row.badgeType === 'overdue' && (
                    <span className="mt-1 inline-flex items-center gap-1 px-2.5 py-[2px] rounded-full text-[11.5px] font-semibold bg-[#FEE2E4] dark:bg-[#471D23] text-[#E5252A] dark:text-[#FF7A82]">
                      <AlertTriangle className="w-[12px] h-[12px] stroke-[2.25]" />
                      {t.tenants.filterOverdue}
                    </span>
                  )}
                  {row.badgeType === 'renewal' && (
                    <span className="mt-1 inline-flex items-center gap-1 px-2.5 py-[2px] rounded-full text-[11.5px] font-semibold bg-[#DCEBFF] dark:bg-[#0E3166] text-[#0145F2] dark:text-[#5CA2FF]">
                      <Calendar className="w-[12px] h-[12px] stroke-[2.25]" />
                      {t.tenants.filterRenewal}
                    </span>
                  )}
                </div>
                <ChevronRight className="w-[18px] h-[18px] text-[#6B7280] dark:text-[#9CA3AF] stroke-[2]" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Unified Floating Primary Action Button (+) */}
      <div className="fixed bottom-[92px] left-1/2 -translate-x-1/2 w-full max-w-[430px] px-4 pointer-events-none z-30 flex justify-end">
        <button
          type="button"
          onClick={() => onOpenQuickAdd('menu')}
          aria-label={t.quickActions.title}
          className="pointer-events-auto w-[56px] h-[56px] rounded-full bg-[#0145F2] hover:bg-[#0039CC] active:scale-95 text-[#FFFFFF] shadow-[0_8px_22px_rgba(1,69,242,0.42)] flex items-center justify-center transition-all"
        >
          <Plus className="w-7 h-7 stroke-[2.25]" />
        </button>
      </div>
    </div>
  );
};

export const TenantProfileScreen: React.FC<{
  tenants: TenantProfile[];
  tenancies: Tenancy[];
  units: Unit[];
  properties?: Property[];
  charges?: Charge[];
  payments?: Payment[];
  adjustments?: LedgerAdjustment[];
  deposits?: DepositLiability[];
  identityEvidences: IdentityEvidence[];
  consentRecords: ConsentRecord[];
  messageLogs: MessageLog[];
  onOpenQuickAdd?: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
  onNotify: (msg: string) => void;
}> = ({
  tenants,
  tenancies,
  units,
  properties = [],
  charges = [],
  payments = [],
  adjustments = [],
  deposits = [],
  identityEvidences,
  consentRecords,
  messageLogs,
  onOpenQuickAdd,
  onNotify,
}) => {
  const { currentLanguage, t } = useLanguagePreference();
  const { tenantId } = useParams<{ tenantId: string }>();
  const tenant = tenants.find((x) => x.id === tenantId) || tenants[0];

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAltPhone, setEditAltPhone] = useState('');
  const [editAltContact, setEditAltContact] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editChannel, setEditChannel] = useState<CommunicationChannel>('whatsapp');
  const [editOccupants, setEditOccupants] = useState('1');
  const [editNotes, setEditNotes] = useState('');

  if (!tenant) {
    return (
      <div className="p-6 text-center text-sm text-[#626A78] dark:text-[#98A1B2]">
        {t.tenants.tenantNotFound}
      </div>
    );
  }

  const tenantTenancies = tenancies.filter((l) => l.primaryTenantId === tenant.id);
  const primaryTenancy =
    tenantTenancies.find((l) => l.status !== 'ended' && l.status !== 'terminated') ||
    tenantTenancies[0];
  const primaryUnit = primaryTenancy
    ? units.find((u) => u.id === primaryTenancy.unitId)
    : undefined;
  const primaryProperty = primaryTenancy
    ? properties.find((p) => p.id === primaryTenancy.propertyId)
    : undefined;
  const primarySummary = primaryTenancy
    ? computeTenancyLedgerSummary(primaryTenancy.id, charges, payments, adjustments, deposits)
    : undefined;
  const primaryCharges = primaryTenancy
    ? charges.filter((c) => c.tenancyId === primaryTenancy.id)
    : [];
  const primaryPayments = primaryTenancy
    ? payments.filter((p) => p.tenancyId === primaryTenancy.id)
    : [];

  const evidences = identityEvidences.filter((e) => e.tenantId === tenant.id);
  const consents = consentRecords.filter((c) => c.tenantId === tenant.id);
  const logs = messageLogs.filter((m) => m.tenantId === tenant.id);

  const openEditModal = () => {
    setEditFullName(tenant.fullName);
    setEditPhone(tenant.primaryPhone || '');
    setEditAltPhone(tenant.alternativePhone || '');
    setEditAltContact(tenant.alternativeContactName || '');
    setEditEmail(tenant.email || '');
    setEditChannel(tenant.preferredChannel);
    setEditOccupants(String(tenant.occupantsCount || 1));
    setEditNotes(tenant.notes || '');
    setEditError(null);
    setEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editSaving) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateTenantRecord(tenant.id, {
        fullName: editFullName,
        primaryPhone: editPhone,
        alternativePhone: editAltPhone,
        alternativeContactName: editAltContact,
        email: editEmail,
        preferredChannel: editChannel,
        occupantsCount: Number(editOccupants) || 1,
        notes: editNotes,
      });
      setEditOpen(false);
      onNotify(`Updated ${editFullName.trim()}`);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to update tenant details.');
    } finally {
      setEditSaving(false);
    }
  };

  const updateDocStatus = async (newStatus: DocumentationStatus) => {
    await db.tenantProfiles.update(tenant.id, {
      documentationStatus: newStatus,
      updatedAt: new Date().toISOString(),
    });
    const label = t.domainLabels.docStatuses[newStatus] || DOC_STATUS_LABELS[newStatus];
    onNotify(`${tenant.fullName}: ${label}`);
  };

  const whatsappContact = tenant.primaryPhone || tenant.alternativePhone;
  const whatsappText = primarySummary && primarySummary.netBalanceDueCents > 0
    ? `Hi ${tenant.fullName}, quick update regarding ${primaryUnit?.unitNumber || 'your unit'} (${primaryProperty?.name || 'property'}): current balance due is ${formatZAR(primarySummary.netBalanceDueCents)}. Please let us know once paid so we can send your receipt.`
    : `Hi ${tenant.fullName}, checking in regarding ${primaryUnit?.unitNumber || 'your unit'} at ${primaryProperty?.name || 'our property'}.`;
  const whatsappUrl = whatsappContact ? buildWhatsAppUrl(whatsappContact, whatsappText) : null;

  return (
    <div className="space-y-4 pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-2 text-xs text-[#626A78] dark:text-[#98A1B2]">
        <Link
          to="/tenants"
          className="min-h-[36px] inline-flex items-center gap-1.5 font-semibold hover:text-[#0145F2]"
        >
          <ArrowLeft className="w-4 h-4" />
          {currentLanguage.uiStrings.tenantsTitle}
        </Link>
        <button
          type="button"
          onClick={openEditModal}
          className="min-h-[36px] px-3 rounded-full bg-[#F9FBFE] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] text-[#0145F2] dark:text-[#5CA2FF] font-semibold inline-flex items-center gap-1.5 hover:border-[#0145F2]"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      </div>

      {/* Hero Profile Card */}
      <div className="p-4 rounded-[22px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] space-y-3.5">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-[#DAE9FD] dark:bg-[#154778] text-[#0145F2] dark:text-white flex items-center justify-center text-[16px] font-bold shrink-0">
            {getInitials(tenant.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-mono text-[#626A78] dark:text-[#98A1B2]">
              {tenant.tenantCode} · {tenant.preferredChannel} · {t.tenants.occupantsLabel}:{' '}
              {tenant.occupantsCount}
            </div>
            <h1 className="text-[20px] leading-tight font-bold text-[#111318] dark:text-[#FFFFFF] mt-0.5">
              {tenant.fullName}
            </h1>
            {primaryUnit && (
              <div className="text-[12.5px] font-medium text-[#0145F2] dark:text-[#5CA2FF] mt-0.5">
                {primaryUnit.unitNumber} · {primaryProperty?.name || 'Portfolio Property'}
              </div>
            )}
          </div>
        </div>

        <div className="text-[12px] text-[#4B5563] dark:text-[#C4C9D1] space-y-1">
          <div>
            {t.tenants.phoneLabel}:{' '}
            <span className="font-semibold text-[#111318] dark:text-white">
              {tenant.primaryPhone || t.tenants.noneAssisted}
            </span>
            {tenant.alternativePhone
              ? ` · ${t.tenants.altContactLabel}: ${tenant.alternativePhone}${
                  tenant.alternativeContactName ? ` (${tenant.alternativeContactName})` : ''
                }`
              : ''}
          </div>
          {tenant.email && (
            <div>
              {t.tenants.emailLabel}: <span className="font-medium">{tenant.email}</span>
            </div>
          )}
          {tenant.provisionalIdentifier && (
            <div>
              {t.tenants.provisionalIdLabel}: {tenant.provisionalIdentifier}
            </div>
          )}
          {tenant.notes && (
            <p className="text-[#626A78] dark:text-[#98A1B2] pt-1">{tenant.notes}</p>
          )}
        </div>

        {/* Live Balance Summary Strip */}
        {primaryTenancy && primarySummary && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E6ECF3] dark:border-[#262B31]">
            <div className="rounded-[14px] p-2.5 bg-[#F5F7FA] dark:bg-[#1E222A] text-center">
              <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                {t.tenants.monthlyRentLabel}
              </div>
              <div className="text-[13.5px] font-bold font-mono tabular-nums text-[#111318] dark:text-white mt-0.5">
                {formatZAR(primaryTenancy.rentAmountCents)}
              </div>
            </div>
            <div
              className={`rounded-[14px] p-2.5 text-center ${
                primarySummary.netBalanceDueCents > 0
                  ? 'bg-[#FFEEF0] dark:bg-[#2A171B]'
                  : 'bg-[#D9F7E4]/70 dark:bg-[#0D3820]/70'
              }`}
            >
              <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                {t.tenants.netBalanceDueLabel}
              </div>
              <div
                className={`text-[13.5px] font-bold font-mono tabular-nums mt-0.5 ${
                  primarySummary.netBalanceDueCents > 0
                    ? 'text-[#E5252A] dark:text-[#FF7A82]'
                    : 'text-[#059D23] dark:text-[#2CE058]'
                }`}
              >
                {formatZAR(Math.max(0, primarySummary.netBalanceDueCents))}
              </div>
            </div>
            <div className="rounded-[14px] p-2.5 bg-[#F5F7FA] dark:bg-[#1E222A] text-center">
              <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
                {t.tenants.depositLiabilityLabel}
              </div>
              <div className="text-[13.5px] font-bold font-mono tabular-nums text-[#0145F2] dark:text-[#5CA2FF] mt-0.5">
                {formatZAR(primarySummary.depositHeldLiabilityCents)}
              </div>
            </div>
          </div>
        )}

        {/* 3-Action Landlord Quick Bar */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            disabled={!primaryTenancy}
            onClick={() =>
              primaryTenancy &&
              onOpenQuickAdd?.('payment', {
                tenancyId: primaryTenancy.id,
                tenantId: tenant.id,
              })
            }
            className="min-h-[44px] px-2.5 rounded-[14px] bg-[#0145F2] hover:bg-[#0039CC] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-45"
          >
            <CreditCard className="w-3.5 h-3.5 shrink-0" />
            <span>Log Pay</span>
          </button>

          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] px-2.5 rounded-[14px] bg-[#D9F7E4] dark:bg-[#0D3820] text-[#059D23] dark:text-[#2CE058] text-[12px] font-semibold flex items-center justify-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              <span>WhatsApp</span>
            </a>
          ) : (
            <Link
              to={`/communications?tenantId=${tenant.id}`}
              className="min-h-[44px] px-2.5 rounded-[14px] bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF] text-[12px] font-semibold flex items-center justify-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Message</span>
            </Link>
          )}

          <button
            type="button"
            disabled={!primaryTenancy || !primarySummary}
            onClick={() =>
              primaryTenancy &&
              primarySummary &&
              downloadTenancyStatementPDF({
                tenancy: primaryTenancy,
                tenant,
                propertyUnitLabel: `${primaryProperty?.name || ''} — ${primaryUnit?.unitNumber || ''}`,
                summary: primarySummary,
                charges: primaryCharges,
                payments: primaryPayments,
              })
            }
            className="min-h-[44px] px-2.5 rounded-[14px] bg-[#F5F7FA] dark:bg-[#1E222A] border border-[#E6ECF3] dark:border-[#262B31] text-[#111318] dark:text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-45"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Statement</span>
          </button>
        </div>

        {/* Documentation Review Selector */}
        <div className="pt-2 border-t border-[#E6ECF3] dark:border-[#262B31] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label className="text-[12px] font-semibold text-[#4B5563] dark:text-[#C4C9D1]">
            {t.tenants.docReviewStatusLabel}
          </label>
          <select
            value={tenant.documentationStatus}
            onChange={(e) => updateDocStatus(e.target.value as DocumentationStatus)}
            className="min-h-[42px] px-3 py-1.5 rounded-[12px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[12.5px] font-semibold text-[#111318] dark:text-white"
          >
            <option value="not-provided">
              {t.domainLabels.docStatuses['not-provided'] || DOC_STATUS_LABELS['not-provided']}
            </option>
            <option value="pending-review">
              {t.domainLabels.docStatuses['pending-review'] || DOC_STATUS_LABELS['pending-review']}
            </option>
            <option value="reviewed-but-unverified">
              {t.domainLabels.docStatuses['reviewed-but-unverified'] ||
                DOC_STATUS_LABELS['reviewed-but-unverified']}
            </option>
            <option value="verified">
              {t.domainLabels.docStatuses.verified || DOC_STATUS_LABELS.verified}
            </option>
          </select>
        </div>
      </div>

      {/* Linked Tenancies & Communication History */}
      <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14.5px] font-bold text-[#111318] dark:text-white">
            {t.tenants.tenancyCommsHeading}
          </h2>
          {primaryTenancy && (
            <Link
              to={`/ledger?tenancyId=${primaryTenancy.id}`}
              className="text-[12px] font-semibold text-[#0145F2] dark:text-[#5CA2FF] hover:underline"
            >
              Open Ledger
            </Link>
          )}
        </div>
        <div className="divide-y divide-[#E6ECF3] dark:divide-[#262B31] text-xs">
          {tenantTenancies.length === 0 ? (
            <div className="py-2 text-[#626A78] dark:text-[#98A1B2] flex items-center justify-between gap-2">
              <span>No unit lease assigned yet.</span>
              <button
                type="button"
                onClick={() => onOpenQuickAdd?.('tenancy', { tenantId: tenant.id })}
                className="px-3 py-1.5 rounded-full bg-[#0145F2] text-white font-semibold"
              >
                Assign Unit
              </button>
            </div>
          ) : (
            tenantTenancies.map((l) => {
              const unit = units.find((u) => u.id === l.unitId);
              return (
                <div key={l.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/tenancies/${l.id}`}
                      className="font-bold text-[#111318] dark:text-white hover:text-[#0145F2] truncate block"
                    >
                      {l.tenancyReference} — {unit?.unitNumber || 'Unit'}
                    </Link>
                    <div className="text-[#626A78] dark:text-[#98A1B2] mt-0.5">
                      {t.properties.startPrefix}: {formatSADate(l.startDate)} · {t.common.status}:{' '}
                      {l.status}
                    </div>
                  </div>
                  <span className="font-mono font-bold tabular-nums text-[#111318] dark:text-white shrink-0">
                    {formatZAR(l.rentAmountCents)}/mo
                  </span>
                </div>
              );
            })
          )}
          {logs.map((m) => (
            <div key={m.id} className="py-2.5">
              <div className="font-semibold text-[#111318] dark:text-white">
                {m.subject}{' '}
                <span className="font-normal text-[#626A78] dark:text-[#98A1B2]">
                  ({m.channel} · {m.deliveryStatus})
                </span>
              </div>
              <div className="text-[#626A78] dark:text-[#98A1B2] mt-0.5">{m.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Identity Evidence & POPIA Consent */}
      <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#0145F2] dark:text-[#5CA2FF]" />
          <h2 className="text-[14.5px] font-bold text-[#111318] dark:text-white">
            {t.tenants.identityPopiaHeading}
          </h2>
        </div>
        <p className="text-[12px] text-[#626A78] dark:text-[#98A1B2]">
          {t.tenants.identityPopiaDesc}
        </p>
        <div className="divide-y divide-[#E6ECF3] dark:divide-[#262B31] text-xs">
          {evidences.map((ev) => (
            <div key={ev.id} className="py-2.5 space-y-1">
              <div className="font-semibold text-[#111318] dark:text-white">
                {t.domainLabels.docTypes[ev.documentationType] ||
                  DOC_TYPE_LABELS[ev.documentationType]}{' '}
                ·{' '}
                {t.domainLabels.docStatuses[ev.documentationStatus] ||
                  DOC_STATUS_LABELS[ev.documentationStatus]}
              </div>
              <div className="text-[#4B5563] dark:text-[#C4C9D1]">
                {t.tenants.hintPrefix}: {ev.referenceHint}
              </div>
              <div className="text-[#626A78] dark:text-[#98A1B2]">{ev.verificationNotes}</div>
            </div>
          ))}
          {consents.map((c) => (
            <div key={c.id} className="py-2.5 text-[#626A78] dark:text-[#98A1B2]">
              {t.tenants.popiaConsentPrefix} ({c.purpose}):{' '}
              {c.consentGranted ? t.tenants.grantedLabel : t.tenants.withdrawnLabel}{' '}
              {t.tenants.viaLabel} {c.recordedMethod} ({formatSADate(c.recordedAt)})
            </div>
          ))}
        </div>
      </div>

      {/* Inline Edit Tenant Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-[420px] max-h-[88vh] overflow-y-auto rounded-[24px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-5 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#111318] dark:text-white">
                Edit Tenant Details
              </h3>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                aria-label="Close"
                className="w-9 h-9 rounded-full bg-[#F5F7FA] dark:bg-[#22262E] flex items-center justify-center text-[#4B5563] dark:text-[#C4C9D1]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-[#FFEEF0] dark:bg-[#2A171B] border border-[#FAD6DA] dark:border-[#462127] text-[#E5252A] dark:text-[#FF7A82]"
              >
                {editError}
              </div>
            )}

            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                  Primary Phone / WhatsApp
                </label>
                <input
                  type="tel"
                  placeholder="082 123 4567"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                  Occupants
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editOccupants}
                  onChange={(e) => setEditOccupants(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                  Alternative Phone
                </label>
                <input
                  type="tel"
                  value={editAltPhone}
                  onChange={(e) => setEditAltPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                  Alt Contact Name
                </label>
                <input
                  type="text"
                  value={editAltContact}
                  onChange={(e) => setEditAltContact(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                  Email (Optional)
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                  Preferred Channel
                </label>
                <select
                  value={editChannel}
                  onChange={(e) => setEditChannel(e.target.value as CommunicationChannel)}
                  className="w-full min-h-[44px] px-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="phone_call">Phone Call</option>
                  <option value="in_person">In-Person</option>
                  <option value="printed_notice">Printed Notice</option>
                  <option value="portal_note">Portal Note</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#374151] dark:text-[#C4C9D1] mb-1">
                {t.common.notes}
              </label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full p-3 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[#111318] dark:text-white"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex-1 min-h-[44px] rounded-full border border-[#E6ECF3] dark:border-[#262B31] font-semibold text-[#111318] dark:text-white"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="flex-1 min-h-[44px] rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-white font-semibold disabled:opacity-60"
              >
                {editSaving ? t.common.saving : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const TenanciesScreen: React.FC<{
  tenancies: Tenancy[];
  tenants: TenantProfile[];
  units: Unit[];
  properties: Property[];
  charges: Charge[];
  payments: Payment[];
  adjustments: LedgerAdjustment[];
  deposits: DepositLiability[];
  onOpenQuickAdd: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
}> = ({
  tenancies,
  tenants,
  units,
  properties,
  charges,
  payments,
  adjustments,
  deposits,
  onOpenQuickAdd,
}) => {
  const { t } = useLanguagePreference();

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
            {t.tenants.tenanciesTitle}
          </h1>
          <p className="text-[13px] text-[#4B5563] dark:text-[#C4C9D1] mt-1">
            {t.tenants.tenanciesSubtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenQuickAdd('tenancy')}
          className="min-h-[44px] px-4 rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-white text-[12.5px] font-semibold flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t.tenants.createTenancyBtn}
        </button>
      </div>

      {tenancies.length === 0 ? (
        <div className="rounded-[20px] p-6 bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] text-center text-xs text-[#626A78] dark:text-[#98A1B2] space-y-3">
          <p>No active or past tenancies yet.</p>
          <button
            type="button"
            onClick={() => onOpenQuickAdd('tenancy')}
            className="min-h-[42px] px-4 rounded-full bg-[#0145F2] text-white font-semibold"
          >
            {t.tenants.createTenancyBtn}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tenancies.map((tenancy) => {
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

            return (
              <div
                key={tenancy.id}
                className="p-4 rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#626A78] dark:text-[#98A1B2]">
                    <span>
                      {tenancy.tenancyReference} · {tenancy.leaseCategory.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-sans font-semibold ${
                        tenancy.status === 'active'
                          ? 'bg-[#D9F7E4] dark:bg-[#0D3820] text-[#059D23] dark:text-[#2CE058]'
                          : 'bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#5CA2FF]'
                      }`}
                    >
                      {tenancy.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <Link
                    to={`/tenancies/${tenancy.id}`}
                    className="text-[16px] font-bold text-[#111318] dark:text-[#FFFFFF] hover:text-[#0145F2] block"
                  >
                    {tenant?.fullName || 'Tenant'} — {unit?.unitNumber || 'Unit'}
                  </Link>
                  <div className="text-[12px] text-[#626A78] dark:text-[#98A1B2]">
                    {property?.name} · {t.tenants.moveInPrefix}: {formatSADate(tenancy.moveInDate)}{' '}
                    · {t.tenants.dueDayPrefix}: {tenancy.dueDayOfMonth}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-[#E6ECF3] dark:border-[#262B31] text-xs">
                  <div>
                    <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                      {t.tenants.monthlyRentLabel}
                    </div>
                    <div className="font-mono font-bold tabular-nums text-[#111318] dark:text-white mt-0.5">
                      {formatZAR(tenancy.rentAmountCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                      {t.tenants.depositLiabilityLabel}
                    </div>
                    <div className="font-mono font-bold tabular-nums text-[#0145F2] dark:text-[#5CA2FF] mt-0.5">
                      {formatZAR(summary.depositHeldLiabilityCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">
                      {t.tenants.netBalanceDueLabel}
                    </div>
                    <div
                      className={`font-mono font-bold tabular-nums mt-0.5 ${
                        summary.netBalanceDueCents > 0
                          ? 'text-[#E5252A] dark:text-[#FF7A82]'
                          : 'text-[#059D23] dark:text-[#2CE058]'
                      }`}
                    >
                      {formatZAR(summary.netBalanceDueCents)}
                    </div>
                  </div>
                </div>

                <div className="pt-2.5 flex items-center justify-between border-t border-[#E6ECF3] dark:border-[#262B31] text-xs">
                  <span className="text-[11px] text-[#626A78] dark:text-[#98A1B2] truncate pr-2">
                    {tenancy.legalReviewStatus === 'practitioner_reviewed'
                      ? t.tenants.practitionerReviewed
                      : t.tenants.neutralTemplateNotice}
                  </span>
                  <Link
                    to={`/tenancies/${tenancy.id}`}
                    className="font-semibold text-[#0145F2] dark:text-[#5CA2FF] hover:underline shrink-0"
                  >
                    {t.tenants.openAgreementLedgerLink}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TenancyDetailScreen: React.FC<{
  tenancies: Tenancy[];
  tenants: TenantProfile[];
  units: Unit[];
  properties: Property[];
  participants: TenancyParticipant[];
  leaseVersions: LeaseVersion[];
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
  participants,
  leaseVersions,
  charges,
  payments,
  adjustments,
  deposits,
  onNotify,
}) => {
  const { t } = useLanguagePreference();
  const { tenancyId } = useParams<{ tenancyId: string }>();
  const tenancy = tenancies.find((x) => x.id === tenancyId) || tenancies[0];

  if (!tenancy) {
    return (
      <div className="p-6 text-center text-sm text-[#626A78] dark:text-[#98A1B2]">
        {t.tenants.tenancyNotFound}
      </div>
    );
  }

  const tenant = tenants.find((x) => x.id === tenancy.primaryTenantId);
  const unit = units.find((u) => u.id === tenancy.unitId);
  const property = properties.find((p) => p.id === tenancy.propertyId);
  const tenancyParticipants = participants.filter((p) => p.tenancyId === tenancy.id);
  const versions = leaseVersions.filter((v) => v.tenancyId === tenancy.id);
  const tenancyCharges = charges.filter((c) => c.tenancyId === tenancy.id);
  const tenancyPayments = payments.filter((p) => p.tenancyId === tenancy.id);
  const summary = computeTenancyLedgerSummary(
    tenancy.id,
    charges,
    payments,
    adjustments,
    deposits
  );

  const handleStatusChange = async (newStatus: Tenancy['status']) => {
    try {
      await updateTenancyStatus(tenancy.id, newStatus);
      onNotify(`${tenancy.tenancyReference}: ${newStatus}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update tenancy status.');
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-2 text-xs text-[#626A78] dark:text-[#98A1B2]">
        <Link
          to="/tenancies"
          className="min-h-[36px] inline-flex items-center gap-1.5 font-semibold hover:text-[#0145F2]"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.appShell.moreToolsItems.tenanciesLeases}
        </Link>
        <span>/</span>
        <span className="text-[#111318] dark:text-white font-semibold">
          {tenancy.tenancyReference}
        </span>
      </div>

      {/* Legal Notice Banner */}
      <div className="p-3.5 rounded-[18px] bg-[#FEF2D6] dark:bg-[#3A2B12] border border-[#F5A623]/35 text-[12px] text-[#7A4B00] dark:text-[#FFD479] leading-relaxed">
        <strong>{t.tenants.legalNoticeTitle}:</strong> {t.tenants.legalNoticeBody}
      </div>

      {/* Agreement Header Card */}
      <div className="p-4 rounded-[22px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] space-y-3.5">
        <div className="space-y-1">
          <div className="text-[11px] font-mono text-[#626A78] dark:text-[#98A1B2]">
            {tenancy.tenancyReference} · {tenancy.leaseCategory.replace(/_/g, ' ')}
          </div>
          <h1 className="text-[19px] leading-tight font-bold text-[#111318] dark:text-[#FFFFFF]">
            {tenant?.fullName || 'Tenant'} — {property?.name} ({unit?.unitNumber})
          </h1>
          <div className="text-[12px] text-[#626A78] dark:text-[#98A1B2]">
            {t.tenants.moveInPrefix}: {formatSADate(tenancy.moveInDate)} ·{' '}
            {t.tenants.noticePeriodPrefix}: {tenancy.noticePeriodDays}d ·{' '}
            {t.tenants.dueDayPrefix} {tenancy.dueDayOfMonth}
          </div>
          {tenancy.specialTerms && (
            <p className="text-[12px] text-[#4B5563] dark:text-[#C4C9D1] pt-1">
              {tenancy.specialTerms}
            </p>
          )}
        </div>

        {/* Derived Balance + Deposit Strip */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E6ECF3] dark:border-[#262B31]">
          <div className="rounded-[14px] p-2.5 bg-[#F5F7FA] dark:bg-[#1E222A] text-center">
            <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
              {t.tenants.monthlyRentLabel}
            </div>
            <div className="text-[13px] font-bold font-mono tabular-nums text-[#111318] dark:text-white mt-0.5">
              {formatZAR(tenancy.rentAmountCents)}
            </div>
          </div>
          <div className="rounded-[14px] p-2.5 bg-[#F5F7FA] dark:bg-[#1E222A] text-center">
            <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
              {t.tenants.depositLiabilityLabel}
            </div>
            <div className="text-[13px] font-bold font-mono tabular-nums text-[#0145F2] dark:text-[#5CA2FF] mt-0.5">
              {formatZAR(summary.depositHeldLiabilityCents)}
            </div>
          </div>
          <div className="rounded-[14px] p-2.5 bg-[#F5F7FA] dark:bg-[#1E222A] text-center">
            <div className="text-[10.5px] text-[#626A78] dark:text-[#98A1B2]">
              {t.tenants.netBalanceDueLabel}
            </div>
            <div
              className={`text-[13px] font-bold font-mono tabular-nums mt-0.5 ${
                summary.netBalanceDueCents > 0
                  ? 'text-[#E5252A] dark:text-[#FF7A82]'
                  : 'text-[#059D23] dark:text-[#2CE058]'
              }`}
            >
              {formatZAR(summary.netBalanceDueCents)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            value={tenancy.status}
            onChange={(e) => handleStatusChange(e.target.value as Tenancy['status'])}
            className="flex-1 min-h-[44px] px-3 py-1.5 rounded-[14px] border border-[#E6ECF3] dark:border-[#262B31] bg-[#F5F7FA] dark:bg-[#1E222A] text-[12.5px] font-semibold text-[#111318] dark:text-white"
          >
            <option value="active">{t.tenants.statusActive}</option>
            <option value="notice_given">{t.tenants.statusNoticeGiven}</option>
            <option value="renewing">{t.tenants.statusRenewing}</option>
            <option value="ended">{t.tenants.statusEnded}</option>
            <option value="terminated">{t.tenants.statusTerminated}</option>
          </select>

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
            className="min-h-[44px] px-4 rounded-[14px] bg-[#0145F2] hover:bg-[#0039CC] text-white text-[12.5px] font-semibold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            {t.tenants.pdfStatementBtn}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          <Link
            to={`/ledger?tenancyId=${tenancy.id}`}
            className="font-semibold text-[#0145F2] dark:text-[#5CA2FF] hover:underline"
          >
            Open Rent Ledger &amp; Deposit Controls
          </Link>
          {tenant && (
            <Link
              to={`/tenants/${tenant.id}`}
              className="font-semibold text-[#4B5563] dark:text-[#C4C9D1] hover:underline"
            >
              View Tenant Profile
            </Link>
          )}
        </div>
      </div>

      {/* Occupants & Agreement Versions */}
      <div className="space-y-3">
        <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-4 space-y-2.5">
          <h2 className="text-[14.5px] font-bold text-[#111318] dark:text-white">
            {t.tenants.authorizedOccupantsHeading}
          </h2>
          <div className="divide-y divide-[#E6ECF3] dark:divide-[#262B31] text-xs">
            {tenancyParticipants.map((p) => (
              <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                <span className="font-semibold text-[#111318] dark:text-white">{p.fullName}</span>
                <span className="text-[#626A78] dark:text-[#98A1B2]">
                  {p.role.replace(/_/g, ' ')} · {formatSADate(p.joinedDate)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E6ECF3] dark:border-[#262B31] p-4 space-y-2.5">
          <h2 className="text-[14.5px] font-bold text-[#111318] dark:text-white">
            {t.tenants.agreementVersionsHeading}
          </h2>
          <div className="divide-y divide-[#E6ECF3] dark:divide-[#262B31] text-xs">
            {versions.map((v) => (
              <div key={v.id} className="py-2.5 space-y-0.5">
                <div className="font-semibold text-[#111318] dark:text-white tabular-nums">
                  v{v.versionNumber} · {formatSADate(v.effectiveDate)} ·{' '}
                  {formatZAR(v.rentAmountCents)}
                </div>
                <div className="text-[#4B5563] dark:text-[#C4C9D1]">{v.termsSummary}</div>
                <div className="text-[#626A78] dark:text-[#98A1B2]">{v.templateTitle}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
