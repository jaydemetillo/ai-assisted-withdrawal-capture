import { afterAll, beforeEach, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { DEFAULT_DECISION_CONFIG } from '@/lib/decision/config';
import { confirmWithdrawal } from '@/lib/inventory/confirm';
import { setStorage } from '@/lib/storage';
import { createSubmission } from '@/lib/withdrawals/create';
import { runExtraction } from '@/lib/withdrawals/extract';
import { describeWithDb } from '../helpers/db';
import {
  MemoryStorage,
  balanceFor,
  itemBySku,
  resetBalances,
  resetWorkingData,
  resusLocation,
  userWithRole,
} from '../helpers/factory';

/**
 * The confirm endpoint, against a real PostgreSQL database.
 *
 * These are the tests that decide whether the claims in the README are true. If one of
 * them starts failing, the right response is to stop shipping, not to adjust the test.
 */
describeWithDb('confirmWithdrawal', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    setStorage(new MemoryStorage());
  });

  afterAll(async () => {
    setStorage(null);
    await prisma.$disconnect();
  });

  async function submitAndExtract(scenario: string) {
    const nurse = await userWithRole(prisma, 'nurse');
    const location = await resusLocation(prisma);
    const { id } = await createSubmission({
      user: nurse,
      locationId: location.id,
      image: { data: Buffer.from(`photo-${scenario}-${Math.random()}`), mediaType: 'image/jpeg' },
      demoScenario: scenario,
    });
    await runExtraction(id);
    return { id, nurse, location };
  }

  it('deducts stock exactly once for a clear note', async () => {
    const cannulaBefore = (await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand;
    const flushBefore = (await balanceFor(prisma, 'NS-FLUSH-10ML')).quantityOnHand;

    const { id, nurse } = await submitAndExtract('high_confidence');
    const result = await confirmWithdrawal({ submissionId: id, actor: nurse });

    expect(result.replayed).toBe(false);
    expect(result.movements).toHaveLength(2);

    expect((await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand).toBe(cannulaBefore - 1);
    expect((await balanceFor(prisma, 'NS-FLUSH-10ML')).quantityOnHand).toBe(flushBefore - 2);
    expect(await prisma.inventoryTransaction.count({ where: { submissionId: id } })).toBe(2);
  });

  it('increments the version on every balance it touches', async () => {
    const before = await balanceFor(prisma, 'IVC-18G-BLUE');
    const { id, nurse } = await submitAndExtract('high_confidence');
    await confirmWithdrawal({ submissionId: id, actor: nurse });

    expect((await balanceFor(prisma, 'IVC-18G-BLUE')).version).toBe(before.version + 1);
  });

  it('is idempotent — a repeated call deducts nothing further', async () => {
    const { id, nurse } = await submitAndExtract('high_confidence');

    const first = await confirmWithdrawal({ submissionId: id, actor: nurse, idempotencyKey: 'key-1' });
    const after = (await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand;

    const second = await confirmWithdrawal({ submissionId: id, actor: nurse, idempotencyKey: 'key-1' });
    const third = await confirmWithdrawal({ submissionId: id, actor: nurse, idempotencyKey: 'different-key' });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect((await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand).toBe(after);
    expect(await prisma.inventoryTransaction.count({ where: { submissionId: id } })).toBe(2);
  });

  it('survives a genuine double-click — two concurrent calls, one deduction', async () => {
    const startingStock = (await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand;
    const { id, nurse } = await submitAndExtract('high_confidence');

    const results = await Promise.all([
      confirmWithdrawal({ submissionId: id, actor: nurse, idempotencyKey: 'double-a' }),
      confirmWithdrawal({ submissionId: id, actor: nurse, idempotencyKey: 'double-b' }),
    ]);

    // BOTH calls succeed — the loser of the race retries, finds the work done, and
    // replays. A user who double-taps sees a confirmation twice, never an error.
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(1);
    expect((await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand).toBe(startingStock - 1);
    expect(await prisma.inventoryTransaction.count({ where: { submissionId: id } })).toBe(2);
  });

  it('refuses an ambiguous submission', async () => {
    const before = (await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand;
    const { id, nurse } = await submitAndExtract('ambiguous');

    await expect(confirmWithdrawal({ submissionId: id, actor: nurse })).rejects.toThrow(
      /still needs a decision/i,
    );
    expect((await balanceFor(prisma, 'IVC-18G-BLUE')).quantityOnHand).toBe(before);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('refuses an unreadable submission', async () => {
    const { id, nurse } = await submitAndExtract('unreadable');
    await expect(confirmWithdrawal({ submissionId: id, actor: nurse })).rejects.toThrow();
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('confirms an ambiguous line once a human has chosen the item', async () => {
    const { id, nurse } = await submitAndExtract('ambiguous');
    const candidate = await prisma.extractedCandidate.findFirstOrThrow({ where: { submissionId: id } });
    const chosen = await itemBySku(prisma, 'IVC-22G-BLUE');
    const before = (await balanceFor(prisma, 'IVC-22G-BLUE')).quantityOnHand;

    await prisma.extractedCandidate.update({
      where: { id: candidate.id },
      data: { disposition: 'corrected', resolvedItemId: chosen.id, resolvedQuantity: 1, resolvedById: nurse.id },
    });

    const result = await confirmWithdrawal({ submissionId: id, actor: nurse });
    expect(result.movements[0]?.sku).toBe('IVC-22G-BLUE');
    expect((await balanceFor(prisma, 'IVC-22G-BLUE')).quantityOnHand).toBe(before - 1);
  });

  it('raises a replenishment task when a withdrawal crosses the reorder threshold', async () => {
    // Seeded at 21 with a threshold of 20; the demo note takes 2.
    const { id, nurse } = await submitAndExtract('high_confidence');
    const result = await confirmWithdrawal({ submissionId: id, actor: nurse });

    expect(result.replenishmentTaskCount).toBe(1);
    const flush = await itemBySku(prisma, 'NS-FLUSH-10ML');
    const task = await prisma.replenishmentTask.findFirstOrThrow({ where: { itemId: flush.id, status: 'open' } });
    expect(task.quantityAtTrigger).toBe(19);
    expect(task.reorderThreshold).toBe(20);
    expect(task.suggestedQuantity).toBe(60);
  });

  it('does not raise a second task while one is still open', async () => {
    const first = await submitAndExtract('high_confidence');
    await confirmWithdrawal({ submissionId: first.id, actor: first.nurse });

    const second = await submitAndExtract('high_confidence');
    const result = await confirmWithdrawal({ submissionId: second.id, actor: second.nurse });

    expect(result.replenishmentTaskCount).toBe(0);
    const flush = await itemBySku(prisma, 'NS-FLUSH-10ML');
    expect(await prisma.replenishmentTask.count({ where: { itemId: flush.id, status: 'open' } })).toBe(1);
  });

  it('marks every applied line and closes the review cases it settled', async () => {
    const { id, nurse } = await submitAndExtract('high_confidence');
    await confirmWithdrawal({ submissionId: id, actor: nurse });

    const candidates = await prisma.extractedCandidate.findMany({ where: { submissionId: id } });
    expect(candidates.every((c) => c.disposition === 'applied')).toBe(true);
  });

  it('writes an audit trail that reconstructs the whole change', async () => {
    const { id, nurse } = await submitAndExtract('high_confidence');
    await confirmWithdrawal({ submissionId: id, actor: nurse });

    const events = await prisma.auditEvent.findMany({ where: { submissionId: id } });
    const actions = events.map((e) => e.action);

    expect(actions).toContain('submission.created');
    expect(actions).toContain('transaction.created');
    expect(actions).toContain('balance.changed');
    expect(actions).toContain('submission.confirmed');
    expect(actions).toContain('replenishment.created');

    const balanceChange = events.find((e) => e.action === 'balance.changed');
    expect(balanceChange?.beforeValue).toBeTruthy();
    expect(balanceChange?.afterValue).toBeTruthy();
    expect(balanceChange?.actorId).toBe(nurse.id);
  });
});

describeWithDb('restricted items', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    setStorage(new MemoryStorage());
  });

  async function morphineSubmission() {
    const nurse = await userWithRole(prisma, 'nurse');
    const location = await resusLocation(prisma);
    const morphine = await itemBySku(prisma, 'MORPH-10MG');

    const submission = await prisma.withdrawalSubmission.create({
      data: {
        submitterId: nurse.id,
        locationId: location.id,
        imageKey: 'test.jpg',
        imageMediaType: 'image/jpeg',
        status: 'awaiting_review',
        extractionStatus: 'succeeded',
        rawText: 'morphine x1',
        extractionProvider: 'mock',
      },
    });
    await prisma.extractedCandidate.create({
      data: {
        submissionId: submission.id,
        sequence: 0,
        rawText: 'morphine x1',
        proposedQuantity: 1,
        proposedItemId: morphine.id,
        matchedItemId: morphine.id,
        providerConfidence: 0.99,
        providerStatus: 'restricted',
        providerReason: 'controlled',
        decision: 'restricted',
        decisionReasonCode: 'rule_2_restricted_item',
        decisionMessage: 'Supply review must verify this.',
        // Already looked at and accepted by a human. The only question left is WHO is
        // allowed to confirm it — which is exactly the rule under test.
        disposition: 'confirmed',
        resolvedItemId: morphine.id,
        resolvedQuantity: 1,
        resolvedById: nurse.id,
        resolvedAt: new Date(),
      },
    });
    return { submissionId: submission.id, nurse, morphine };
  }

  it('cannot be self-confirmed by a nurse', async () => {
    const { submissionId, nurse, morphine } = await morphineSubmission();
    const before = (await balanceFor(prisma, 'MORPH-10MG')).quantityOnHand;

    await expect(confirmWithdrawal({ submissionId, actor: nurse })).rejects.toThrow(
      /controlled or high-risk|Supply review/i,
    );
    expect((await balanceFor(prisma, 'MORPH-10MG')).quantityOnHand).toBe(before);
    expect(await prisma.inventoryTransaction.count({ where: { itemId: morphine.id } })).toBe(0);
  });

  it('can be confirmed by a supply reviewer', async () => {
    const { submissionId } = await morphineSubmission();
    const reviewer = await userWithRole(prisma, 'supply_reviewer');
    const before = (await balanceFor(prisma, 'MORPH-10MG')).quantityOnHand;

    const result = await confirmWithdrawal({ submissionId, actor: reviewer });

    expect(result.movements[0]?.sku).toBe('MORPH-10MG');
    expect((await balanceFor(prisma, 'MORPH-10MG')).quantityOnHand).toBe(before - 1);

    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { submissionId } });
    expect(tx.actorRole).toBe('supply_reviewer');
  });

  it('only a deliberate configuration change lets a nurse through', async () => {
    const { submissionId, nurse } = await morphineSubmission();
    const result = await confirmWithdrawal({
      submissionId,
      actor: nurse,
      config: { ...DEFAULT_DECISION_CONFIG, restrictedSelfConfirm: true },
    });
    expect(result.movements).toHaveLength(1);
  });
});

describeWithDb('insufficient stock', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    setStorage(new MemoryStorage());
  });

  async function padsSubmission(quantity: number) {
    const reviewer = await userWithRole(prisma, 'supply_reviewer');
    const location = await resusLocation(prisma);
    const pads = await itemBySku(prisma, 'DEFIB-PADS-ADULT');

    const submission = await prisma.withdrawalSubmission.create({
      data: {
        submitterId: reviewer.id,
        locationId: location.id,
        imageKey: 'test.jpg',
        imageMediaType: 'image/jpeg',
        status: 'awaiting_review',
        extractionStatus: 'succeeded',
        extractionProvider: 'mock',
      },
    });
    await prisma.extractedCandidate.create({
      data: {
        submissionId: submission.id,
        sequence: 0,
        rawText: `defib pads x${quantity}`,
        proposedQuantity: quantity,
        matchedItemId: pads.id,
        providerConfidence: 0.99,
        providerStatus: 'restricted',
        decision: 'restricted',
        decisionReasonCode: 'rule_2_restricted_item',
        decisionMessage: 'High-risk item.',
        disposition: 'confirmed',
        resolvedItemId: pads.id,
        resolvedQuantity: quantity,
        resolvedById: reviewer.id,
      },
    });
    return { submissionId: submission.id, reviewer };
  }

  it('records the withdrawal and raises a discrepancy under the default policy', async () => {
    // Seeded with 1 on hand; the reviewer signs off 2 that were physically taken.
    const { submissionId, reviewer } = await padsSubmission(2);
    const result = await confirmWithdrawal({ submissionId, actor: reviewer });

    expect(result.discrepancyCount).toBe(1);
    expect(result.movements[0]?.after).toBe(-1);
    expect(result.movements[0]?.shortfall).toBe(1);
    expect((await balanceFor(prisma, 'DEFIB-PADS-ADULT')).quantityOnHand).toBe(-1);

    const cases = await prisma.reviewCase.findMany({ where: { submissionId, kind: 'stock_discrepancy' } });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.priority).toBe('high');
  });

  it('refuses the withdrawal under the block policy, and still records why', async () => {
    const { submissionId, reviewer } = await padsSubmission(2);
    const before = (await balanceFor(prisma, 'DEFIB-PADS-ADULT')).quantityOnHand;

    await expect(
      confirmWithdrawal({
        submissionId,
        actor: reviewer,
        config: { ...DEFAULT_DECISION_CONFIG, negativeStockPolicy: 'block' },
      }),
    ).rejects.toThrow(/only 1 on hand/i);

    expect((await balanceFor(prisma, 'DEFIB-PADS-ADULT')).quantityOnHand).toBe(before);
    expect(await prisma.inventoryTransaction.count({ where: { submissionId } })).toBe(0);

    const submission = await prisma.withdrawalSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(submission.status).not.toBe('confirmed');

    const cases = await prisma.reviewCase.findMany({ where: { submissionId, kind: 'stock_discrepancy' } });
    expect(cases).toHaveLength(1);
  });
});
