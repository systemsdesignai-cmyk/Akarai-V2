import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Home,
  Layers,
  MapPin,
  Pencil,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  ApplicationSettings,
  Charge,
  Expense,
  MaintenanceTicket,
  OwnerEntity,
  Portfolio,
  Property,
  PropertyCategory,
  Tenancy,
  TenantProfile,
  Unit,
  UnitStatus,
  UnitType,
} from '../types/domain';
import {
  formatSADate,
  formatZAR,
  parseZARToCents,
  PROPERTY_CATEGORY_LABELS,
  todayIso,
  UNIT_TYPE_LABELS,
} from '../utils/format';
import { updatePropertyRecord, updateUnitRecord } from '../services/domainService';
import type { QuickAddPrefill, QuickAddTab } from '../components/QuickAddModal';
import { tFormat, useLanguagePreference } from '../components/DesignSystem';
import { resolveAssetUrl } from '../utils/assetUrl';

type PropertyFilterTab = 'all' | 'occupied' | 'vacant' | 'overdue';

const FALLBACK_THUMBNAILS = [
  '/assets/thumb-riverside.png',
  '/assets/thumb-maple.png',
  '/assets/thumb-elmwood.png',
  '/assets/thumb-cedar.png',
];

export const PropertyDirectoryScreen: React.FC<{
  settings?: ApplicationSettings;
  ownerEntities: OwnerEntity[];
  portfolios: Portfolio[];
  properties: Property[];
  units: Unit[];
  tenancies: Tenancy[];
  charges?: Charge[];
  onOpenQuickAdd: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
}> = ({
  settings,
  properties,
  units,
  tenancies,
  charges = [],
  onOpenQuickAdd,
}) => {
  const { currentLanguage, t } = useLanguagePreference();
  const [activeFilter, setActiveFilter] = useState<PropertyFilterTab>('all');
  const today = todayIso();

  const isManager = settings?.activeRole === 'manager';
  const allowedPropIds = isManager
    ? settings?.assignedPropertyIdsForManager || ['prop-bree-mixed', 'prop-cedar']
    : properties.map((p) => p.id);

  const scopedProperties = properties.filter((p) => allowedPropIds.includes(p.id) && !p.isDeleted);
  const scopedUnits = units.filter((u) => allowedPropIds.includes(u.propertyId) && !u.isDeleted);

  const propertyRows = scopedProperties.map((prop, index) => {
    const propUnits = scopedUnits.filter((u) => u.propertyId === prop.id);
    const occupiedUnitsCount = propUnits.filter((u) => {
      const hasActiveTenancy = tenancies.some(
        (ten) => ten.unitId === u.id && ten.status !== 'ended' && ten.status !== 'terminated'
      );
      return u.status === 'occupied' || hasActiveTenancy;
    }).length;
    const vacantUnitsCount = Math.max(0, propUnits.length - occupiedUnitsCount);

    const overdueTenancyIds = new Set(
      charges
        .filter(
          (c) =>
            c.propertyId === prop.id &&
            !c.isDeleted &&
            c.status !== 'reversed' &&
            c.status !== 'paid' &&
            c.status !== 'waived' &&
            Math.max(0, c.amountCents + c.adjustedCents - c.allocatedPaidCents) > 0 &&
            (c.status === 'overdue' || c.dueDate < today)
        )
        .map((c) => c.tenancyId)
    );
    const overdueCount = overdueTenancyIds.size;

    return {
      property: prop,
      index,
      totalUnitsCount: propUnits.length,
      occupiedUnitsCount,
      vacantUnitsCount,
      overdueCount,
    };
  });

  const filteredRows = propertyRows.filter((row) => {
    if (activeFilter === 'occupied') return row.occupiedUnitsCount > 0;
    if (activeFilter === 'vacant') return row.vacantUnitsCount > 0;
    if (activeFilter === 'overdue') return row.overdueCount > 0;
    return true;
  });

  const totalPropertiesCount = scopedProperties.length;
  const totalUnitsCount = scopedUnits.length;
  const totalOccupiedUnitsCount = propertyRows.reduce((sum, r) => sum + r.occupiedUnitsCount, 0);
  const occupancyPercentage =
    totalUnitsCount > 0 ? Math.floor((totalOccupiedUnitsCount / totalUnitsCount) * 100) : 0;

  const ringRadius = 25.5;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringStrokeDashoffset =
    ringCircumference - (Math.min(100, Math.max(0, occupancyPercentage)) / 100) * ringCircumference;

  const filterOptions: { id: PropertyFilterTab; label: string }[] = [
    { id: 'all', label: t.properties.filterAll },
    { id: 'occupied', label: t.properties.filterOccupied },
    { id: 'vacant', label: t.properties.filterVacant },
    { id: 'overdue', label: t.properties.filterOverdue },
  ];

  return (
    <div className="w-full space-y-4 pb-28 relative">
      <div className="pt-1">
        <h1 className="text-[31px] leading-[1.12] font-bold tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
          {currentLanguage.uiStrings.propertiesTitle}
        </h1>
        <p className="text-[14.5px] leading-[1.35] text-[#5A606D] dark:text-[#A1A1AA] mt-1">
          {currentLanguage.uiStrings.propertiesSubtitle}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Filter properties by occupancy or overdue status"
        className="grid grid-cols-4 gap-2 pt-0.5"
      >
        {filterOptions.map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveFilter(tab.id)}
              className={`min-h-[44px] px-2.5 rounded-full text-[13px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2] ${
                isActive
                  ? 'bg-[#0145F2] text-[#FFFFFF] border border-[#0145F2] shadow-[0_2px_8px_rgba(1,69,242,0.25)]'
                  : 'bg-[#FFFFFF] dark:bg-[#0D0E10] text-[#111318] dark:text-[#E4E4E7] border border-[#E4E9F0] dark:border-[#222428] shadow-[0_1px_4px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* D. Property Overview — Three Compact Metric Cards */}
      <div className="grid grid-cols-3 gap-2.5 pt-0.5">
        {/* 1. Total Properties */}
        <div className="rounded-[20px] p-3.5 bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E6EBF2] dark:border-[#222428] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none flex flex-col justify-between min-h-[112px]">
          <div className="w-[34px] h-[34px] rounded-[10px] bg-[#CCE0FC] dark:bg-[#042D7D] flex items-center justify-center text-[#0145F2] dark:text-[#E2ECFF]">
            <Home className="w-[18px] h-[18px] stroke-[2]" />
          </div>
          <div className="mt-2.5">
            <div className="text-[26px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
              {totalPropertiesCount}
            </div>
            <div className="text-[13px] text-[#5A606D] dark:text-[#A1A1AA] mt-1 font-normal">
              {t.common.properties}
            </div>
          </div>
        </div>

        {/* 2. Total Units */}
        <div className="rounded-[20px] p-3.5 bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E6EBF2] dark:border-[#222428] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none flex flex-col justify-between min-h-[112px]">
          <div className="w-[34px] h-[34px] rounded-[10px] bg-[#CCE0FC] dark:bg-[#042D7D] flex items-center justify-center text-[#0145F2] dark:text-[#E2ECFF]">
            <Layers className="w-[18px] h-[18px] stroke-[2]" />
          </div>
          <div className="mt-2.5">
            <div className="text-[26px] leading-none font-bold tabular-nums tracking-[-0.02em] text-[#111318] dark:text-[#FFFFFF]">
              {totalUnitsCount}
            </div>
            <div className="text-[13px] text-[#5A606D] dark:text-[#A1A1AA] mt-1 font-normal">
              {t.common.units}
            </div>
          </div>
        </div>

        {/* 3. Occupancy Percentage Ring */}
        <div className="rounded-[20px] px-3 py-3 bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E6EBF2] dark:border-[#222428] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none flex flex-col items-center justify-between min-h-[112px]">
          <div className="relative w-[64px] h-[64px] flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
              <circle
                cx="32"
                cy="32"
                r={ringRadius}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-[#CCE0FC] dark:text-[#042D7D]"
              />
              <circle
                cx="32"
                cy="32"
                r={ringRadius}
                fill="none"
                stroke="#0145F2"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringStrokeDashoffset}
              />
            </svg>
            <span className="absolute text-[15px] font-bold tabular-nums tracking-[-0.02em] text-[#0145F2] dark:text-[#FFFFFF]">
              {totalUnitsCount > 0 ? `${occupancyPercentage}%` : '0%'}
            </span>
          </div>
          <div className="text-[13px] text-[#5A606D] dark:text-[#A1A1AA] font-normal text-center">
            {t.properties.occupancyLabel}
          </div>
        </div>
      </div>

      {/* E. Property List — Premium Rounded Horizontal Cards */}
      {filteredRows.length === 0 ? (
        <div className="rounded-[22px] p-7 bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E6EBF2] dark:border-[#222428] text-center space-y-3">
          <Building2 className="w-8 h-8 text-[#0145F2] mx-auto" />
          <div className="text-sm font-bold text-[#111318] dark:text-[#FFFFFF]">
            {t.properties.noMatchTitle}
          </div>
          <p className="text-xs text-[#5A606D] dark:text-[#A1A1AA] max-w-xs mx-auto">
            {t.properties.noMatchDesc}
          </p>
          <div className="pt-1 flex items-center justify-center gap-2">
            {activeFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#0145F2] text-[#FFFFFF] text-xs font-semibold"
              >
                {t.properties.showAllBtn}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenQuickAdd('property')}
              className="min-h-[38px] px-4 py-1.5 rounded-full border border-[#E4E9F0] dark:border-[#222428] text-xs font-semibold"
            >
              {t.properties.addPropertyBtn}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 pt-0.5">
          {filteredRows.map(
            ({
              property,
              index,
              totalUnitsCount: propUnitsLen,
              occupiedUnitsCount,
              vacantUnitsCount,
              overdueCount,
            }) => {
              const showOverdueBadge =
                overdueCount > 0 && activeFilter !== 'occupied' && activeFilter !== 'vacant';
              const showVacantBadge =
                !showOverdueBadge &&
                (activeFilter === 'vacant' ||
                  (occupiedUnitsCount === 0 && vacantUnitsCount > 0));

              const locationLabel = property.suburb
                ? `${property.suburb.split(',')[0].trim()}`
                : property.city;

              const thumbSrc =
                property.thumbnailUrl ||
                FALLBACK_THUMBNAILS[index % FALLBACK_THUMBNAILS.length];

              return (
                <Link
                  key={property.id}
                  to={`/properties/${property.id}`}
                  className="group rounded-[20px] p-2.5 pr-3 bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E6EBF2] dark:border-[#222428] shadow-[0_2px_10px_rgba(17,19,24,0.03)] dark:shadow-none hover:border-[#0145F2]/60 dark:hover:border-[#363940] transition-colors flex items-center justify-between gap-3"
                >
                  {/* Left Rectangular Architectural Thumbnail (153x134 ratio -> 73px x 64px) */}
                  <div className="w-[73px] h-[64px] rounded-[13px] overflow-hidden shrink-0 bg-transparent">
                    <img
                      src={resolveAssetUrl(thumbSrc)}
                      alt={property.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Middle Property Info */}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[16.5px] font-bold tracking-[-0.01em] text-[#111318] dark:text-[#FFFFFF] truncate leading-[1.22]">
                      {property.name.replace(/\s*\(Fictional\)\s*/i, '')}
                    </h2>

                    <div className="flex items-center gap-1.5 text-[13px] text-[#374151] dark:text-[#D4D4D8] mt-1 leading-tight">
                      <MapPin className="w-[13px] h-[13px] text-[#111318] dark:text-[#A1A1AA] shrink-0 stroke-[2]" />
                      <span className="truncate">{locationLabel}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[13px] text-[#374151] dark:text-[#D4D4D8] mt-1 leading-tight">
                      <Building2 className="hidden dark:block w-[13px] h-[13px] text-[#A1A1AA] shrink-0 stroke-[1.9]" />
                      <span
                        className="block dark:hidden w-[8px] h-[11px] rounded-full bg-[#B9C0CC] shrink-0"
                        aria-hidden="true"
                      />
                      <span className="tabular-nums font-medium">
                        {propUnitsLen} {propUnitsLen === 1 ? t.common.unit : t.common.units}
                      </span>
                    </div>
                  </div>

                  {/* Right Status Badge & Navigation Chevron */}
                  <div className="flex items-center gap-2 shrink-0">
                    {showOverdueBadge ? (
                      <span className="h-[29px] px-3 rounded-[9px] bg-[#FEDADA] dark:bg-[#531618] text-[#E82C33] dark:text-[#FFD8D8] text-[12px] font-semibold tabular-nums whitespace-nowrap flex items-center justify-center">
                        {overdueCount} {t.common.overdue}
                      </span>
                    ) : showVacantBadge ? (
                      <span className="h-[29px] px-3 rounded-[9px] bg-[#EDF1F5] dark:bg-[#18191C] text-[#4B5563] dark:text-[#D4D4D8] text-[12px] font-semibold tabular-nums whitespace-nowrap flex items-center justify-center">
                        {vacantUnitsCount} {t.common.vacant}
                      </span>
                    ) : (
                      <span className="h-[29px] px-3 rounded-[9px] bg-[#D6E5FA] dark:bg-[#072156] text-[#0145F2] dark:text-[#DCE8FF] text-[12px] font-semibold tabular-nums whitespace-nowrap flex items-center justify-center">
                        {occupiedUnitsCount} {t.common.occupied}
                      </span>
                    )}

                    <ChevronRight className="w-[16px] h-[16px] text-[#6B7280] dark:text-[#A1A1AA] group-hover:translate-x-0.5 transition-transform shrink-0 stroke-[2]" />
                  </div>
                </Link>
              );
            }
          )}
        </div>
      )}

      {/* Unified Circular Electric-Blue Floating Action Button ("+") */}
      <div className="fixed bottom-[92px] left-0 right-0 z-30 pointer-events-none">
        <div className="max-w-[430px] mx-auto px-4 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenQuickAdd('menu')}
            aria-label={t.dashboard.openQuickActionsAria}
            title={t.quickActions.title}
            className="pointer-events-auto w-[56px] h-[56px] rounded-full bg-[#0145F2] hover:bg-[#0139C9] active:scale-95 text-[#FFFFFF] shadow-[0_6px_20px_rgba(1,69,242,0.4)] flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0145F2]"
          >
            <Plus className="w-[27px] h-[27px] stroke-[2.2]" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const PropertyDetailScreen: React.FC<{
  properties: Property[];
  units: Unit[];
  tenancies: Tenancy[];
  tenants: TenantProfile[];
  expenses: Expense[];
  maintenanceTickets: MaintenanceTicket[];
  onOpenQuickAdd: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
  onNotify?: (msg: string) => void;
}> = ({
  properties,
  units,
  tenancies,
  tenants,
  expenses,
  maintenanceTickets,
  onOpenQuickAdd,
  onNotify,
}) => {
  const { t } = useLanguagePreference();
  const { propertyId } = useParams<{ propertyId: string }>();
  const property = properties.find((p) => p.id === propertyId) || properties[0];

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(property?.name || '');
  const [editCategory, setEditCategory] = useState<PropertyCategory>(property?.category || 'residential');
  const [editStreet, setEditStreet] = useState(property?.streetAddress || '');
  const [editSuburb, setEditSuburb] = useState(property?.suburb || '');
  const [editCity, setEditCity] = useState(property?.city || '');
  const [saving, setSaving] = useState(false);

  if (!property) {
    return (
      <div className="p-6 rounded-2xl bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E4E9F0] dark:border-[#222428]">
        <p className="text-sm">{t.properties.notFound}</p>
        <Link to="/properties" className="text-xs text-[#0145F2] hover:underline mt-2 inline-block">
          {t.properties.backToProperties}
        </Link>
      </div>
    );
  }

  const propUnits = units.filter((u) => u.propertyId === property.id && !u.isDeleted);
  const propExpenses = expenses.filter((e) => e.propertyId === property.id && !e.isDeleted);
  const propTickets = maintenanceTickets.filter((m) => m.propertyId === property.id && !m.isDeleted);

  const openEditModal = () => {
    setEditName(property.name);
    setEditCategory(property.category);
    setEditStreet(property.streetAddress);
    setEditSuburb(property.suburb);
    setEditCity(property.city);
    setEditOpen(true);
  };

  const handleSaveProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updatePropertyRecord(property.id, {
        name: editName,
        category: editCategory,
        streetAddress: editStreet,
        suburb: editSuburb,
        city: editCity,
      });
      onNotify?.(`Updated "${editName}"`);
      setEditOpen(false);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Unable to update property.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center gap-2 text-xs text-[#5A606D] dark:text-[#A1A1AA]">
        <Link to="/properties" className="hover:underline flex items-center gap-1 min-h-[36px]">
          <ArrowLeft className="w-3.5 h-3.5" /> {t.common.properties}
        </Link>
        <span>/</span>
        <span className="text-[#111318] dark:text-[#FFFFFF] font-medium truncate">
          {property.name}
        </span>
      </div>

      <div className="p-4 rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {property.thumbnailUrl && (
              <img
                src={resolveAssetUrl(property.thumbnailUrl)}
                alt={property.name}
                className="w-16 h-14 rounded-xl object-cover shrink-0"
              />
            )}
            <div className="space-y-0.5 min-w-0">
              <div className="text-[11.5px] text-[#5A606D] dark:text-[#A1A1AA] truncate">
                {t.domainLabels.propertyCategories[property.category] ||
                  PROPERTY_CATEGORY_LABELS[property.category]}
              </div>
              <h1 className="text-[19px] font-bold text-[#111318] dark:text-[#FFFFFF] leading-tight">
                {property.name}
              </h1>
              <div className="text-[12px] text-[#5A606D] dark:text-[#D4D4D8]">
                {property.streetAddress}, {property.suburb}, {property.city}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={openEditModal}
            aria-label="Edit property details"
            className="w-10 h-10 rounded-full bg-[#EDF1F5] dark:bg-[#232830] text-[#0145F2] dark:text-[#68A2FF] flex items-center justify-center shrink-0 hover:bg-[#DDE7F8]"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenQuickAdd('unit', { propertyId: property.id })}
            className="min-h-[44px] px-3.5 rounded-[14px] bg-[#0145F2] hover:bg-[#0039CC] text-[#FFFFFF] text-[12.5px] font-bold flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>{t.properties.addUnitBtn}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenQuickAdd('expense', { propertyId: property.id })}
            className="min-h-[44px] px-3.5 rounded-[14px] border border-[#E4E9F0] dark:border-[#262B31] bg-[#F9FBFE] dark:bg-[#1E242D] text-[12.5px] font-semibold text-[#111318] dark:text-white"
          >
            {t.properties.recordExpenseBtn}
          </button>
        </div>
      </div>

      {/* Mobile-First Rentable Unit Cards */}
      <div className="space-y-2.5">
        <h2 className="text-[15.5px] font-bold text-[#111318] dark:text-white px-0.5">
          {t.properties.rentableUnitsHeading} ({propUnits.length})
        </h2>

        {propUnits.length === 0 ? (
          <div className="rounded-[18px] p-5 bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] text-center space-y-2">
            <p className="text-xs text-[#626A78] dark:text-[#98A1B2]">
              No units added to {property.name} yet.
            </p>
            <button
              type="button"
              onClick={() => onOpenQuickAdd('unit', { propertyId: property.id })}
              className="min-h-[40px] px-4 rounded-full bg-[#0145F2] text-white text-xs font-bold"
            >
              Add First Unit
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {propUnits.map((u) => {
              const tenancy = tenancies.find(
                (ten) => ten.unitId === u.id && ten.status !== 'ended' && ten.status !== 'terminated'
              );
              const tenant = tenancy ? tenants.find((x) => x.id === tenancy.primaryTenantId) : undefined;
              const isOccupied = u.status === 'occupied' || Boolean(tenancy);

              return (
                <div
                  key={u.id}
                  className="rounded-[18px] p-3.5 bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <Link to={`/units/${u.id}`} className="min-w-0 flex-1 hover:underline">
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-bold text-[#111318] dark:text-white">
                          {u.unitNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                            isOccupied
                              ? 'bg-[#D6E5FA] dark:bg-[#072156] text-[#0145F2] dark:text-[#DCE8FF]'
                              : 'bg-[#EDF1F5] dark:bg-[#232830] text-[#4B5563] dark:text-[#D4D4D8]'
                          }`}
                        >
                          {isOccupied ? t.common.occupied : t.common.vacant}
                        </span>
                      </div>
                      <div className="text-[12.5px] text-[#4B5563] dark:text-[#C4C9D1] mt-0.5 truncate">
                        {u.name} · {t.domainLabels.unitTypes[u.unitType] || UNIT_TYPE_LABELS[u.unitType]}
                      </div>
                    </Link>

                    <div className="text-right shrink-0">
                      <div className="text-[14.5px] font-bold font-mono tabular-nums text-[#111318] dark:text-white">
                        {formatZAR(u.standardRentCents)}
                      </div>
                      <div className="text-[11px] text-[#626A78] dark:text-[#98A1B2]">/month</div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#EDF1F5] dark:border-[#262B31] flex items-center justify-between gap-2 text-[12px]">
                    {tenant ? (
                      <Link
                        to={`/tenants/${tenant.id}`}
                        className="font-semibold text-[#0145F2] dark:text-[#68A2FF] hover:underline truncate"
                      >
                        Tenant: {tenant.fullName}
                      </Link>
                    ) : (
                      <span className="text-[#626A78] dark:text-[#98A1B2]">Ready for move-in</span>
                    )}

                    <div className="flex items-center gap-2 shrink-0">
                      {!isOccupied && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenQuickAdd('tenancy', { propertyId: property.id, unitId: u.id })
                          }
                          className="min-h-[34px] px-2.5 rounded-full bg-[#E7F0FF] dark:bg-[#132247] text-[#0145F2] dark:text-[#68A2FF] text-[11.5px] font-bold inline-flex items-center gap-1"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Assign</span>
                        </button>
                      )}
                      <Link
                        to={`/units/${u.id}`}
                        className="min-h-[34px] px-2.5 rounded-full bg-[#EDF1F5] dark:bg-[#232830] text-[#111318] dark:text-white text-[11.5px] font-semibold inline-flex items-center gap-1"
                      >
                        <span>Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Operating Expenses & Maintenance */}
      <div className="grid grid-cols-1 gap-3.5">
        <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] p-4 space-y-2.5">
          <h3 className="text-sm font-bold text-[#111318] dark:text-white">
            {t.properties.operatingExpensesHeading}
          </h3>
          {propExpenses.length === 0 ? (
            <p className="text-xs text-[#5A606D] dark:text-[#A1A1AA]">{t.properties.noExpenses}</p>
          ) : (
            <div className="divide-y divide-[#EDF1F5] dark:divide-[#262B31] text-xs">
              {propExpenses.map((e) => (
                <div key={e.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#111318] dark:text-white truncate">
                      {e.description}
                    </div>
                    <div className="text-[#5A606D] dark:text-[#A1A1AA]">
                      {formatSADate(e.incurredDate)} · {e.vendorName || e.category}
                    </div>
                  </div>
                  <span className="font-mono font-bold tabular-nums shrink-0">
                    {formatZAR(e.amountCents)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] p-4 space-y-2.5">
          <h3 className="text-sm font-bold text-[#111318] dark:text-white">
            {t.properties.maintenanceTicketsHeading}
          </h3>
          {propTickets.length === 0 ? (
            <p className="text-xs text-[#5A606D] dark:text-[#A1A1AA]">{t.properties.noTickets}</p>
          ) : (
            <div className="divide-y divide-[#EDF1F5] dark:divide-[#262B31] text-xs">
              {propTickets.map((tkt) => (
                <Link key={tkt.id} to={`/maintenance/${tkt.id}`} className="py-2.5 block hover:underline">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#111318] dark:text-white truncate">
                      {tkt.title}
                    </span>
                    <span className="font-mono text-[#5A606D] dark:text-[#A1A1AA] shrink-0">
                      {tkt.ticketNumber}
                    </span>
                  </div>
                  <div className="text-[#5A606D] dark:text-[#A1A1AA] mt-0.5">
                    {t.domainLabels.maintenanceStatuses[tkt.status] || tkt.status} · {tkt.priority}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Property Modal */}
      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[1px]"
          onClick={() => setEditOpen(false)}
        >
          <form
            onSubmit={handleSaveProperty}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[430px] rounded-t-[26px] bg-[#F6F8FC] dark:bg-[#171C23] border-t border-[#E4E9F2] dark:border-[#272E38] p-5 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-[#111318] dark:text-white">
                Edit Property
              </h2>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#626A78]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label htmlFor="edit-prop-name" className="block font-semibold mb-1">
                Property Name
              </label>
              <input
                id="edit-prop-name"
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
              />
            </div>
            <div>
              <label htmlFor="edit-prop-cat" className="block font-semibold mb-1">
                Category
              </label>
              <select
                id="edit-prop-cat"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value as PropertyCategory)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
              >
                <option value="residential">Residential</option>
                <option value="backyard_accommodation">Backyard Accommodation</option>
                <option value="mixed_use">Mixed-Use</option>
                <option value="commercial">Commercial</option>
                <option value="industrial_storage">Industrial / Storage</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-prop-street" className="block font-semibold mb-1">
                Street Address
              </label>
              <input
                id="edit-prop-street"
                type="text"
                required
                value={editStreet}
                onChange={(e) => setEditStreet(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="edit-prop-suburb" className="block font-semibold mb-1">
                  Suburb
                </label>
                <input
                  id="edit-prop-suburb"
                  type="text"
                  value={editSuburb}
                  onChange={(e) => setEditSuburb(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
              <div>
                <label htmlFor="edit-prop-city" className="block font-semibold mb-1">
                  City
                </label>
                <input
                  id="edit-prop-city"
                  type="text"
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex-1 min-h-[44px] rounded-[14px] bg-[#E8EFFA] dark:bg-[#262C36] text-[#0145F2] dark:text-[#E5E7EB] font-semibold"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-2 min-h-[44px] px-5 rounded-[14px] bg-[#0145F2] text-white font-bold"
              >
                {saving ? t.common.saving : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const UnitDetailScreen: React.FC<{
  properties: Property[];
  units: Unit[];
  tenancies: Tenancy[];
  tenants: TenantProfile[];
  charges: Charge[];
  maintenanceTickets: MaintenanceTicket[];
  onOpenQuickAdd: (tab: QuickAddTab, prefill?: QuickAddPrefill) => void;
  onNotify?: (msg: string) => void;
}> = ({
  properties,
  units,
  tenancies,
  tenants,
  charges,
  maintenanceTickets,
  onOpenQuickAdd,
  onNotify,
}) => {
  const { t } = useLanguagePreference();
  const { unitId } = useParams<{ unitId: string }>();
  const unit = units.find((u) => u.id === unitId) || units[0];

  const [editOpen, setEditOpen] = useState(false);
  const [editNumber, setEditNumber] = useState(unit?.unitNumber || '');
  const [editName, setEditName] = useState(unit?.name || '');
  const [editRentRands, setEditRentRands] = useState(
    unit ? (unit.standardRentCents / 100).toFixed(2) : '0.00'
  );
  const [editStatus, setEditStatus] = useState<UnitStatus>(unit?.status || 'vacant');
  const [editUnitType, setEditUnitType] = useState<UnitType>(unit?.unitType || 'flat');
  const [editElecMeter, setEditElecMeter] = useState(unit?.meterNumberElectricity || '');
  const [saving, setSaving] = useState(false);

  if (!unit) {
    return (
      <div className="p-6 rounded-2xl bg-[#FFFFFF] dark:bg-[#0E0F11] border border-[#E4E9F0] dark:border-[#222428]">
        <p className="text-sm">{t.properties.unitNotFound}</p>
      </div>
    );
  }

  const property = properties.find((p) => p.id === unit.propertyId);
  const unitTenancies = tenancies.filter((ten) => ten.unitId === unit.id);
  const unitCharges = charges.filter((c) => c.unitId === unit.id);
  const unitTickets = maintenanceTickets.filter((m) => m.unitId === unit.id);

  const openEditUnit = () => {
    setEditNumber(unit.unitNumber);
    setEditName(unit.name);
    setEditRentRands((unit.standardRentCents / 100).toFixed(2));
    setEditStatus(unit.status);
    setEditUnitType(unit.unitType);
    setEditElecMeter(unit.meterNumberElectricity || '');
    setEditOpen(true);
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateUnitRecord(unit.id, {
        unitNumber: editNumber,
        name: editName,
        standardRentCents: parseZARToCents(editRentRands),
        status: editStatus,
        unitType: editUnitType,
        meterNumberElectricity: editElecMeter,
      });
      onNotify?.(`Updated unit ${editNumber}`);
      setEditOpen(false);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Unable to update unit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center gap-2 text-xs text-[#5A606D] dark:text-[#A1A1AA]">
        <Link to="/properties" className="hover:underline">
          {t.common.properties}
        </Link>
        <span>/</span>
        {property && (
          <>
            <Link to={`/properties/${property.id}`} className="hover:underline truncate">
              {property.name}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="text-[#111318] dark:text-[#FFFFFF] font-medium shrink-0">
          {unit.unitNumber}
        </span>
      </div>

      <div className="p-4 rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-[#0145F2] dark:text-[#68A2FF]">
                {unit.unitNumber}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                  unit.status === 'occupied'
                    ? 'bg-[#D6E5FA] dark:bg-[#072156] text-[#0145F2] dark:text-[#DCE8FF]'
                    : 'bg-[#EDF1F5] dark:bg-[#232830] text-[#4B5563] dark:text-[#D4D4D8]'
                }`}
              >
                {unit.status === 'occupied' ? t.common.occupied : t.common.vacant}
              </span>
            </div>
            <h1 className="text-[19px] font-bold text-[#111318] dark:text-[#FFFFFF]">{unit.name}</h1>
            <div className="text-xs text-[#5A606D] dark:text-[#A1A1AA]">
              {t.domainLabels.unitTypes[unit.unitType] || UNIT_TYPE_LABELS[unit.unitType]} ·{' '}
              <span className="font-mono font-semibold text-[#111318] dark:text-white tabular-nums">
                {formatZAR(unit.standardRentCents)}/mo
              </span>
              {unit.meterNumberElectricity ? ` · Elec: ${unit.meterNumberElectricity}` : ''}
            </div>
          </div>

          <button
            type="button"
            onClick={openEditUnit}
            aria-label="Edit unit details"
            className="w-10 h-10 rounded-full bg-[#EDF1F5] dark:bg-[#232830] text-[#0145F2] dark:text-[#68A2FF] flex items-center justify-center shrink-0 hover:bg-[#DDE7F8]"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenQuickAdd('tenancy', { propertyId: unit.propertyId, unitId: unit.id })}
            className="min-h-[44px] px-3.5 rounded-[14px] bg-[#0145F2] text-[#FFFFFF] text-[12.5px] font-bold"
          >
            {t.properties.newTenancyBtn}
          </button>
          <button
            type="button"
            onClick={() =>
              onOpenQuickAdd('maintenance', { propertyId: unit.propertyId, unitId: unit.id })
            }
            className="min-h-[44px] px-3.5 rounded-[14px] border border-[#E4E9F0] dark:border-[#262B31] bg-[#F9FBFE] dark:bg-[#1E242D] text-[12.5px] font-semibold"
          >
            {t.properties.logRepairBtn}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5">
        <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] p-4 space-y-2.5">
          <h2 className="text-sm font-bold text-[#111318] dark:text-white">
            {t.properties.linkedTenanciesHeading}
          </h2>
          {unitTenancies.length === 0 ? (
            <p className="text-xs text-[#5A606D] dark:text-[#A1A1AA]">
              {unit.status === 'occupied'
                ? tFormat(t.properties.activeStandardTenancyMsg, {
                    rent: formatZAR(unit.standardRentCents),
                  })
                : t.properties.vacantNoTenancyMsg}
            </p>
          ) : (
            <div className="divide-y divide-[#EDF1F5] dark:divide-[#262B31] text-xs">
              {unitTenancies.map((ten) => {
                const tenant = tenants.find((x) => x.id === ten.primaryTenantId);
                return (
                  <div key={ten.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/tenancies/${ten.id}`}
                        className="font-semibold text-[#0145F2] dark:text-[#68A2FF] hover:underline block truncate"
                      >
                        {ten.tenancyReference} — {tenant?.fullName || t.common.tenant}
                      </Link>
                      <div className="text-[#5A606D] dark:text-[#A1A1AA] mt-0.5">
                        {t.properties.startPrefix}: {formatSADate(ten.startDate)} · {ten.status}
                      </div>
                    </div>
                    <span className="font-mono font-bold tabular-nums shrink-0">
                      {formatZAR(ten.rentAmountCents)}/mo
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-[20px] bg-[#FFFFFF] dark:bg-[#171A1F] border border-[#E4E9F0] dark:border-[#262B31] p-4 space-y-2.5">
          <h2 className="text-sm font-bold text-[#111318] dark:text-white">
            {t.properties.unitLedgerRepairsHeading}
          </h2>
          <div className="text-xs text-[#5A606D] dark:text-[#A1A1AA]">
            {tFormat(t.properties.chargesRecordedCount, { count: unitCharges.length })} ·{' '}
            {tFormat(t.properties.maintenanceTicketsCount, { count: unitTickets.length })}
          </div>
          <div className="divide-y divide-[#EDF1F5] dark:divide-[#262B31] text-xs">
            {unitCharges.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between gap-2">
                <span className="truncate">{c.description}</span>
                <span className="font-mono tabular-nums font-semibold shrink-0">
                  {formatZAR(c.amountCents)} ({c.status})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit Unit Modal */}
      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[1px]"
          onClick={() => setEditOpen(false)}
        >
          <form
            onSubmit={handleSaveUnit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[430px] rounded-t-[26px] bg-[#F6F8FC] dark:bg-[#171C23] border-t border-[#E4E9F2] dark:border-[#272E38] p-5 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-[#111318] dark:text-white">Edit Unit</h2>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#626A78]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="edit-unit-num" className="block font-semibold mb-1">
                  Unit Code
                </label>
                <input
                  id="edit-unit-num"
                  type="text"
                  required
                  value={editNumber}
                  onChange={(e) => setEditNumber(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                />
              </div>
              <div>
                <label htmlFor="edit-unit-rent" className="block font-semibold mb-1">
                  Standard Rent (ZAR)
                </label>
                <input
                  id="edit-unit-rent"
                  type="number"
                  step="0.01"
                  required
                  value={editRentRands}
                  onChange={(e) => setEditRentRands(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D] font-mono tabular-nums"
                />
              </div>
            </div>
            <div>
              <label htmlFor="edit-unit-name" className="block font-semibold mb-1">
                Unit Description
              </label>
              <input
                id="edit-unit-name"
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="edit-unit-type" className="block font-semibold mb-1">
                  Type
                </label>
                <select
                  id="edit-unit-type"
                  value={editUnitType}
                  onChange={(e) => setEditUnitType(e.target.value as UnitType)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                >
                  <option value="flat">Flat / Apartment</option>
                  <option value="room">Room</option>
                  <option value="backyard_room">Backyard Room</option>
                  <option value="house">House</option>
                  <option value="shop">Shopfront</option>
                  <option value="office">Office</option>
                  <option value="storage">Storage</option>
                </select>
              </div>
              <div>
                <label htmlFor="edit-unit-status" className="block font-semibold mb-1">
                  Status
                </label>
                <select
                  id="edit-unit-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as UnitStatus)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
                >
                  <option value="vacant">Vacant</option>
                  <option value="occupied">Occupied</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="edit-unit-meter" className="block font-semibold mb-1">
                Prepaid Electricity Meter (Optional)
              </label>
              <input
                id="edit-unit-meter"
                type="text"
                value={editElecMeter}
                onChange={(e) => setEditElecMeter(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-[#E4E9F2] dark:border-[#2B333F] bg-[#FFFFFF] dark:bg-[#1E242D]"
              />
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex-1 min-h-[44px] rounded-[14px] bg-[#E8EFFA] dark:bg-[#262C36] text-[#0145F2] dark:text-[#E5E7EB] font-semibold"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-2 min-h-[44px] px-5 rounded-[14px] bg-[#0145F2] text-white font-bold"
              >
                {saving ? t.common.saving : 'Save Unit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

