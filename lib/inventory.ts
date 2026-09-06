import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ACTION_COPY, type Action } from '@/lib/constants';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Stock is DERIVED, never patched.
 *
 * `StockLevel.quantity` is a cache of `openingQuantity + Σ delta` over every line of
 * every non-voided transaction for that item/storeroom. Committing, editing and voiding
 * all just change lines and then call this. That is what makes an admin correcting a
 * miscounted row trivially correct: there is no incremental adjustment to get wrong,
 * and no way for the cache to drift from the ledger.
 */
export async function recomputeStock(db: Db, itemId: string, storeroomId: string): Promise<number> {
  const level = await db.stockLevel.findUnique({
    where: { itemId_storeroomId: { itemId, storeroomId } },
  });
  if (!level) return 0;

  const agg = await db.transactionLine.aggregate({
    _sum: { delta: true },
    where: { itemId, transaction: { storeroomId, voided: false } },
  });

  const quantity = level.openingQuantity + (agg._sum.delta ?? 0);
  await db.stockLevel.update({
    where: { id: level.id },
    data: { quantity },
  });
  return quantity;
}

/** Recompute every item touched by a transaction. */
export async function recomputeForTransaction(db: Db, transactionId: string): Promise<void> {
  const tx = await db.transaction.findUnique({
    where: { id: transactionId },
    include: { lines: { select: { itemId: true } } },
  });
  if (!tx) return;
  const itemIds = [...new Set(tx.lines.map((l) => l.itemId))];
  for (const itemId of itemIds) {
    await recomputeStock(db, itemId, tx.storeroomId);
  }
}

/** Both WITHDRAW and DISPOSE remove stock; the distinction is what it means, not the sign. */
export function deltaFor(action: Action, quantity: number): number {
  return -Math.abs(quantity);
}

export async function nextReference(db: Db, action: Action): Promise<string> {
  const prefix = action === 'WITHDRAW' ? 'WD' : 'DP';
  const count = await db.transaction.count({ where: { action } });
  return `${prefix}-${String(count + 1).padStart(5, '0')}`;
}

export type CommitResult = {
  transactionId: string;
  reference: string;
  movements: { itemId: string; itemName: string; quantity: number; before: number; after: number }[];
};

/**
 * Turn a reviewed DRAFT capture into a committed transaction and move stock.
 *
 * Runs in one database transaction so a partially-applied note is impossible: either
 * every line lands and the stock levels are recomputed, or nothing changes.
 */
export async function commitCapture(captureId: string): Promise<CommitResult> {
  return prisma.$transaction(async (db) => {
    const capture = await db.capture.findUnique({
      where: { id: captureId },
      include: { lines: true },
    });
    if (!capture) throw new Error(`Capture ${captureId} not found`);
    if (capture.status === 'COMMITTED') throw new Error('This capture has already been submitted');
    if (capture.status === 'VOID') throw new Error('This capture was discarded');

    const usable = capture.lines.filter((l) => l.itemId && l.quantity > 0);
    if (usable.length === 0) {
      throw new Error('Nothing to submit - every line still needs an item and a quantity');
    }

    const action = capture.action as Action;
    const reference = await nextReference(db, action);

    // Snapshot stock before, so the confirmation screen can show "130 -> 127".
    const before = new Map<string, number>();
    for (const line of usable) {
      const level = await db.stockLevel.findUnique({
        where: { itemId_storeroomId: { itemId: line.itemId!, storeroomId: capture.storeroomId } },
      });
      before.set(line.itemId!, level?.quantity ?? 0);
    }

    const transaction = await db.transaction.create({
      data: {
        reference,
        action,
        storeroomId: capture.storeroomId,
        userId: capture.userId,
        captureId: capture.id,
        reason: capture.reason,
        remarks: `${ACTION_COPY[action].past} from a photographed list`,
        lines: {
          create: usable.map((line) => ({
            itemId: line.itemId!,
            quantity: line.quantity,
            delta: deltaFor(action, line.quantity),
            rawText: line.rawText,
            confidence: line.confidence,
            bbox: line.bbox,
            matchStatus: line.matchSource === 'MANUAL' ? 'CORRECTED' : 'AUTO',
          })),
        },
      },
      include: { lines: { include: { item: true } } },
    });

    await db.capture.update({ where: { id: capture.id }, data: { status: 'COMMITTED' } });
    await recomputeForTransaction(db, transaction.id);

    const movements = [];
    for (const line of transaction.lines) {
      const level = await db.stockLevel.findUnique({
        where: { itemId_storeroomId: { itemId: line.itemId, storeroomId: capture.storeroomId } },
      });
      movements.push({
        itemId: line.itemId,
        itemName: line.item.name,
        quantity: line.quantity,
        before: before.get(line.itemId) ?? 0,
        after: level?.quantity ?? 0,
      });
    }

    return { transactionId: transaction.id, reference, movements };
  });
}

/**
 * Admin correction of a committed line (wrong item, wrong count, or a better remark).
 * Rewrites the line then recomputes both the old and the new item's stock, so
 * re-pointing a line at a different item puts the old item's units back.
 */
export async function updateTransactionLine(
  lineId: string,
  patch: { itemId?: string; quantity?: number; remarks?: string },
): Promise<void> {
  await prisma.$transaction(async (db) => {
    const line = await db.transactionLine.findUnique({
      where: { id: lineId },
      include: { transaction: true },
    });
    if (!line) throw new Error('Line not found');

    const previousItemId = line.itemId;
    const nextItemId = patch.itemId ?? line.itemId;
    const nextQuantity = patch.quantity ?? line.quantity;
    if (nextQuantity <= 0) throw new Error('Quantity must be at least 1');

    await db.transactionLine.update({
      where: { id: lineId },
      data: {
        itemId: nextItemId,
        quantity: nextQuantity,
        delta: deltaFor(line.transaction.action as Action, nextQuantity),
        remarks: patch.remarks ?? line.remarks,
        matchStatus: 'CORRECTED',
      },
    });

    const storeroomId = line.transaction.storeroomId;
    await recomputeStock(db, previousItemId, storeroomId);
    if (nextItemId !== previousItemId) await recomputeStock(db, nextItemId, storeroomId);
  });
}

/** Reverse a transaction wholesale. The rows stay for audit; the stock returns. */
export async function voidTransaction(transactionId: string): Promise<void> {
  await prisma.$transaction(async (db) => {
    await db.transaction.update({ where: { id: transactionId }, data: { voided: true } });
    await recomputeForTransaction(db, transactionId);
  });
}

/** Remove a single line from a committed transaction (e.g. the model hallucinated a row). */
export async function deleteTransactionLine(lineId: string): Promise<void> {
  await prisma.$transaction(async (db) => {
    const line = await db.transactionLine.findUnique({
      where: { id: lineId },
      include: { transaction: true },
    });
    if (!line) return;
    await db.transactionLine.delete({ where: { id: lineId } });
    await recomputeStock(db, line.itemId, line.transaction.storeroomId);
  });
}
