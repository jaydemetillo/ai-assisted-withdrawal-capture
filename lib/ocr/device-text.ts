import type { ResolvedLine } from '@/lib/ocr/types';
import { normalize, similarity } from '@/lib/ocr/match';
import { REVIEW_CONFIDENCE_THRESHOLD } from '@/lib/constants';

/**
 * Turning a raw on-device reading into something the ledger can accept.
 *
 * These functions are deliberately free of both the browser and the database: the
 * engine runs in a WebWorker on the phone (`lib/ocr/device.ts`), the parsing runs on the
 * server (`app/api/captures`), and everything either side needs to agree about lives
 * here where it can be unit-tested without a camera.
 */

/** One word as the engine saw it. `confidence` is 0-1. */
export type ReadWord = { text: string; confidence: number };

/** One line of a finished reading. `bbox` is [x0,y0,x1,y1] on a 0-1000 canvas. */
export type DeviceLine = {
  text: string;
  confidence: number;
  bbox: [number, number, number, number] | null;
};

export type DeviceReading = {
  /** Which engine and model produced this, for the audit trail. */
  engine: string;
  /** The whole note as text, one line per line. */
  text: string;
  lines: DeviceLine[];
  /** Mean line confidence, 0-1. Used to decide whether a second pass is worth it. */
  confidence: number;
};

/**
 * Punctuation the engine is allowed to keep on its own.
 *
 * Everything else non-alphanumeric that comes back as a standalone word is paper
 * texture, a biro smudge or the edge of the page read as a character - the `|` and `i`
 * that turn up at the end of a line. The separators here are load-bearing instead:
 * `Syringe 10ml - 8` and `NS 500ml ... 3` both put the quantity behind one of them.
 */
const MEANINGFUL_MARKS = new Set(['-', '–', '—', ':', '.', '..', '...', '…', '/', '(', ')', '%', '?', '??', '???', '*']);

/**
 * Build one line of text out of the words the engine returned, dropping the noise.
 *
 * The rules only ever DROP characters, and only ones the engine itself was unsure
 * about - nothing here invents or corrects a character, because a plausible-looking
 * guess is exactly what makes a wrong number believable.
 *
 *  - A standalone mark that is not a separator is noise. `DISPOSED - expired batch |`
 *    becomes `DISPOSED - expired batch`.
 *  - A lone character the engine doubted, anywhere but the start of the line, is noise
 *    too. This is the one that matters: a stray `5` at the end of `3x Masks` would
 *    otherwise be read as the quantity and quietly withdraw five of something. At the
 *    start of a line a single character is usually the quantity, so it stays.
 */
export function tidyReadLine(words: ReadWord[], doubtBelow = 0.6): string {
  const kept: string[] = [];

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;

    const alphanumeric = /[a-z0-9]/i.test(text);
    if (!alphanumeric) {
      if (MEANINGFUL_MARKS.has(text)) kept.push(text);
      continue;
    }
    if (text.length === 1 && kept.length > 0 && word.confidence < doubtBelow) continue;

    kept.push(text);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Whether a line looks like a row of a stock list rather than a heading or a signature.
 *
 * Used only to tell someone how much was found before they submit, so it has to agree
 * with the shapes `extractQuantity` actually recognises. Counting "any line with a digit
 * in it" was worse than saying nothing: it claimed four items on a note with three,
 * because `Ward 411 - S15 Medical` has digits in it.
 */
export function looksLikeAnItemLine(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  return (
    /^\d+\s*[x×]?\s*\S/i.test(text) || // 3x Masks, 3 Masks
    /[x×]\s*\d+\s*[a-z]*\.?$/i.test(text) || // Masks x 3, Gloves x 2 boxes
    /[-–—:.]{1,8}\s*\d+\s*$/.test(text) || // Syringe 10ml - 8, NS 500ml ... 3
    /^\?+/.test(text) // ?? x biohazard bags
  );
}

/** Assemble the note text the person will check, one line per recognised line. */
export function assembleReadText(lines: { text: string }[]): string {
  return lines
    .map((line) => line.text.trim())
    .filter((text) => text.length > 0)
    .join('\n');
}

/**
 * Put the geometry and the engine's own doubt back onto lines that have been parsed.
 *
 * `parseWrittenList` works on text alone, so it produces a row whose confidence only
 * reflects how well the words matched the catalogue. For a photographed note that is
 * half the story: the other half is how sure the engine was that those were the words.
 * A row is only as trustworthy as the weaker of the two, and rows below the review
 * threshold are the ones the review screen puts in amber.
 *
 * Matching is by text, not by position, because the person can edit what was read
 * before submitting. A line they retyped keeps its parse and loses its box - which is
 * right: the box described handwriting that is no longer what the row says.
 */
export function applyDeviceReading(parsed: ResolvedLine[], read: DeviceLine[]): ResolvedLine[] {
  const taken = new Set<number>();

  return parsed.map((row) => {
    const wanted = normalize(row.rawText);
    let bestIndex = -1;
    // Below this the two lines are not the same line. It has to be this loose because
    // the lines are short: correcting one letter of "3x Maske" costs about a tenth of
    // the score, and that correction is the whole point of the check step. Two genuinely
    // different rows on a stock list score far lower than this - "3x Masks" against
    // "3x Saline" is 0.32.
    let bestScore = 0.65;

    for (let i = 0; i < read.length; i++) {
      if (taken.has(i)) continue;
      const score = similarity(wanted, read[i].text);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) return row;
    taken.add(bestIndex);

    const source = read[bestIndex];
    const confidence = Math.min(row.confidence, source.confidence);
    return {
      ...row,
      confidence,
      bbox: source.bbox,
      needsReview: !row.itemId || row.quantity <= 0 || confidence < REVIEW_CONFIDENCE_THRESHOLD,
    };
  });
}

/** Narrow whatever arrived over the wire as a device reading. Nothing here is trusted. */
export function parseDeviceLines(raw: unknown): DeviceLine[] {
  if (!Array.isArray(raw)) return [];

  const lines: DeviceLine[] = [];
  for (const entry of raw.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const { text, confidence, bbox } = entry as Record<string, unknown>;
    if (typeof text !== 'string' || !text.trim()) continue;

    lines.push({
      text: text.slice(0, 500),
      confidence: typeof confidence === 'number' && isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      bbox: parseBox(bbox),
    });
  }
  return lines;
}

function parseBox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  if (!raw.every((n) => typeof n === 'number' && isFinite(n))) return null;
  const [x0, y0, x1, y1] = (raw as number[]).map((n) => Math.max(0, Math.min(1000, n)));
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1, y1];
}
