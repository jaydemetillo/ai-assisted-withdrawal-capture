/**
 * End-to-end check of the thing this prototype claims to do:
 * photograph a written list -> read it -> confirm it -> stock actually moves.
 *
 * Run against a server that is already up:  npm run verify
 * Uses the offline fixtures unless ANTHROPIC_API_KEY is set, in which case it exercises
 * the real vision call.
 */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:3000';
const prisma = new PrismaClient();

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${ok ? ` = ${JSON.stringify(actual)}` : `\n         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function stockOf(sku: string, storeroomId: string) {
  const item = await prisma.item.findUniqueOrThrow({ where: { sku } });
  const level = await prisma.stockLevel.findUniqueOrThrow({
    where: { itemId_storeroomId: { itemId: item.id, storeroomId } },
  });
  return level.quantity;
}

async function main() {
  const storeroom = await prisma.storeroom.findFirstOrThrow({ orderBy: { code: 'asc' } });

  console.log('\n1. Stock before');
  const before = {
    masks: await stockOf('MASK-L2', storeroom.id),
    syringes: await stockOf('SYR-10ML', storeroom.id),
    saline: await stockOf('SAL-09-500', storeroom.id),
  };
  console.log(`   masks=${before.masks} syringes=${before.syringes} saline=${before.saline}`);

  console.log('\n2. Upload the handwritten note');
  const photo = await readFile('fixtures/notes/withdraw-basic.png');
  const form = new FormData();
  form.append('photo', new File([new Uint8Array(photo)], 'withdraw-basic.png', { type: 'image/png' }));
  form.append('reason', 'EMERGENCY');
  form.append('sample', 'withdraw-basic');

  const uploaded = await fetch(`${BASE}/api/captures`, { method: 'POST', body: form });
  const capture = (await uploaded.json()) as { id?: string; actionInferred?: string; provider?: string; error?: string };
  if (!capture.id) throw new Error(`Upload failed: ${capture.error}`);
  console.log(`   capture ${capture.id} (read by: ${capture.provider})`);
  check('action inferred from the words on the page', capture.actionInferred, 'withdraw');

  console.log('\n3. What was read');
  const draft = await prisma.capture.findUniqueOrThrow({
    where: { id: capture.id },
    include: { lines: { include: { item: true } } },
  });
  for (const line of draft.lines) {
    console.log(`   "${line.rawText}" -> ${line.item?.name ?? 'UNMATCHED'} x${line.quantity} (${Math.round(line.confidence * 100)}%)`);
  }
  check('lines parsed', draft.lines.length, 3);
  check('every line matched an item', draft.lines.every((l) => l.itemId), true);
  check('stock has NOT moved yet (still a draft)', await stockOf('MASK-L2', storeroom.id), before.masks);

  console.log('\n4. Confirm it');
  const committed = await fetch(`${BASE}/api/captures/${capture.id}/commit`, { method: 'POST' });
  const result = (await committed.json()) as { transactionId?: string; reference?: string; error?: string };
  if (!result.transactionId) throw new Error(`Commit failed: ${result.error}`);
  console.log(`   transaction ${result.reference}`);

  console.log('\n5. Stock after');
  check('masks 130 -> 127', await stockOf('MASK-L2', storeroom.id), before.masks - 3);
  check('syringes -4', await stockOf('SYR-10ML', storeroom.id), before.syringes - 4);
  check('saline -5', await stockOf('SAL-09-500', storeroom.id), before.saline - 5);

  console.log('\n6. Admin corrects a miscount (3 masks -> 5)');
  const tx = await prisma.transaction.findUniqueOrThrow({
    where: { id: result.transactionId },
    include: { lines: { include: { item: true } } },
  });
  const maskLine = tx.lines.find((l) => l.item.sku === 'MASK-L2')!;
  const corrected = await fetch(`${BASE}/api/transactions/${tx.id}/lines/${maskLine.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 5 }),
  });
  if (!corrected.ok) throw new Error('Correction failed');
  check('stock recomputed from the ledger, not patched', await stockOf('MASK-L2', storeroom.id), before.masks - 5);

  console.log('\n7. Re-submitting the same capture is refused');
  const again = await fetch(`${BASE}/api/captures/${capture.id}/commit`, { method: 'POST' });
  check('second commit rejected', again.status, 400);

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
