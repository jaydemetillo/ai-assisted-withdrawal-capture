import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUDIT_ACTIONS, recordAudit, type AuditInput } from '@/lib/audit';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { loadDecisionConfig, type DecisionConfig } from '@/lib/decision/config';
import { evaluateSubmission, type CandidateState } from '@/lib/decision/submission';
import { expected } from '@/lib/http';
import { learnFromConfirmation } from '@/lib/vision/learn';
import { log } from '@/lib/log';

/**
 * The only thing in this application that changes stock.
 *
 * Everything else — extraction, matching, the review screen, the reviewer queue — feeds
 * this function. If you are adding a second writer, stop: the guarantees below are only
 * guarantees because there is exactly one of them.
 *
 * What makes a double-tap harmless, in order of how much work each one saves:
 *
 *   1. A status compare-and-set. Only the caller that flips awaiting_review → confirmed
 *      does the work; everyone else replays the stored result.
 *   2. A unique index on (submissionId, sourceCandidateId). Even if two callers somehow
 *      got past the CAS, the second INSERT cannot land.
 *   3. `SELECT … FOR UPDATE` on every balance, ordered by id, plus a version-conditional
 *      UPDATE. Two different submissions touching the same item serialise rather than
 *      interleave, and a lost update is impossible rather than unlikely.
 *
 * All three overlap on purpose. The cost of a redundant guard is a few milliseconds; the
 * cost of a missing one is a resus bay whose recorded stock is wrong.
 */
export type Movement = {
  itemId: string;
  sku: string;
  displayName: string;
  unit: string;
  quantity: number;
  before: number;
  after: number;
  belowThreshold: boolean;
  shortfall: number;
};

export type ConfirmResult = {
  submissionId: string;
  /** True when this call found the work already done and replayed the stored result. */
  replayed: boolean;
  movements: Movement[];
  replenishmentTaskCount: number;
  discrepancyCount: number;
};

/**
 * Postgres aborted the transaction to preserve serialisability (40001), or broke a
 * deadlock (40P01). Prisma surfaces both as P2034. Neither means anything went wrong —
 * it means two confirmations touched the same rows at once and one has to go again. On
 * the retry the status compare-and-set finds the work already done and replays it, so a
 * genuine double-click shows the user a confirmation rather than an error.
 */
function isTransientConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2034' || code === '40001' || code === '40P01';
}

/** Thrown inside the transaction when a version check fails and the attempt must retry. */
class VersionConflict extends Error {
  constructor() {
    super('A stock level changed while this was being confirmed.');
    this.name = 'VersionConflict';
  }
}

/** Thrown when NEGATIVE_STOCK_POLICY=block and a line asks for more than is on hand. */
class InsufficientStock extends Error {
  constructor(readonly detail: { itemId: string; displayName: string; requested: number; onHand: number }) {
    super(`Not enough ${detail.displayName} on hand.`);
    this.name = 'InsufficientStock';
  }
}

