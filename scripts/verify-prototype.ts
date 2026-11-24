import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';

import { db } from '../src/db/database';
import { seedSampleData } from '../src/db/sampleData';
import {
  applyChargeAdjustment,
  clearSampleDataToEmptyWorkspace,
  computeTenancyLedgerSummary,
  createPropertyRecord,
  createTenancyRecord,
  createTenantRecord,
  createUnitRecord,
  DuplicatePaymentConfirmationError,
  generateChargeForTenancy,
  recordDepositMovement,
  recordPaymentTransaction,
  reloadFictionalSampleData,
  reversePaymentTransaction,
  updateSimulatedSubscriptionPlan,
  updateTenancyStatus,
} from '../src/services/domainService';
import {
  buildFullBackupEnvelope,
  restoreValidatedBackup,
  validateBackupJSON,
} from '../src/services/exportService';
import { runDomainAcceptanceTests } from '../src/services/acceptanceTests';
import { getCloudBoundaryStatus } from '../src/services/cloudBoundary';

interface TestCaseResult {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const results: TestCaseResult[] = [];

async function runCase(id: string, name: string, fn: () => Promise<string | void>) {
  try {
    const details = (await fn()) || 'Verified';
    results.push({ id, name, status: 'PASS', details });
    console.log(`[PASS] ${id}: ${name} — ${details}`);
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    results.push({ id, name, status: 'FAIL', details });
    console.error(`[FAIL] ${id}: ${name} — ${details}`);
  }
}

async function snapshotCounts() {
  return {
    properties: await db.properties.count(),
    units: await db.units.count(),
    tenants: await db.tenantProfiles.count(),
    tenancies: await db.tenancies.count(),
    charges: await db.charges.count(),
    payments: await db.payments.count(),
    allocations: await db.paymentAllocations.count(),
    adjustments: await db.ledgerAdjustments.count(),
    receipts: await db.receipts.count(),
    deposits: await db.depositLiabilities.count(),
    auditEvents: await db.auditEvents.count(),
    syncOperations: await db.syncOperations.count(),
  };
}

async function main() {
  // Ensure clean DB open
  await db.open();

  // 1. Pure domain & keyboard acceptance checks (including A02, A03, A08 checks)
  await runCase('T01-PURE-ACCEPTANCE', 'In-app deterministic acceptance test suite', async () => {
    const pureResults = runDomainAcceptanceTests();
    assert.ok(pureResults.length >= 11, `Expected >=11 pure tests, got ${pureResults.length}`);
    const failed = pureResults.filter((r) => !r.passed);
    assert.equal(failed.length, 0, `Failed pure checks: ${failed.map((f) => f.id).join(', ')}`);
    return `${pureResults.length}/${pureResults.length} passed`;
  });

  // 2. Seed demo data and verify safe startup init (A04)
  await runCase('T02-A04-SAFE-STARTUP', 'Safe startup initialization & clean-workspace preservation', async () => {
    await seedSampleData(true);
    const seededProps = await db.properties.count();
    assert.ok(seededProps >= 4, `Expected seeded properties >= 4, got ${seededProps}`);

    // Clear to clean workspace
    await clearSampleDataToEmptyWorkspace();
    assert.equal(await db.properties.count(), 0);
    assert.equal(await db.payments.count(), 0);
    const cleanSettings = await db.applicationSettings.get('settings-default');
    assert.equal(cleanSettings?.isSampleDataLoaded, false);
    assert.equal(cleanSettings?.workspaceMode, 'clean');

    // Subsequent startup seed(false) MUST NOT overwrite clean workspace
    await seedSampleData(false);
    assert.equal(await db.properties.count(), 0, 'seedSampleData(false) overwrote clean workspace!');

    // Create a single custom property with settings revision=1 edge case
    await db.applicationSettings.update('settings-default', { revision: 1 });
    const prop = await createPropertyRecord({
      name: 'User Custom Flats',
      category: 'residential',
      streetAddress: '10 Custom Rd',
      suburb: 'Rosebank',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      buildingsCount: 1,
      floorsCount: 1,
    });
    assert.ok(prop.id);

    // seedSampleData(false) MUST NOT overwrite existing user workspace even at revision=1
    await seedSampleData(false);
    assert.equal(await db.properties.count(), 1);
    assert.equal((await db.properties.toArray())[0].name, 'User Custom Flats');

    // Reload demo preserves theme and simulated plan tier
    await db.applicationSettings.update('settings-default', { theme: 'light' });
    await updateSimulatedSubscriptionPlan('business', 'active_demo');
    await reloadFictionalSampleData();
    const afterReload = await db.applicationSettings.get('settings-default');
    assert.equal(afterReload?.theme, 'light', 'Demo reload lost user theme preference');
    assert.equal(afterReload?.selectedPlanTier, 'business', 'Demo reload lost subscription tier');
    assert.equal(afterReload?.isSampleDataLoaded, true);
    return 'Clean workspace, custom revision=1 workspace, and theme/tier preferences preserved';
  });

  // 3. A01 Transactional rollback on mid-transaction failure injection
  await runCase('T03-A01-TX-ROLLBACK', 'Dexie atomic transaction rollback on failure injection', async () => {
    await seedSampleData(true);
    const beforeCounts = await snapshotCounts();
    const targetTenancy = await db.tenancies.get('tenancy-bree-flat1b');
    assert.ok(targetTenancy, 'Seeded tenancy-bree-flat1b missing');
    const chargeBefore = await db.charges.get('chg-kabelo-nov-rent');
    assert.ok(chargeBefore, 'Seeded chg-kabelo-nov-rent missing');

    // Inject failure inside recordPaymentTransaction
    let threwPay = false;
    try {
      await recordPaymentTransaction({
        tenancyId: targetTenancy.id,
        amountCents: 100000,
        transactionDate: '2026-11-21',
        method: 'cash',
        verificationStatus: 'landlord-reported',
        idempotencyToken: 'rollback-pay-token-1',
        onBeforeCommitForTest: () => {
          throw new Error('INJECTED_PAYMENT_COMMIT_FAILURE');
        },
      });
    } catch (err) {
      threwPay = err instanceof Error && err.message.includes('INJECTED_PAYMENT_COMMIT_FAILURE');
    }
    assert.equal(threwPay, true, 'Expected injected payment error to propagate');
    assert.deepEqual(await snapshotCounts(), beforeCounts, 'Partial rows persisted after payment rollback');
    const chargeAfterPayFail = await db.charges.get('chg-kabelo-nov-rent');
    assert.equal(chargeAfterPayFail?.allocatedPaidCents, chargeBefore.allocatedPaidCents);

    // Inject failure inside reversePaymentTransaction
    let threwRev = false;
    try {
      await reversePaymentTransaction('pay-dawit-nov', 'Testing atomic rollback', {
        onBeforeCommitForTest: () => {
          throw new Error('INJECTED_REVERSAL_FAILURE');
        },
      });
    } catch (err) {
      threwRev = err instanceof Error && err.message.includes('INJECTED_REVERSAL_FAILURE');
    }
    assert.equal(threwRev, true, 'Expected injected reversal error to propagate');
    assert.deepEqual(await snapshotCounts(), beforeCounts, 'Partial rows persisted after reversal rollback');
    const dawitPayAfterFail = await db.payments.get('pay-dawit-nov');
    assert.notEqual(dawitPayAfterFail?.verificationStatus, 'reversed');

    // Inject failure inside applyChargeAdjustment
    let threwAdj = false;
    try {
      await applyChargeAdjustment({
        chargeId: 'chg-kabelo-nov-rent',
        adjustmentType: 'waiver',
        amountCents: 25000,
        reason: 'Rollback test waiver',
        onBeforeCommitForTest: () => {
          throw new Error('INJECTED_ADJUSTMENT_FAILURE');
        },
      });
    } catch (err) {
      threwAdj = err instanceof Error && err.message.includes('INJECTED_ADJUSTMENT_FAILURE');
    }
    assert.equal(threwAdj, true, 'Expected injected adjustment error to propagate');
    assert.deepEqual(await snapshotCounts(), beforeCounts, 'Partial rows persisted after adjustment rollback');
    return 'Payment, reversal, and adjustment transactions all rolled back 100% cleanly on failure';
  });

  // 4. A02 Payment validation, partial+final math, overpayment credit, concurrency & duplicate confirmation
  await runCase(
    'T04-A02-PAYMENTS',
    'Payment validation, partial/final/overpayment math, concurrency & same-day duplicate confirmation',
    async () => {
      await clearSampleDataToEmptyWorkspace();
      const prop = await createPropertyRecord({
        name: 'Ledger Math Heights',
        category: 'residential',
        streetAddress: '1 Test St',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2196',
        buildingsCount: 1,
        floorsCount: 1,
      });
      const unit = await createUnitRecord({
        propertyId: prop.id,
        unitNumber: 'U1',
        name: 'Unit 1',
        unitType: 'flat',
        status: 'vacant',
        standardRentCents: 500000, // R5,000.00
        amenities: [],
      });
      const tenant = await createTenantRecord({
        fullName: 'Test Tenant',
        primaryPhone: '+27 82 000 1111',
        hasSmartphone: true,
        hasBankAccount: true,
        hasInternetAccess: true,
        documentationType: 'sa_id_card',
        documentationStatus: 'verified',
        preferredChannel: 'whatsapp',
        occupantsCount: 1,
        portalAccessEnabled: true,
      });
      const tenancy = await createTenancyRecord({
        propertyId: prop.id,
        unitId: unit.id,
        primaryTenantId: tenant.id,
        leaseCategory: 'residential_standard',
        startDate: '2026-11-01',
        rentAmountCents: 500000,
        dueDayOfMonth: 1,
        depositRequiredCents: 500000,
        depositReceivedCents: 500000,
        recurringUtilityChargeCents: 0,
        noticePeriodDays: 30,
        generateFirstMonthCharge: true,
        firstChargePeriodKey: '2026-11',
      });

      // Invalid amounts & dates rejected
      await assert.rejects(
        () =>
          recordPaymentTransaction({
            tenancyId: tenancy.id,
            amountCents: 0,
            transactionDate: '2026-11-20',
            method: 'cash',
            verificationStatus: 'landlord-reported',
          }),
        /greater than/i
      );
      await assert.rejects(
        () =>
          recordPaymentTransaction({
            tenancyId: tenancy.id,
            amountCents: -100,
            transactionDate: '2026-11-20',
            method: 'cash',
            verificationStatus: 'landlord-reported',
          }),
        /greater than/i
      );
      await assert.rejects(
        () =>
          recordPaymentTransaction({
            tenancyId: tenancy.id,
            amountCents: 150.5,
            transactionDate: '2026-11-20',
            method: 'cash',
            verificationStatus: 'landlord-reported',
          }),
        /exact integer/i
      );
      await assert.rejects(
        () =>
          recordPaymentTransaction({
            tenancyId: tenancy.id,
            amountCents: 100000,
            transactionDate: '2026-02-31',
            method: 'cash',
            verificationStatus: 'landlord-reported',
          }),
        /not a real calendar date/i
      );

      // Concurrent double-submit with same idempotencyToken -> exactly 1 succeeds
      const sharedToken = 'concurrent-token-abc';
      const settled = await Promise.allSettled([
        recordPaymentTransaction({
          tenancyId: tenancy.id,
          amountCents: 200000, // R2,000.00 partial
          transactionDate: '2026-11-20',
          method: 'cash',
          verificationStatus: 'landlord-reported',
          idempotencyToken: sharedToken,
        }),
        recordPaymentTransaction({
          tenancyId: tenancy.id,
          amountCents: 200000,
          transactionDate: '2026-11-20',
          method: 'cash',
          verificationStatus: 'landlord-reported',
          idempotencyToken: sharedToken,
        }),
      ]);
      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');
      assert.equal(fulfilled.length, 1, `Expected 1 fulfilled concurrent call, got ${fulfilled.length}`);
      assert.equal(rejected.length, 1, `Expected 1 rejected concurrent call, got ${rejected.length}`);

      // Verify remaining balance after R2,000 partial on R5,000 charge is exactly R3,000 (300000c)
      const summaryAfterPartial = computeTenancyLedgerSummary(
        tenancy.id,
        await db.charges.toArray(),
        await db.payments.toArray(),
        await db.ledgerAdjustments.toArray(),
        await db.depositLiabilities.toArray()
      );
      assert.equal(summaryAfterPartial.netBalanceDueCents, 300000);
      assert.equal(summaryAfterPartial.depositHeldLiabilityCents, 500000);

      // Same-day, same-amount cash payment WITHOUT confirmDistinctDuplicate throws DuplicatePaymentConfirmationError
      let threwDuplicatePrompt = false;
      try {
        await recordPaymentTransaction({
          tenancyId: tenancy.id,
          amountCents: 200000,
          transactionDate: '2026-11-20',
          method: 'cash',
          verificationStatus: 'landlord-reported',
          idempotencyToken: 'distinct-token-2',
        });
      } catch (err) {
        threwDuplicatePrompt = err instanceof DuplicatePaymentConfirmationError;
      }
      assert.equal(threwDuplicatePrompt, true, 'Expected DuplicatePaymentConfirmationError');

      // Confirming distinct same-day payment succeeds and issues a unique receipt number
      const secondPay = await recordPaymentTransaction({
        tenancyId: tenancy.id,
        amountCents: 200000,
        transactionDate: '2026-11-20',
        method: 'cash',
        verificationStatus: 'landlord-reported',
        idempotencyToken: 'distinct-token-2-confirmed',
        confirmDistinctDuplicate: true,
      });

      // Third payment of R1,500 against R1,000 remaining creates R500 advance credit (-50000c)
      const thirdPay = await recordPaymentTransaction({
        tenancyId: tenancy.id,
        amountCents: 150000,
        transactionDate: '2026-11-21',
        method: 'eft',
        verificationStatus: 'reconciled',
        externalReference: 'EFT-FINAL-001',
        idempotencyToken: 'final-overpay-token',
      });

      const receipts = await db.receipts.toArray();
      const uniqueNums = new Set(receipts.map((r) => r.receiptNumber));
      assert.equal(uniqueNums.size, receipts.length, 'Duplicate receipt numbers detected!');
      assert.equal(receipts.length, 3);
      assert.notEqual(secondPay.receipt.receiptNumber, thirdPay.receipt.receiptNumber);

      const summaryAfterOverpay = computeTenancyLedgerSummary(
        tenancy.id,
        await db.charges.toArray(),
        await db.payments.toArray(),
        await db.ledgerAdjustments.toArray(),
        await db.depositLiabilities.toArray()
      );
      assert.equal(summaryAfterOverpay.netBalanceDueCents, -50000, 'Expected R500.00 advance credit');
      assert.equal(summaryAfterOverpay.totalUnallocatedCreditCents, 50000);

      // Verify idempotent charge generation skips duplicate period
      const dupGen = await generateChargeForTenancy({
        tenancyId: tenancy.id,
        periodMonth: '2026-11',
        includeUtilities: false,
      });
      assert.equal(dupGen.createdCharges.length, 0);
      assert.equal(dupGen.skippedDuplicates.length, 1);

      return 'Partial, duplicate-confirm, overpayment credit (-50000c), concurrency lock & unique receipt numbers verified';
    }
  );

  // 5. F05 / F07 / F11 + seeded alloc-9 reversal check
  await runCase(
    'T05-TENANCY-DEPOSIT-REVERSAL',
    'Tenancy overlap block, unit occupancy sync, deposit movements & seeded Dawit reversal',
    async () => {
      await seedSampleData(true);

      // Reverse seeded pay-dawit-nov (which now has alloc-9) and verify chg-dawit-nov-rent restores to 0 paid
      const revReceipt = await reversePaymentTransaction('pay-dawit-nov', 'Bank EFT recall test');
      assert.ok(revReceipt.receiptNumber.startsWith('REV-'));
      const dawitCharge = await db.charges.get('chg-dawit-nov-rent');
      assert.equal(dawitCharge?.allocatedPaidCents, 0, 'Dawit charge allocatedPaidCents was not restored on reversal');
      assert.equal(dawitCharge?.status, 'overdue');

      // Overlapping active tenancy on occupied unit blocked
      const occupiedUnit = await db.units.get('unit-ubuntu-main');
      assert.equal(occupiedUnit?.status, 'occupied');
      await assert.rejects(
        () =>
          createTenancyRecord({
            propertyId: occupiedUnit!.propertyId,
            unitId: occupiedUnit!.id,
            primaryTenantId: 'tenant-dawit',
            leaseCategory: 'residential_standard',
            startDate: '2026-11-20',
            rentAmountCents: 220000,
            dueDayOfMonth: 1,
            depositRequiredCents: 220000,
            depositReceivedCents: 0,
            recurringUtilityChargeCents: 0,
            noticePeriodDays: 30,
            generateFirstMonthCharge: false,
          }),
        /already has an active tenancy/i
      );

      // Ending active tenancy reverts unit to vacant
      await updateTenancyStatus('tenancy-ubuntu-main', 'ended');
      const graceUnitAfterEnd = await db.units.get('unit-ubuntu-main');
      assert.equal(graceUnitAfterEnd?.status, 'vacant');

      // Deposit liability movement: deduction + refund + over-refund guard
      const depBefore = await db.depositLiabilities.get('dep-grace');
      assert.ok(depBefore);
      const heldBefore =
        depBefore.receivedDepositCents +
        depBefore.accruedInterestCents -
        depBefore.deductionsCents -
        depBefore.refundedCents;

      await recordDepositMovement({
        depositId: 'dep-grace',
        movementType: 'deduction',
        amountCents: 20000, // R200
        reason: 'Key replacement',
      });
      await recordDepositMovement({
        depositId: 'dep-grace',
        movementType: 'refund',
        amountCents: 100000, // R1,000
        reason: 'Partial move-out refund',
      });
      const depAfter = await db.depositLiabilities.get('dep-grace');
      const heldAfter =
        depAfter!.receivedDepositCents +
        depAfter!.accruedInterestCents -
        depAfter!.deductionsCents -
        depAfter!.refundedCents;
      assert.equal(heldAfter, heldBefore - 120000);

      // Attempting to refund more than remaining held liability must fail
      await assert.rejects(
        () =>
          recordDepositMovement({
            depositId: 'dep-grace',
            movementType: 'refund',
            amountCents: heldAfter + 100,
            reason: 'Over-refund test',
          }),
        /exceeds held deposit liability/i
      );

      return 'Seeded alloc-9 reversal, overlap guard, occupancy sync, and deposit liability cap all verified';
    }
  );

  // 6. A03 Backup export, strict validation, atomic restore & rollback preservation
  await runCase(
    'T06-A03-BACKUP-RESTORE',
    'Backup JSON schema/FK validation, round-trip restore & rollback on failure',
    async () => {
      await seedSampleData(true);
      const envelope = await buildFullBackupEnvelope();
      const rawJson = JSON.stringify(envelope);
      const validated = validateBackupJSON(rawJson);
      assert.equal(validated.valid, true, validated.error);
      assert.ok(validated.envelope);

      const originalCounts = await snapshotCounts();

      // Clear workspace completely then restore
      await clearSampleDataToEmptyWorkspace();
      assert.equal(await db.properties.count(), 0);
      assert.equal(await db.payments.count(), 0);

      await restoreValidatedBackup(validated.envelope!);
      const restoredCounts = await snapshotCounts();
      assert.deepEqual(restoredCounts, originalCounts, 'Restored row counts do not match original snapshot');

      // Test rollback during restore failure preserves existing data
      let restoreFailed = false;
      try {
        await restoreValidatedBackup(validated.envelope!, {
          onBeforeCommitForTest: () => {
            throw new Error('INJECTED_RESTORE_FAILURE');
          },
        });
      } catch (err) {
        restoreFailed = err instanceof Error && err.message.includes('INJECTED_RESTORE_FAILURE');
      }
      assert.equal(restoreFailed, true);
      assert.deepEqual(await snapshotCounts(), originalCounts, 'Existing data corrupted after failed restore');

      // Corrupt cent value rejected
      const badCentEnvelope = structuredClone(envelope);
      (badCentEnvelope.tables.payments[0] as { amountCents: number }).amountCents = 123.45;
      const badCentCheck = validateBackupJSON(JSON.stringify(badCentEnvelope));
      assert.equal(badCentCheck.valid, false);

      return `Round-trip restored ${restoredCounts.properties} properties, ${restoredCounts.payments} payments, ${restoredCounts.receipts} receipts; failure rollback preserved state`;
    }
  );

  // 7. A06 & A08 Simulated subscription persistence & truthful cloud boundary
  await runCase(
    'T07-A06-A08-SUBSCRIPTION-CLOUD',
    'Persisted simulated subscription tier & truthful cloud boundary status',
    async () => {
      await seedSampleData(true);
      await updateSimulatedSubscriptionPlan('starter', 'manual_eft_pending_demo');
      const settings = await db.applicationSettings.get('settings-default');
      assert.equal(settings?.selectedPlanTier, 'starter');
      assert.equal(settings?.simulatedBillingStatus, 'manual_eft_pending_demo');

      const boundary = getCloudBoundaryStatus();
      assert.equal(boundary.activeStorageEngine, 'local_indexeddb_only');
      assert.equal(boundary.supabaseConnectionVerified, false);
      assert.equal(boundary.supabasePostgresConfigured, false);
      return `Plan persisted (${settings?.selectedPlanTier}/${settings?.simulatedBillingStatus}); cloud boundary honest (${boundary.activeStorageEngine})`;
    }
  );

  const failedCount = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n=== AKARAI PROTOTYPE VERIFICATION SUMMARY ===');
  console.log(`Passed: ${results.length - failedCount}/${results.length}`);
  if (failedCount > 0) {
    console.error(`Failed: ${failedCount}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
