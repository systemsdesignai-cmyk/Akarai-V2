import {
  assertValidISODate,
  assertValidPositiveCents,
  computeTenancyLedgerSummary,
} from './domainService';
import { validateBackupJSON } from './exportService';
import { getCloudBoundaryStatus } from './cloudBoundary';
import type { Charge, DepositLiability, LedgerAdjustment, Payment } from '../types/domain';
import {
  deleteBackwardCodePoint,
  formatOromoShortcutSequence,
  insertTextAtSelection,
  isSensitiveField,
  isSupportedKeyboardField,
  moveCursorCodePoint,
  recordClipboardSnippet,
  replacePrecedingCodePoint,
  type TextFieldState,
} from '../keyboard/textEditingEngine';
import {
  FIDEL_FAMILIES,
  KEYBOARD_LANGUAGES,
  OROMO_QUBEE_SHORTCUTS,
} from '../keyboard/keyboardData';

export interface AcceptanceTestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

/**
 * Runs deterministic in-app acceptance verification tests against:
 * 1. The domain ledger engine (integer cents arithmetic, partial payments, reversals, waivers, deposit separation)
 * 2. The Multilingual In-App Keyboard Engine (cursor text insertion, selection replacement, Ethiopic Fidel composition,
 *    Tigrinya-specific Fidel series, Afaan Oromoo Qubee shortcuts, Unicode-safe backspace, and clipboard privacy guards).
 */
