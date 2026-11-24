import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/database';
import { seedSampleData } from './db/sampleData';
import { AppShell } from './components/AppShell';
import { QuickAddModal, type QuickAddPrefill, type QuickAddTab } from './components/QuickAddModal';
import { AkaraiKeyboard } from './keyboard/AkaraiKeyboard';
import { resolveAssetUrl } from './utils/assetUrl';
import { LaunchExperienceGate } from './components/cinematic/LaunchExperienceGate';
import {
  DashboardScreen,
  SignInAccountStateScreen,
  WelcomeOnboardingScreen,
} from './pages/DashboardAndOnboarding';
import {
  PropertyDetailScreen,
  PropertyDirectoryScreen,
  UnitDetailScreen,
} from './pages/PropertiesAndUnits';
import {
  TenanciesScreen,
  TenancyDetailScreen,
  TenantDirectoryScreen,
  TenantProfileScreen,
} from './pages/TenantsAndTenancies';
import {
  ReceiptDetailScreen,
  ReceiptsScreen,
  RecordPaymentScreen,
  RentLedgerScreen,
} from './pages/LedgerPaymentsReceipts';
import {
  CommunicationCenterScreen,
  DocumentsScreen,
  MaintenanceBoardScreen,
  MaintenanceTicketDetailScreen,
} from './pages/CommsMaintenanceDocs';
import {
  BackupAndRestoreScreen,
  FinancialDashboardScreen,
  HelpAndSupportScreen,
  LanguageScreen,
  ReportsAndExportsScreen,
  SettingsAndAccessScreen,
  SubscriptionAndBillingScreen,
  TenantPortalScreen,
} from './pages/FinancialsReportsSettingsBackupPortal';