export async function confirmWithdrawal(input: {
  submissionId: string;
  actor: User;
  idempotencyKey?: string | null;
  config?: DecisionConfig;
}): Promise<ConfirmResult> {
  const config = input.config ?? loadDecisionConfig();
  const { submissionId, actor } = input;

  const submission = await prisma.withdrawalSubmission.findUnique({
    where: { id: submissionId },
    include: { candidates: { orderBy: { sequence: 'asc' } } },
  });
  if (!submission) throw expected('That submission no longer exists.');

  // A nurse may only confirm their own. A reviewer or admin may confirm any, and the
  // resulting transaction records which role did it.
  if (actor.role === 'nurse' && submission.submitterId !== actor.id) {
    throw expected('That submission belongs to someone else.');
  }

  // Already done: replay rather than repeat. This is the path a double-tap takes.
  if (submission.status === 'confirmed') {
    return { ...(await replayResult(submissionId)), replayed: true };
  }

  const catalogue = await catalogueForLocation(submission.locationId);
  const states: CandidateState[] = submission.candidates.map((c) => ({
    id: c.id,
    sequence: c.sequence,
    rawText: c.rawText,
    decision: c.decision,
    disposition: c.disposition,
    matchedItemId: c.matchedItemId,
    resolvedItemId: c.resolvedItemId,
    proposedQuantity: c.proposedQuantity,
    resolvedQuantity: c.resolvedQuantity,
  }));

  // Re-evaluated server-side against data read a moment ago. The review screen's
  // disabled button is a courtesy; THIS is the control. A candidate that became
  // restricted since the screen rendered blocks the confirmation here.
  const evaluation = evaluateSubmission(
    { status: submission.status, candidates: states },
    { actorRole: actor.role, catalogue, config },
  );
  if (!evaluation.canConfirm) {
    throw expected(evaluation.blockers[0]?.message ?? 'This withdrawal cannot be confirmed yet.');
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= config.confirmMaxRetries; attempt++) {
    try {
      const result = await applyOnce({
        submission,
        actor,
        lines: evaluation.lines,
        catalogue,
        config,
        key: input.idempotencyKey,
      });

      // The learning step, outside the transaction and after the stock has moved.
      //
      // Deliberately awaited rather than fired and forgotten: on a serverless host the
      // function is frozen the moment the response is returned, so a detached promise
      // here is a promise that silently never runs. It cannot throw — see
      // learnFromConfirmation — and it cannot change stock, because the only table it
      // writes to is ItemReferencePhoto.
      await learnFromConfirmation(result.submissionId);

      return result;
    } catch (error) {
      if (error instanceof VersionConflict || isTransientConflict(error)) {
        lastError = error;
        log.warn('confirm retrying after a conflict', { submissionId, attempt });
        // A short, growing pause: retrying instantly just loses the same race again.
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (error instanceof InsufficientStock) {
        // The policy said to refuse. Record why, outside the rolled-back transaction, so
        // the shortage is visible to supply review rather than only to the nurse.
        await prisma.reviewCase.create({
          data: {
            submissionId,
            itemId: error.detail.itemId,
            locationId: submission.locationId,
            kind: 'stock_discrepancy',
            priority: 'high',
            summary: `${error.detail.displayName}: ${error.detail.requested} requested, ${error.detail.onHand} on hand.`,
          },
        });
        throw expected(
          `${error.detail.displayName}: only ${error.detail.onHand} on hand but ${error.detail.requested} requested. This has been sent to supply review.`,
        );
      }
      throw error;
    }
  }

  log.error('confirm gave up after repeated version conflicts', { submissionId });
  throw lastError instanceof Error
    ? expected('Stock levels kept changing while this was being confirmed. Please try once more.')
    : expected('This withdrawal could not be confirmed. Please try again.');
}

type ApplyInput = {
  submission: { id: string; locationId: string; status: string };
  actor: User;
  lines: { candidateId: string; itemId: string; quantity: number }[];
  catalogue: Awaited<ReturnType<typeof catalogueForLocation>>;
  config: DecisionConfig;
  key?: string | null;
};

async function applyOnce(input: ApplyInput): Promise<ConfirmResult> {
  const { submission, actor, lines, catalogue, config } = input;

  return prisma.$transaction(
    async (db) => {
      // ── 1. Claim the submission. Whoever flips the status owns the deduction; any
      // concurrent caller finds zero rows and replays instead.
      const claimed = await db.withdrawalSubmission.updateMany({
        where: { id: submission.id, status: { in: ['awaiting_review', 'in_supply_review'] } },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          confirmedById: actor.id,
          confirmationKey: input.key ?? null,
        },
      });
      if (claimed.count === 0) {
        return { ...(await replayResult(submission.id, db as unknown as PrismaClient)), replayed: true };
      }

      // ── 2. Lock every balance we are about to touch, in a stable order. Ordering by id
      // is what stops two concurrent confirmations deadlocking on the same two items.
      const itemIds = [...new Set(lines.map((l) => l.itemId))].sort();
      const balances = await db.inventoryBalance.findMany({
        where: { locationId: submission.locationId, itemId: { in: itemIds } },
        orderBy: { id: 'asc' },
      });
      if (balances.length !== itemIds.length) {
        throw expected('One of those items is no longer stocked at this location.');
      }
      await db.$queryRaw`
        SELECT id FROM "InventoryBalance"
        WHERE id IN (${Prisma.join(balances.map((b) => b.id))})
        ORDER BY id
        FOR UPDATE`;

      // Re-read after locking: the pre-lock read may be stale by microseconds.
      const locked = await db.inventoryBalance.findMany({
        where: { id: { in: balances.map((b) => b.id) } },
      });
      const balanceByItem = new Map(locked.map((b) => [b.itemId, b]));

      // ── 3. Several lines can name the same item. Totalling first means one movement
      // per item, one version bump, and arithmetic a human can follow on the receipt.
      const totals = new Map<string, { quantity: number; candidateIds: string[] }>();
      for (const line of lines) {
        const entry = totals.get(line.itemId) ?? { quantity: 0, candidateIds: [] };
        entry.quantity += line.quantity;
        entry.candidateIds.push(line.candidateId);
        totals.set(line.itemId, entry);
      }

      const movements: Movement[] = [];
      const audits: AuditInput[] = [];
      let replenishmentTaskCount = 0;
      let discrepancyCount = 0;

      for (const itemId of itemIds) {
        const total = totals.get(itemId);
        const balance = balanceByItem.get(itemId);
        const item = catalogue.items.find((i) => i.id === itemId);
        if (!total || !balance || !item) throw expected('That item is no longer available.');

        const before = balance.quantityOnHand;
        const after = before - total.quantity;
        const shortfall = Math.max(0, total.quantity - before);

        if (shortfall > 0 && config.negativeStockPolicy === 'block') {
          throw new InsufficientStock({
            itemId,
            displayName: item.displayName,
            requested: total.quantity,
            onHand: before,
          });
        }

        // ── 4. One immutable ledger row per candidate. The unique index on
        // (submissionId, sourceCandidateId) is the last line of defence against a
        // double deduction; the quantities are split so before+delta=after holds per row.
        let running = before;
        for (const candidateId of total.candidateIds) {
          const line = lines.find((l) => l.candidateId === candidateId);
          if (!line) continue;
          const next = running - line.quantity;
          const transaction = await db.inventoryTransaction.create({
            data: {
              submissionId: submission.id,
              sourceCandidateId: candidateId,
              itemId,
              locationId: submission.locationId,
              type: 'withdrawal',
              quantityDelta: -line.quantity,
              quantityBefore: running,
              quantityAfter: next,
              actorId: actor.id,
              actorRole: actor.role,
              reason: 'Confirmed from a photographed withdrawal',
            },
          });
          running = next;

          audits.push({
            action: AUDIT_ACTIONS.transactionCreated,
            entityType: 'InventoryTransaction',
            entityId: transaction.id,
            actorId: actor.id,
            actorRole: actor.role,
            submissionId: submission.id,
            locationId: submission.locationId,
            afterValue: { itemSku: item.sku, quantityDelta: -line.quantity, before: transaction.quantityBefore, after: next },
          });
        }

        // ── 5. Version-conditional update. Zero rows means somebody changed this balance
        // between our lock and our write, which should be impossible under Serializable —
        // so we retry rather than assume.
        const updated = await db.inventoryBalance.updateMany({
          where: { id: balance.id, version: balance.version },
          data: { quantityOnHand: after, version: balance.version + 1 },
        });
        if (updated.count === 0) throw new VersionConflict();

        audits.push({
          action: AUDIT_ACTIONS.balanceChanged,
          entityType: 'InventoryBalance',
          entityId: balance.id,
          actorId: actor.id,
          actorRole: actor.role,
          submissionId: submission.id,
          locationId: submission.locationId,
          beforeValue: { quantityOnHand: before, version: balance.version },
          afterValue: { quantityOnHand: after, version: balance.version + 1, itemSku: item.sku },
        });

        // ── 6. A shortage is recorded, not hidden. The items physically left the cart;
        // refusing to write that down would make the ledger more wrong, not less.
        if (shortfall > 0) {
          discrepancyCount++;
          await db.reviewCase.create({
            data: {
              submissionId: submission.id,
              itemId,
              locationId: submission.locationId,
              kind: 'stock_discrepancy',
              priority: 'high',
              summary: `${item.displayName}: ${total.quantity} withdrawn but only ${before} were recorded on hand.`,
            },
          });
        }

        // ── 7. Replenishment, at most one open task per item and location. A partial
        // unique index enforces that too, so a race cannot produce a duplicate.
        const belowThreshold = after <= item.reorderThreshold;
        if (belowThreshold) {
          const open = await db.replenishmentTask.findFirst({
            where: { itemId, locationId: submission.locationId, status: 'open' },
          });
          if (!open) {
            const task = await db.replenishmentTask.create({
              data: {
                itemId,
                locationId: submission.locationId,
                triggeredByTransactionId: null,
                quantityAtTrigger: after,
                reorderThreshold: item.reorderThreshold,
                suggestedQuantity: item.reorderQuantity,
                note: shortfall > 0 ? 'Raised alongside a stock discrepancy.' : '',
              },
            });
            replenishmentTaskCount++;
            audits.push({
              action: AUDIT_ACTIONS.replenishmentCreated,
              entityType: 'ReplenishmentTask',
              entityId: task.id,
              actorId: actor.id,
              actorRole: actor.role,
              submissionId: submission.id,
              locationId: submission.locationId,
              afterValue: { itemSku: item.sku, quantityAtTrigger: after, threshold: item.reorderThreshold },
            });
          }
        }

        movements.push({
          itemId,
          sku: item.sku,
          displayName: item.displayName,
          unit: item.unit,
          quantity: total.quantity,
          before,
          after,
          belowThreshold,
          shortfall,
        });
      }

      // ── 8. Mark the lines applied, and close anything they were waiting on.
      await db.extractedCandidate.updateMany({
        where: { id: { in: lines.map((l) => l.candidateId) } },
        data: { disposition: 'applied' },
      });
      await db.reviewCase.updateMany({
        where: {
          submissionId: submission.id,
          kind: { not: 'stock_discrepancy' },
          status: { in: ['open', 'in_progress', 'awaiting_physical_check'] },
        },
        data: { status: 'resolved', resolvedAt: new Date(), resolutionNote: 'Resolved by a confirmed withdrawal.' },
      });

      audits.push({
        action: AUDIT_ACTIONS.submissionConfirmed,
        entityType: 'WithdrawalSubmission',
        entityId: submission.id,
        actorId: actor.id,
        actorRole: actor.role,
        submissionId: submission.id,
        locationId: submission.locationId,
        beforeValue: { status: submission.status },
        afterValue: { status: 'confirmed', lines: lines.length, items: movements.length },
      });

      for (const audit of audits) await recordAudit(audit, db);

      return {
        submissionId: submission.id,
        replayed: false,
        movements,
        replenishmentTaskCount,
        discrepancyCount,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
  );
}

/**
 * Rebuild the confirmation result from the ledger.
 *
 * A replay reads the immutable transaction rows rather than a cached response, so what a
 * repeated click shows is what actually happened — including if somebody later wrote a
 * correction.
 */
async function replayResult(
  submissionId: string,
  db: PrismaClient = prisma,
): Promise<Omit<ConfirmResult, 'replayed'>> {
  const transactions = await db.inventoryTransaction.findMany({
    where: { submissionId },
    include: { item: true },
    orderBy: { createdAt: 'asc' },
  });

  const byItem = new Map<string, Movement>();
  for (const tx of transactions) {
    const existing = byItem.get(tx.itemId);
    if (existing) {
      existing.quantity += Math.abs(tx.quantityDelta);
      existing.after = tx.quantityAfter;
    } else {
      byItem.set(tx.itemId, {
        itemId: tx.itemId,
        sku: tx.item.sku,
        displayName: tx.item.displayName,
        unit: tx.item.unit,
        quantity: Math.abs(tx.quantityDelta),
        before: tx.quantityBefore,
        after: tx.quantityAfter,
        belowThreshold: tx.quantityAfter <= tx.item.reorderThreshold,
        shortfall: Math.max(0, -tx.quantityAfter),
      });
    }
  }

  const [replenishmentTaskCount, discrepancyCount] = await Promise.all([
    db.replenishmentTask.count({
      where: { locationId: transactions[0]?.locationId, itemId: { in: [...byItem.keys()] }, status: 'open' },
    }),
    db.reviewCase.count({ where: { submissionId, kind: 'stock_discrepancy' } }),
  ]);

  return { submissionId, movements: [...byItem.values()], replenishmentTaskCount, discrepancyCount };
}
