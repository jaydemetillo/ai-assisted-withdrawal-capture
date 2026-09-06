/**
 * Runs the REAL claude-opus-5 vision pipeline over every fixture in fixtures/notes/
 * and scores it against fixtures/notes/expected.json.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run ocr:check
 *   ANTHROPIC_API_KEY=sk-... npm run ocr:check -- fixtures/notes/messy-mixed.png
 *   ANTHROPIC_API_KEY=sk-... npm run ocr:check -- ~/Desktop/my-real-note.jpg
 *
 * This is the check that tells you whether handwriting reading actually works for your
 * handwriting, your paper and your lighting - the fixtures are a floor, not a ceiling.
 * Point it at photos of your own notes before trusting any accuracy number.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { readHandwriting, hasApiKey, OCR_MODEL } from '@/lib/ocr/claude';
import { resolveLines } from '@/lib/ocr/match';
import { safeAliases } from '@/lib/ocr';
import type { CatalogueEntry } from '@/lib/ocr/types';

type Expected = {
  notes: {
    file: string;
    description: string;
    expectedAction: 'withdraw' | 'dispose';
    expectedLines: { sku: string; quantity: number | null; needsReview?: boolean }[];
  }[];
};

const prisma = new PrismaClient();

function mediaTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function main() {
  if (!hasApiKey()) {
    console.error(
      '\nANTHROPIC_API_KEY is not set.\n\n' +
        'This script deliberately does NOT fall back to the demo fixtures - a green run\n' +
        'against canned data would tell you nothing about real handwriting.\n\n' +
        '  ANTHROPIC_API_KEY=sk-... npm run ocr:check\n',
    );
    process.exitCode = 1;
    return;
  }

  const items = await prisma.item.findMany({ orderBy: { name: 'asc' } });
  if (items.length === 0) throw new Error('No catalogue. Run `npm run setup` first.');

  const catalogue: CatalogueEntry[] = items.map((i) => ({
    id: i.id, sku: i.sku, name: i.name, unit: i.unit, aliases: safeAliases(i.aliases),
  }));
  const skuById = new Map(catalogue.map((c) => [c.id, c.sku]));

  const expected: Expected = JSON.parse(await readFile('fixtures/notes/expected.json', 'utf8'));
  const argv = process.argv.slice(2);

  // An explicit path runs ad hoc (no ground truth); no args runs the whole fixture set.
  const targets = argv.length
    ? argv.map((file) => ({ file, spec: expected.notes.find((n) => n.file === path.basename(file)) }))
    : expected.notes.map((n) => ({ file: path.join('fixtures/notes', n.file), spec: n }));

  console.log(`\nReading ${targets.length} note(s) with ${OCR_MODEL}\n${'='.repeat(60)}`);

  let checks = 0;
  let passed = 0;

  for (const { file, spec } of targets) {
    console.log(`\n${path.basename(file)}`);
    if (spec) console.log(`  ${spec.description}`);

    const started = Date.now();
    let outcome;
    try {
      outcome = await readHandwriting(await readFile(file), mediaTypeOf(file), catalogue, 'S15 Medical');
    } catch (error) {
      console.log(`  ERROR  ${error instanceof Error ? error.message : String(error)}`);
      checks++;
      continue;
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const resolved = resolveLines(outcome.result.lines, catalogue);
    console.log(`  read in ${seconds}s · action="${outcome.result.documentAction}" (evidence: "${outcome.result.actionEvidence}")`);
    console.log('  lines:');
    for (const row of resolved) {
      const sku = row.itemId ? skuById.get(row.itemId) : null;
      console.log(
        `    "${row.rawText}" -> ${sku ?? 'UNMATCHED'} x${row.quantity || '?'} ` +
          `(${Math.round(row.confidence * 100)}%${row.needsReview ? ', needs review' : ''})`,
      );
    }

    if (!spec) continue;

    const record = (label: string, ok: boolean, detail = '') => {
      checks++;
      if (ok) passed++;
      console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` - ${detail}`}`);
    };

    console.log('  checks:');
    record(`action is "${spec.expectedAction}"`, outcome.result.documentAction === spec.expectedAction, `got "${outcome.result.documentAction}"`);
    record(`${spec.expectedLines.length} line(s) found`, resolved.length === spec.expectedLines.length, `got ${resolved.length}`);

    for (const want of spec.expectedLines) {
      const got = resolved.find((r) => r.itemId && skuById.get(r.itemId) === want.sku);
      if (!got) {
        record(`${want.sku} matched`, false, 'not found in the read');
        continue;
      }
      if (want.quantity === null) {
        record(`${want.sku} quantity left for a human`, got.needsReview, 'was auto-accepted instead of flagged');
      } else {
        record(`${want.sku} quantity ${want.quantity}`, got.quantity === want.quantity, `got ${got.quantity}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (checks === 0) {
    console.log('Ad hoc run - no ground truth to score against. Read the lines above yourself.\n');
  } else {
    console.log(`${passed}/${checks} checks passed.\n`);
    if (passed < checks) process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