export function runDomainAcceptanceTests(): AcceptanceTestResult[] {
  const results: AcceptanceTestResult[] = [];
  const tenancyId = 'test-tenancy-001';

  // Test 1: Integer Cents & Partial Payment Arrears Accuracy
  const sampleCharges: Charge[] = [
    {
      id: 'c1',
      organizationId: 'org-test',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
      revision: 1,
      tenancyId,
      propertyId: 'p1',
      unitId: 'u1',
      tenantId: 't1',
      periodKey: '2026-11-rent',
      chargeType: 'rent',
      description: 'Nov Rent',
      amountCents: 250000, // R2,500.00
      allocatedPaidCents: 145050, // R1,450.50 paid
      adjustedCents: 0,
      dueDate: '2026-11-01',
      effectiveDate: '2026-11-01',
      status: 'partially_paid',
      recordedByUserId: 'u-owner',
    },
  ];
  const samplePayments: Payment[] = [
    {
      id: 'pay1',
      organizationId: 'org-test',
      createdAt: '2026-11-02',
      updatedAt: '2026-11-02',
      revision: 1,
      tenancyId,
      propertyId: 'p1',
      unitId: 'u1',
      tenantId: 't1',
      idempotencyKey: 'k1',
      amountCents: 145050,
      unallocatedCents: 0,
      transactionDate: '2026-11-02',
      effectiveDate: '2026-11-02',
      method: 'cash',
      verificationStatus: 'landlord-reported',
      recordedByUserId: 'u-owner',
      recordedByName: 'Owner',
    },
  ];
  const summary1 = computeTenancyLedgerSummary(tenancyId, sampleCharges, samplePayments, [], []);
  const passed1 = summary1.netBalanceDueCents === 104950 && summary1.overdueAmountCents === 104950;
  results.push({
    id: 'test-partial-arrears',
    name: 'Integer Cents Partial Payment & Arrears Derivation',
    passed: passed1,
    details: `Charged R2 500.00 (250000c) minus partial cash R1 450.50 (145050c) = exact arrears R1 049.50 (${summary1.netBalanceDueCents}c).`,
  });

  // Test 2: Payment Reversal & Credit Waiver Accuracy
  const reversedPayments: Payment[] = [
    {
      ...samplePayments[0],
      verificationStatus: 'reversed',
    },
  ];
  const waivedCharges: Charge[] = [
    {
      ...sampleCharges[0],
      allocatedPaidCents: 0,
      adjustedCents: -25000, // R250.00 waiver
    },
  ];
  const adjustments: LedgerAdjustment[] = [
    {
      id: 'adj1',
      organizationId: 'org-test',
      createdAt: '2026-11-03',
      updatedAt: '2026-11-03',
      revision: 1,
      tenancyId,
      chargeId: 'c1',
      adjustmentType: 'waiver',
      amountCents: 25000,
      reason: 'Water outage waiver',
      effectiveDate: '2026-11-03',
      recordedByUserId: 'u-owner',
      recordedByName: 'Owner',
    },
  ];
  const summary2 = computeTenancyLedgerSummary(tenancyId, waivedCharges, reversedPayments, adjustments, []);
  const passed2 = summary2.netBalanceDueCents === 225000 && summary2.totalAllocatedPaidCents === 0;
  results.push({
    id: 'test-reversal-waiver',
    name: 'Payment Reversal & Charge Waiver Recalculation',
    passed: passed2,
    details: `After reversing R1 450.50 payment and applying R250.00 waiver on R2 500.00 rent, derived balance is exactly R2 250.00 (${summary2.netBalanceDueCents}c).`,
  });

  // Test 3: Deposit Liability Separation from Rental Revenue
  const deposits: DepositLiability[] = [
    {
      id: 'dep1',
      organizationId: 'org-test',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
      revision: 1,
      tenancyId,
      tenantId: 't1',
      propertyId: 'p1',
      unitId: 'u1',
      agreedDepositCents: 250000,
      receivedDepositCents: 250000,
      accruedInterestCents: 12500,
      deductionsCents: 0,
      refundedCents: 0,
      heldInAccountNote: 'Liability Account',
      status: 'held_as_liability',
    },
  ];
  const summary3 = computeTenancyLedgerSummary(tenancyId, waivedCharges, reversedPayments, adjustments, deposits);
  const passed3 =
    summary3.netBalanceDueCents === 225000 && summary3.depositHeldLiabilityCents === 262500;
  results.push({
    id: 'test-deposit-liability',
    name: 'Deposit Held as Liability (Never Mixed with Rent Balance)',
    passed: passed3,
    details: `Deposit liability R2 625.00 (${summary3.depositHeldLiabilityCents}c incl. interest) is tracked independently without reducing rent balance due (${summary3.netBalanceDueCents}c).`,
  });

  // Test 4: Advance Overpayment Credit
  const advancePayments: Payment[] = [
    {
      ...samplePayments[0],
      amountCents: 300000,
      unallocatedCents: 50000, // R500.00 advance credit
      verificationStatus: 'reconciled',
    },
  ];
  const paidCharge: Charge[] = [
    {
      ...sampleCharges[0],
      allocatedPaidCents: 250000,
      status: 'paid',
    },
  ];
  const summary4 = computeTenancyLedgerSummary(tenancyId, paidCharge, advancePayments, [], []);
  const passed4 = summary4.netBalanceDueCents === -50000 && summary4.overdueAmountCents === 0;
  results.push({
    id: 'test-advance-credit',
    name: 'Advance Payment / Overpayment Credit Handling',
    passed: passed4,
    details: `Payment of R3 000.00 against R2 500.00 charge leaves R500.00 advance credit (netBalanceDueCents = ${summary4.netBalanceDueCents}c).`,
  });

  // Test 5: Multilingual Keyboard Mid-String Insertion & Selection Replacement
  const initialField: TextFieldState = {
    value: 'Abdiis Baba',
    selectionStart: 7,
    selectionEnd: 11, // "Baba" selected
  };
  const afterReplace = insertTextAtSelection(initialField, 'Dhababaa');
  const midCursor: TextFieldState = {
    value: afterReplace.value,
    selectionStart: 6,
    selectionEnd: 6,
  };
  const afterMidInsert = insertTextAtSelection(midCursor, ' (Unit 2A)');
  const passed5 =
    afterReplace.value === 'Abdiis Dhababaa' &&
    afterReplace.selectionStart === 15 &&
    afterMidInsert.value === 'Abdiis (Unit 2A) Dhababaa';
  results.push({
    id: 'test-keyboard-selection-mid-insert',
    name: 'Keyboard Engine: Selection Replacement & Mid-String Cursor Insertion',
    passed: passed5,
    details: `Replaced selected range to produce "${afterReplace.value}" and inserted mid-string at index 6 -> "${afterMidInsert.value}".`,
  });

  // Test 6: Amharic & Tigrinya Fidel Vowel-Order Composition & Unicode Backspace
  let fidelState: TextFieldState = { value: '', selectionStart: 0, selectionEnd: 0 };
  // Type Amharic base 'ዳ' via base 'ደ' -> 4th order 'ዳ', then 'ዊ' ('ወ' -> 3rd order 'ዊ'), then 'ት' ('ተ' -> 6th order 'ት')
  fidelState = insertTextAtSelection(fidelState, FIDEL_FAMILIES['ደ'].base);
  fidelState = replacePrecedingCodePoint(fidelState, FIDEL_FAMILIES['ደ'].orders[3]); // ዳ
  fidelState = insertTextAtSelection(fidelState, FIDEL_FAMILIES['ወ'].base);
  fidelState = replacePrecedingCodePoint(fidelState, FIDEL_FAMILIES['ወ'].orders[2]); // ዊ
  fidelState = insertTextAtSelection(fidelState, FIDEL_FAMILIES['ተ'].base);
  fidelState = replacePrecedingCodePoint(fidelState, FIDEL_FAMILIES['ተ'].orders[5]); // ት
  // Append Tigrinya-specific uvular fricative 'ቐ' -> 4th order 'ቓ'
  fidelState = insertTextAtSelection(fidelState, ' ');
  fidelState = insertTextAtSelection(fidelState, FIDEL_FAMILIES['ቐ'].base);
  fidelState = replacePrecedingCodePoint(fidelState, FIDEL_FAMILIES['ቐ'].orders[3]); // ቓ
  const composedFidel = fidelState.value; // "ዳዊት ቓ"
  const afterBackspace = deleteBackwardCodePoint(fidelState); // "ዳዊት "
  const afterCursorLeft = moveCursorCodePoint(afterBackspace, 'left');
  const passed6 =
    composedFidel === 'ዳዊት ቓ' &&
    afterBackspace.value === 'ዳዊት ' &&
    afterCursorLeft.selectionStart === 3;
  results.push({
    id: 'test-keyboard-ethiopic-fidel',
    name: 'Amharic & Tigrinya Fidel Composition (ደ→ዳ, ቐ→ቓ) & Unicode Backspace',
    passed: passed6,
    details: `Composed mixed Amharic/Tigrinya "${composedFidel}" and verified single code-point backspace -> "${afterBackspace.value.trim()}".`,
  });

  // Test 7: Afaan Oromoo Qubee Shortcut Row & Capitalization State
  const expectedShortcuts = ['Dh', 'Ch', 'Sh', 'Ny', 'Ph', 'Aa', 'Ee', 'Ii', 'Oo', 'Uu'];
  const matchesExactOrder =
    OROMO_QUBEE_SHORTCUTS.length === 10 &&
    OROMO_QUBEE_SHORTCUTS.every((s, idx) => s === expectedShortcuts[idx]);
  const shiftFormatted = formatOromoShortcutSequence('Dh', 'shift');
  const lowerFormatted = formatOromoShortcutSequence('Dh', 'off');
  const capsFormatted = formatOromoShortcutSequence('Oo', 'caps');
  const passed7 =
    matchesExactOrder &&
    shiftFormatted === 'Dh' &&
    lowerFormatted === 'dh' &&
    capsFormatted === 'OO' &&
    KEYBOARD_LANGUAGES.length === 4;
  results.push({
    id: 'test-keyboard-oromo-qubee',
    name: 'Afaan Oromoo Qubee Shortcut Row (Dh..Uu) & 4-Language Registry',
    passed: passed7,
    details: `Verified 10 Qubee shortcuts (${OROMO_QUBEE_SHORTCUTS.join(' | ')}) with Shift="${shiftFormatted}", Lower="${lowerFormatted}", Caps="${capsFormatted}".`,
  });

  // Test 8: Clipboard History Privacy & Sensitive Field Exclusion Guards
  const passwordField = {
    tagName: 'INPUT',
    type: 'password',
    name: 'user_password',
  };
  const cardField = {
    tagName: 'INPUT',
    type: 'text',
    autoComplete: 'cc-number',
    name: 'card_number',
  };
  const numericAmountField = {
    tagName: 'INPUT',
    type: 'number',
    name: 'payAmountRands',
  };
  const tenantNameField = {
    tagName: 'INPUT',
    type: 'text',
    name: 'tenFullName',
  };

  const blockedPassword = isSensitiveField(passwordField) && !isSupportedKeyboardField(passwordField);
  const blockedCard = isSensitiveField(cardField) && !isSupportedKeyboardField(cardField);
  const skippedNumeric = !isSupportedKeyboardField(numericAmountField);
  const allowedTenantName =
    !isSensitiveField(tenantNameField) && isSupportedKeyboardField(tenantNameField);

  // Verify sensitive field copy never enters clipboard history even if history is enabled
  const historyBefore = recordClipboardSnippet({
    text: 'SuperSecretPassword123!',
    language: 'en',
    fieldDescriptor: passwordField,
    prefs: {
      enabled: true,
      defaultLanguage: 'en',
      activeLanguage: 'en',
      preferredInputMode: 'akarai',
      clipboardHistoryEnabled: true,
      maxClipboardItems: 10,
      retentionHours: 24,
      vibrationEnabled: false,
      keyPreviewEnabled: true,
      keyboardSize: 'standard',
    },
  });
  const leakedSecret = historyBefore.some((item) =>
    item.text.includes('SuperSecretPassword123!')
  );
  const passed8 =
    blockedPassword &&
    blockedCard &&
    skippedNumeric &&
    allowedTenantName &&
    !leakedSecret;
  results.push({
    id: 'test-keyboard-privacy-guards',
    name: 'Keyboard & Clipboard Privacy Guard (Passwords, Cards & Numeric Fields Excluded)',
    passed: passed8,
    details: `Password & card fields blocked from keyboard and clipboard history (leakedSecret=${leakedSecret}); tenant text fields enabled.`,
  });

  // Test 9: Strict Payment Validation Guards (A02)
  const rejectedZero = (() => {
    try {
      assertValidPositiveCents(0);
      return false;
    } catch {
      return true;
    }
  })();
  const rejectedNegative = (() => {
    try {
      assertValidPositiveCents(-500);
      return false;
    } catch {
      return true;
    }
  })();
  const rejectedFloat = (() => {
    try {
      assertValidPositiveCents(123.45);
      return false;
    } catch {
      return true;
    }
  })();
  const rejectedNaN = (() => {
    try {
      assertValidPositiveCents(Number.NaN);
      return false;
    } catch {
      return true;
    }
  })();
  const rejectedBadDate = (() => {
    try {
      assertValidISODate('2026-02-31');
      return false;
    } catch {
      return true;
    }
  })();
  const acceptedValid =
    assertValidPositiveCents(350000) === 350000 &&
    assertValidISODate('2026-11-20') === '2026-11-20';
  const passed9 =
    rejectedZero &&
    rejectedNegative &&
    rejectedFloat &&
    rejectedNaN &&
    rejectedBadDate &&
    acceptedValid;
  results.push({
    id: 'test-payment-validation-guards',
    name: 'Payment Amount & Date Integrity Guards (Zero, Negative, Float, NaN & Bad Date Rejected)',
    passed: passed9,
    details: `Rejected invalid cents (0, -500, 123.45, NaN) and invalid date 2026-02-31; accepted valid integer cents and ISO date.`,
  });

  // Test 10: Backup Schema, Version, Foreign-Key & Cent Integrity Validator (A03)
  const malformedRes = validateBackupJSON('{bad json');
  const badVersionRes = validateBackupJSON(
    JSON.stringify({ schemaName: 'Akarai_Backup', schemaVersion: '9.9.9', tables: {} })
  );
  const missingTablesRes = validateBackupJSON(
    JSON.stringify({
      schemaName: 'Akarai_Backup',
      schemaVersion: '0.1.0',
      tables: { properties: [] },
    })
  );
  const corruptFKRes = validateBackupJSON(
    JSON.stringify({
      schemaName: 'Akarai_Backup',
      schemaVersion: '0.1.0',
      tables: {
        organizations: [],
        users: [],
        properties: [],
        units: [{ id: 'u-orphan', propertyId: 'prop-missing', standardRentCents: 100000 }],
        people: [],
        tenantProfiles: [],
        tenancies: [],
        charges: [],
        payments: [],
        paymentAllocations: [],
        ledgerAdjustments: [],
        receipts: [],
        depositLiabilities: [],
        expenses: [],
        maintenanceTickets: [],
        maintenanceEvents: [],
        documents: [],
        messageLogs: [],
        auditEvents: [],
        syncOperations: [],
        applicationSettings: [],
      },
    })
  );
  const passed10 =
    !malformedRes.valid &&
    !badVersionRes.valid &&
    !missingTablesRes.valid &&
    !corruptFKRes.valid;
  results.push({
    id: 'test-backup-strict-validation',
    name: 'Backup Validator Rejects Malformed, Wrong-Version, Truncated & Orphan-FK Files',
    passed: passed10,
    details: `All 4 corrupted backup payloads rejected prior to any IndexedDB mutation.`,
  });

  // Test 11: Cloud Boundary Truthfulness (A08)
  const boundary = getCloudBoundaryStatus();
  const passed11 =
    boundary.activeStorageEngine === 'local_indexeddb_only' &&
    boundary.supabaseConnectionVerified === false &&
    boundary.supabasePostgresConfigured === false;
  results.push({
    id: 'test-cloud-boundary-truthfulness',
    name: 'Cloud Boundary Truthfulness (Local IndexedDB Only; No Unverified Cloud Claim)',
    passed: passed11,
    details: `activeStorageEngine=${boundary.activeStorageEngine}, supabaseConnectionVerified=${boundary.supabaseConnectionVerified}.`,
  });

  return results;
}