export default function App() {
  const [initialized, setInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initAttempt, setInitAttempt] = useState(0);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<QuickAddTab>('menu');
  const [quickAddPrefill, setQuickAddPrefill] = useState<QuickAddPrefill | undefined>(undefined);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitError(null);
    seedSampleData(false)
      .then(() => {
        if (!cancelled) {
          setInitialized(true);
        }
      })
      .catch((err) => {
        console.error('[Akarai] Local IndexedDB initialization failed:', err);
        if (!cancelled) {
          setInitialized(false);
          setInitError(
            err instanceof Error
              ? err.message
              : 'Unable to open or initialize local browser storage (IndexedDB).'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initAttempt]);

  const settings = useLiveQuery(() => db.applicationSettings.get('settings-default'), []);
  const users = useLiveQuery(() => db.users.toArray(), []) || [];
  const ownerEntities = useLiveQuery(() => db.ownerEntities.toArray(), []) || [];
  const portfolios = useLiveQuery(() => db.portfolios.toArray(), []) || [];
  const properties = useLiveQuery(() => db.properties.toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const tenants = useLiveQuery(() => db.tenantProfiles.toArray(), []) || [];
  const identityEvidences = useLiveQuery(() => db.identityEvidences.toArray(), []) || [];
  const consentRecords = useLiveQuery(() => db.consentRecords.toArray(), []) || [];
  const tenancies = useLiveQuery(() => db.tenancies.toArray(), []) || [];
  const participants = useLiveQuery(() => db.tenancyParticipants.toArray(), []) || [];
  const leaseVersions = useLiveQuery(() => db.leaseVersions.toArray(), []) || [];
  const charges = useLiveQuery(() => db.charges.toArray(), []) || [];
  const payments = useLiveQuery(() => db.payments.toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.ledgerAdjustments.toArray(), []) || [];
  const deposits = useLiveQuery(() => db.depositLiabilities.toArray(), []) || [];
  const receipts = useLiveQuery(() => db.receipts.toArray(), []) || [];
  const expenses = useLiveQuery(() => db.expenses.toArray(), []) || [];
  const maintenanceTickets = useLiveQuery(() => db.maintenanceTickets.toArray(), []) || [];
  const maintenanceEvents = useLiveQuery(() => db.maintenanceEvents.toArray(), []) || [];
  const documents = useLiveQuery(() => db.documents.toArray(), []) || [];
  const messageLogs = useLiveQuery(() => db.messageLogs.toArray(), []) || [];
  const syncOperations = useLiveQuery(() => db.syncOperations.toArray(), []) || [];
  const auditEvents = useLiveQuery(() => db.auditEvents.toArray(), []) || [];

  useEffect(() => {
    const applyResolvedTheme = (pref: 'light' | 'dark' | 'system') => {
      try {
        localStorage.setItem('landlordos_theme_pref', pref);
      } catch {
        // ignore
      }
      const systemDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = pref === 'dark' || (pref === 'system' && systemDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // Ensure existing browser sessions without an explicit saved theme default to dark mode as per visual reference
    let savedPref: 'light' | 'dark' | 'system' | null = null;
    try {
      savedPref = localStorage.getItem('landlordos_theme_pref') as 'light' | 'dark' | 'system' | null;
    } catch {
      savedPref = null;
    }

    if (!savedPref && settings && settings.theme === 'light') {
      db.applicationSettings.update('settings-default', { theme: 'dark' });
      applyResolvedTheme('dark');
      return;
    }

    const activePref = settings?.theme || savedPref || 'dark';
    applyResolvedTheme(activePref);

    if (activePref === 'system' && typeof window !== 'undefined') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyResolvedTheme('system');
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
  }, [settings?.theme]);

  const activeUser = users.find((u) => u.id === settings?.activeUserId) || users[0];
  const activeUserName =
    settings?.portfolioDisplayName?.trim() ||
    activeUser?.fullName ||
    ownerEntities[0]?.name ||
    'Landlord';

  const handleOpenQuickAdd = (tab: QuickAddTab = 'menu', prefill?: QuickAddPrefill) => {
    setQuickAddTab(tab);
    setQuickAddPrefill(prefill);
    setQuickAddOpen(true);
  };

  const handleNotify = (msg: string) => {
    setToastMessage(msg);
  };

  if (initError) {
    return (
      <div
        role="alert"
        className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#EDF1F5] dark:bg-black text-[#111318] dark:text-white"
      >
        <div className="w-full max-w-[390px] rounded-[22px] bg-[#FFFFFF] dark:bg-[#171B20] border border-[#FAD6DA] dark:border-[#4B2329] p-6 space-y-4 text-center shadow-sm">
          <img
            src={resolveAssetUrl('akarai-symbol.png')}
            alt="Akarai"
            className="w-12 h-12 object-contain rounded-[12px] mx-auto"
          />
          <h1 className="text-[18px] font-bold text-[#111318] dark:text-white">
            Local Storage Initialization Failed
          </h1>
          <p className="text-[12.5px] text-[#4B5563] dark:text-[#C4C9D1] leading-relaxed">
            Akarai could not initialize its local IndexedDB workspace. Your existing records have not
            been modified. Check browser storage permissions or private-browsing limits and retry.
          </p>
          <div className="p-3 rounded-xl bg-[#FFEEF0] dark:bg-[#2A171B] text-[#E5252A] dark:text-[#FF7A82] text-[11.5px] font-mono break-words text-left">
            {initError}
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={() => setInitAttempt((n) => n + 1)}
              className="w-full min-h-[44px] px-4 py-2 rounded-full bg-[#0145F2] hover:bg-[#0039CC] text-white text-[13.5px] font-semibold"
            >
              Retry Initialization
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[42px] px-4 py-2 rounded-full border border-[#E6ECF3] dark:border-[#262B31] text-[13px] font-semibold text-[#111318] dark:text-white"
            >
              Reload Akarai
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#FFFFFF] dark:bg-black text-[#0B1B3B] dark:text-white">
        <img
          src={resolveAssetUrl('akarai-symbol.png')}
          alt="Akarai"
          className="w-14 h-14 object-contain rounded-[14px]"
        />
        <div className="text-xs font-mono text-[#626A78] dark:text-[#98A1B2]">
          Initializing Akarai Local IndexedDB Engine...
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <LaunchExperienceGate />
      <AppShell
        settings={settings}
        properties={properties}
        units={units}
        tenants={tenants}
        tenancies={tenancies}
        charges={charges}
        receipts={receipts}
        maintenanceTickets={maintenanceTickets}
        syncOperations={syncOperations}
        onOpenQuickAdd={handleOpenQuickAdd}
        toastMessage={toastMessage}
        onDismissToast={() => setToastMessage(null)}
      >
        <Routes>
          <Route
            path="/"
            element={
              <DashboardScreen
                settings={settings}
                properties={properties}
                units={units}
                tenants={tenants}
                tenancies={tenancies}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                receipts={receipts}
                expenses={expenses}
                maintenanceTickets={maintenanceTickets}
                syncOperations={syncOperations}
                activeUserName={activeUserName}
                onOpenQuickAdd={handleOpenQuickAdd}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <DashboardScreen
                settings={settings}
                properties={properties}
                units={units}
                tenants={tenants}
                tenancies={tenancies}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                receipts={receipts}
                expenses={expenses}
                maintenanceTickets={maintenanceTickets}
                syncOperations={syncOperations}
                activeUserName={activeUserName}
                onOpenQuickAdd={handleOpenQuickAdd}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/onboarding"
            element={<WelcomeOnboardingScreen settings={settings} onNotify={handleNotify} />}
          />
          <Route
            path="/account"
            element={
              <SignInAccountStateScreen
                settings={settings}
                tenants={tenants}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/properties"
            element={
              <PropertyDirectoryScreen
                settings={settings}
                ownerEntities={ownerEntities}
                portfolios={portfolios}
                properties={properties}
                units={units}
                tenancies={tenancies}
                charges={charges}
                onOpenQuickAdd={handleOpenQuickAdd}
              />
            }
          />
          <Route
            path="/properties/:propertyId"
            element={
              <PropertyDetailScreen
                properties={properties}
                units={units}
                tenancies={tenancies}
                tenants={tenants}
                expenses={expenses}
                maintenanceTickets={maintenanceTickets}
                onOpenQuickAdd={handleOpenQuickAdd}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/units/:unitId"
            element={
              <UnitDetailScreen
                properties={properties}
                units={units}
                tenancies={tenancies}
                tenants={tenants}
                charges={charges}
                maintenanceTickets={maintenanceTickets}
                onOpenQuickAdd={handleOpenQuickAdd}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/tenants"
            element={
              <TenantDirectoryScreen
                settings={settings}
                tenants={tenants}
                tenancies={tenancies}
                units={units}
                properties={properties}
                charges={charges}
                onOpenQuickAdd={handleOpenQuickAdd}
              />
            }
          />
          <Route
            path="/tenants/:tenantId"
            element={
              <TenantProfileScreen
                tenants={tenants}
                tenancies={tenancies}
                units={units}
                properties={properties}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                identityEvidences={identityEvidences}
                consentRecords={consentRecords}
                messageLogs={messageLogs}
                onOpenQuickAdd={handleOpenQuickAdd}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/tenancies"
            element={
              <TenanciesScreen
                tenancies={tenancies}
                tenants={tenants}
                units={units}
                properties={properties}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                onOpenQuickAdd={handleOpenQuickAdd}
              />
            }
          />
          <Route
            path="/tenancies/:tenancyId"
            element={
              <TenancyDetailScreen
                tenancies={tenancies}
                tenants={tenants}
                units={units}
                properties={properties}
                participants={participants}
                leaseVersions={leaseVersions}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/ledger"
            element={
              <RentLedgerScreen
                tenancies={tenancies}
                tenants={tenants}
                units={units}
                properties={properties}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/payments/new"
            element={
              <RecordPaymentScreen
                tenancies={tenancies}
                tenants={tenants}
                units={units}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/receipts"
            element={
              <ReceiptsScreen
                settings={settings}
                receipts={receipts}
                payments={payments}
                charges={charges}
                tenancies={tenancies}
                tenants={tenants}
                units={units}
                deposits={deposits}
                onOpenQuickAdd={handleOpenQuickAdd}
              />
            }
          />
          <Route
            path="/payments"
            element={
              <ReceiptsScreen
                settings={settings}
                receipts={receipts}
                payments={payments}
                charges={charges}
                tenancies={tenancies}
                tenants={tenants}
                units={units}
                deposits={deposits}
                onOpenQuickAdd={handleOpenQuickAdd}
              />
            }
          />
          <Route
            path="/receipts/:receiptId"
            element={
              <ReceiptDetailScreen
                receipts={receipts}
                payments={payments}
                tenants={tenants}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/communications"
            element={
              <CommunicationCenterScreen
                tenants={tenants}
                tenancies={tenancies}
                units={units}
                properties={properties}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                messageLogs={messageLogs}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/maintenance"
            element={
              <MaintenanceBoardScreen
                maintenanceTickets={maintenanceTickets}
                properties={properties}
                units={units}
                onOpenQuickAdd={handleOpenQuickAdd}
              />
            }
          />
          <Route
            path="/maintenance/:ticketId"
            element={
              <MaintenanceTicketDetailScreen
                maintenanceTickets={maintenanceTickets}
                maintenanceEvents={maintenanceEvents}
                properties={properties}
                units={units}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/documents"
            element={
              <DocumentsScreen
                documents={documents}
                properties={properties}
                tenants={tenants}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/financials"
            element={
              <FinancialDashboardScreen
                properties={properties}
                units={units}
                tenancies={tenancies}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                expenses={expenses}
              />
            }
          />
          <Route
            path="/reports"
            element={<ReportsAndExportsScreen onNotify={handleNotify} />}
          />
          <Route
            path="/settings"
            element={
              <SettingsAndAccessScreen
                settings={settings}
                syncOperations={syncOperations}
                auditEvents={auditEvents}
                onNotify={handleNotify}
              />
            }
          />
          <Route
            path="/backup"
            element={<BackupAndRestoreScreen settings={settings} onNotify={handleNotify} />}
          />
          <Route
            path="/language"
            element={<LanguageScreen onNotify={handleNotify} />}
          />
          <Route
            path="/subscription"
            element={<SubscriptionAndBillingScreen settings={settings} onNotify={handleNotify} />}
          />
          <Route
            path="/help"
            element={<HelpAndSupportScreen />}
          />
          <Route
            path="/tenant-portal"
            element={
              <TenantPortalScreen
                settings={settings}
                tenants={tenants}
                tenancies={tenancies}
                units={units}
                properties={properties}
                charges={charges}
                payments={payments}
                adjustments={adjustments}
                deposits={deposits}
                receipts={receipts}
                maintenanceTickets={maintenanceTickets}
                messageLogs={messageLogs}
                onNotify={handleNotify}
              />
            }
          />
          <Route path="/welcome" element={<div />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <QuickAddModal
          isOpen={quickAddOpen}
          initialTab={quickAddTab}
          prefill={quickAddPrefill}
          onClose={() => {
            setQuickAddOpen(false);
            setQuickAddPrefill(undefined);
          }}
          properties={properties}
          units={units}
          tenants={tenants}
          tenancies={tenancies}
          charges={charges}
          payments={payments}
          adjustments={adjustments}
          deposits={deposits}
          maintenanceTickets={maintenanceTickets}
          activeRole={settings?.activeRole || 'owner'}
          activeUserName={activeUserName}
          onSuccess={handleNotify}
        />

        <AkaraiKeyboard onNotify={handleNotify} />
      </AppShell>
    </BrowserRouter>
  );
}
