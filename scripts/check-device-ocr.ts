/**
 * Runs the FREE on-device reader over every fixture in fixtures/notes/ and scores it
 * against fixtures/notes/expected.json.
 *
 *   npm run ocr:device
 *   npm run ocr:device -- fixtures/notes/messy-mixed.png
 *   npm run ocr:device -- ~/Desktop/photo-of-my-note.jpg
 *
 * No API key, no database, no network: the same Tesseract LSTM engine the phone runs,
 * the same line tidying, the same text parser and the same catalogue matcher. This is
 * the check that tells you whether the free route actually reads handwriting.
 *
 * Two honest differences from the phone:
 *
 *  - No preprocessing. The greyscale, contrast stretch and adaptive threshold in
 *    `lib/ocr/device.ts` need a canvas, so they only run in the browser. On these clean
 *    fixtures that costs nothing; on a real photo with a shadow across it, the phone does
 *    better than this script, not worse.
 *  - No check step. On the phone someone reads the text back and fixes a letter before
 *    anything is created. This scores the raw read, which is the floor.
 *
 * Point it at photos of your own handwriting before trusting any number here. The
 * bundled fixtures are rendered with handwriting typefaces on a paper background - real
 * biro on creased paper under a ward light is harder.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorker, OEM, PSM, type Page } from 'tesseract.js';
import { CATALOGUE } from '@/lib/catalogue';
import { parseWrittenList } from '@/lib/ocr/parse-text';
import { applyDeviceReading, tidyReadLine, assembleReadText, type DeviceLine } from '@/lib/ocr/device-text';
import type { CatalogueEntry } from '@/lib/ocr/types';

/** Where the unpacked language model is kept. `.data/` is already gitignored. */
const CACHE = '.data/tesseract';

type Expected = {
  notes: {
    file: string;
    description: string;
    expectedAction: 'withdraw' | 'dispose';
    expectedLines: { sku: string; quantity: number | null; needsReview?: boolean }[];
  }[];
};

// No database here, so the SKU is the identity - the same trick /api/read uses.
const catalogue: CatalogueEntry[] = CATALOGUE.map((item) => ({
  id: item.sku,
  sku: item.sku,
  name: item.name,
  unit: item.unit,
  aliases: item.aliases,
}));

/**
 * The same shape `lib/ocr/device.ts` produces in the browser, minus the geometry.
 *
 * Boxes are normalised against the canvas the browser prepared, and there is no canvas
 * here. They only drive the review overlay, so leaving them out costs this script
 * nothing: what it is scoring is the words, the quantities and the matching.
 */
function toLines(page: Page): { lines: DeviceLine[]; confidence: number } {
  const lines: DeviceLine[] = [];
  let sum = 0;

  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = tidyReadLine(
          (line.words ?? []).map((word) => ({ text: word.text ?? '', confidence: (word.confidence ?? 0) / 100 })),
        );
        if (!text) continue;

        const confidence = Math.max(0, Math.min(1, (line.confidence ?? 0) / 100));
        sum += confidence;
        lines.push({ text, confidence, bbox: null });
      }
    }
  }

  return { lines, confidence: lines.length ? sum / lines.length : 0 };
}

async function main() {
  const expected: Expected = JSON.parse(await readFile('fixtures/notes/expected.json', 'utf8'));
  const argv = process.argv.slice(2);

  // An explicit path runs ad hoc (no ground truth); no args runs the whole fixture set.
  const targets = argv.length
    ? argv.map((file) => ({ file, spec: expected.notes.find((n) => n.file === path.basename(file)) }))
    : expected.notes.map((n) => ({ file: path.join('fixtures/notes', n.file), spec: n }));

  // The engine unpacks the language model next to the cache path, and its default is the
  // working directory - which drops an 11MB eng.traineddata in the repo root.
  await mkdir(CACHE, { recursive: true });

  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    // The same model the browser gets, read straight out of node_modules.
    langPath: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int',
    cachePath: CACHE,
    gzip: true,
    logger: () => undefined,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });

  console.log(`\nReading ${targets.length} note(s) on-device (tesseract LSTM, eng)\n${'='.repeat(64)}`);

  let checks = 0;
  let passed = 0;

  for (const { file, spec } of targets) {
    console.log(`\n${path.basename(file)}`);
    if (spec) console.log(`  ${spec.description}`);

    const started = Date.now();
    const { data } = await worker.recognize(await readFile(file), {}, { text: true, blocks: true });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const read = toLines(data);
    const text = assembleReadText(read.lines);
    const parsed = parseWrittenList(text, catalogue);
    const resolved = applyDeviceReading(parsed.lines, read.lines);

    console.log(`  read in ${seconds}s · mean confidence ${Math.round(read.confidence * 100)}%`);
    console.log(`  transcript:\n${text.split('\n').map((l) => `    | ${l}`).join('\n')}`);
    console.log(`  action="${parsed.action ?? 'unknown'}" (evidence: "${parsed.actionEvidence}")`);
    console.log('  lines:');
    for (const row of resolved) {
      console.log(
        `    "${row.rawText}" -> ${row.itemId ?? 'UNMATCHED'} x${row.quantity || '?'} ` +
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
    record(
      `action is "${spec.expectedAction}"`,
      (parsed.action ?? '').toLowerCase() === spec.expectedAction,
      `got "${parsed.action ?? 'unknown'}"`,
    );

    for (const want of spec.expectedLines) {
      const got = resolved.find((r) => r.itemId === want.sku);
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

  await worker.terminate();

  console.log(`\n${'='.repeat(64)}`);
  if (checks === 0) {
    console.log('Ad hoc run - no ground truth to score against. Read the lines above yourself.\n');
  } else {
    console.log(`${passed}/${checks} checks passed.\n`);
    if (passed < checks) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
