/**
 * Clean Cloud Boundary & Data-Access Abstraction Layer
 * Explicitly separates local IndexedDB prototype storage from future production integrations:
 * - Supabase PostgreSQL (Row-Level Security & server-enforced RBAC)
 * - Supabase Auth (OTP / Phone / Email authentication)
 * - Private Object Storage (Signed time-limited URLs for POPIA-protected lease & identity documents)
 * - Server-Side Functions (SMS Gateway & Automated Bank Feed Webhooks)
 *
 * CRITICAL PRINCIPLE: Never claim cloud data was synchronized, SMS delivered, or payment bank-verified
 * when running in local-only prototype mode.
 */

export interface CloudBoundaryStatus {
  mode: 'local_indexeddb_prototype';
  activeStorageEngine: 'local_indexeddb_only';
  supabaseEnvVarsPresent: boolean;
  supabaseConnectionVerified: boolean;
  supabasePostgresConfigured: boolean;
  supabaseAuthConfigured: boolean;
  privateObjectStorageConfigured: boolean;
  smsGatewayConfigured: boolean;
  paymentProcessorConfigured: boolean;
  statusSummary: string;
  productionDisclaimers: string[];
}

export function getCloudBoundaryStatus(): CloudBoundaryStatus {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : ({} as Record<string, unknown>);
  const hasSupabaseUrl = Boolean(env.VITE_SUPABASE_URL);
  const hasSupabaseAnonKey = Boolean(env.VITE_SUPABASE_ANON_KEY);
  const envVarsPresent = hasSupabaseUrl && hasSupabaseAnonKey;

  return {
    mode: 'local_indexeddb_prototype',
    activeStorageEngine: 'local_indexeddb_only',
    supabaseEnvVarsPresent: envVarsPresent,
    supabaseConnectionVerified: false,
    // Even if environment variables are set, this prototype does not instantiate a live Supabase client or sync engine.
    supabasePostgresConfigured: false,
    supabaseAuthConfigured: false,
    privateObjectStorageConfigured: false,
    smsGatewayConfigured: false,
    paymentProcessorConfigured: false,
    statusSummary: envVarsPresent
      ? 'Local IndexedDB Only (Supabase env vars detected, but cloud transport/auth are not wired or verified in this prototype).'
      : 'Local IndexedDB Only (No cloud database, authentication, or SMS gateway connected).',
    productionDisclaimers: [
      'Local-Only Prototype: All records are persisted locally in your browser via IndexedDB (Dexie). No cloud synchronization occurs in this prototype.',
      'Prototype Role Switcher: Switching between Owner, Manager, and Tenant roles in the top/settings bar is for prototype demonstration only and is not production cryptographic authorization.',
      'External Payments Only: Akarai records externally settled payments (Cash, EFT, ATM Deposit). Recording a payment does not independently verify bank settlement.',
      'Legal & POPIA Compliance: Agreement templates and data-handling workflows require review by a qualified South African legal practitioner before production deployment.',
    ],
  };
}
