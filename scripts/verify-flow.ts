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

  // The free route: the phone reads the photo itself and uploads the words with it. No
  // key, no model call, and the capture that comes out has to be indistinguishable from
  // any other - a real photo attached, real geometry on the rows, real stock movement.
  // This posts what the browser posts; `npm run ocr:device` is what checks the reading.
  console.log('\n8. The same photo, read on the device instead');
  const gaugeBefore = await stockOf('GAUZE-10', storeroom.id);
  const deviceForm = new FormData();
  deviceForm.append('photo', new File([new Uint8Array(photo)], 'withdraw-basic.png', { type: 'image/png' }));
  deviceForm.append('reason', 'FORGOT_TO_RECORD');
  deviceForm.append('text', '12 x Gauze pads\n2 x Foley catheter 16Fr\nWithdrawn');
  deviceForm.append(
    'read',
    JSON.stringify([
      { text: '12 x Gauze pads', confidence: 0.92, bbox: [120, 130, 430, 175] },
      { text: '2 x Foley catheter 16Fr', confidence: 0.61, bbox: [120, 185, 450, 230] },
    ]),
  );
  deviceForm.append('engine', 'tesseract-lstm-eng (on device)');

  const onDevice = await fetch(`${BASE}/api/captures`, { method: 'POST', body: deviceForm });
  const deviceCapture = (await onDevice.json()) as { id?: string; provider?: string; error?: string };
  if (!deviceCapture.id) throw new Error(`On-device upload failed: ${deviceCapture.error}`);
  check('recorded as read on the device, not by a model', deviceCapture.provider, 'device');

  const deviceDraft = await prisma.capture.findUniqueOrThrow({
    where: { id: deviceCapture.id },
    include: { lines: { include: { item: true } } },
  });
  const gauze = deviceDraft.lines.find((l) => l.item?.sku === 'GAUZE-10');
  const foley = deviceDraft.lines.find((l) => l.item?.sku === 'FOLEY-16');
  for (const line of deviceDraft.lines) {
    console.log(
      `   "${line.rawText}" -> ${line.item?.name ?? 'UNMATCHED'} x${line.quantity} ` +
        `(${Math.round(line.confidence * 100)}%${line.needsReview ? ', needs review' : ''}) box=${line.bbox}`,
    );
  }
  check('the photo is still kept as evidence', deviceDraft.photoPath.length > 0, true);
  check('"Withdrawn" on the page set the action', deviceDraft.action, 'WITHDRAW');
  check('12 x Gauze pads matched the catalogue', gauze?.quantity, 12);
  check("the engine's box came through onto the row", JSON.parse(gauze?.bbox ?? 'null'), [120, 130, 430, 175]);
  check('a line the engine half-read is flagged for a human', foley?.needsReview, true);

  const deviceCommit = await fetch(`${BASE}/api/captures/${deviceCapture.id}/commit`, { method: 'POST' });
  if (!deviceCommit.ok) throw new Error('On-device commit failed');
  check('stock moved on a read that cost nothing', await stockOf('GAUZE-10', storeroom.id), gaugeBefore - 12);

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
