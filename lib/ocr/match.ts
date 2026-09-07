import type { CatalogueEntry, OcrLine, ResolvedLine } from '@/lib/ocr/types';
import { REVIEW_CONFIDENCE_THRESHOLD } from '@/lib/constants';

/** Lowercase, strip punctuation, collapse whitespace. "Gloves (M)" -> "gloves m". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): string[] {
  const s = ` ${value} `;
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * Sørensen-Dice similarity over character bigrams. Chosen over Levenshtein because it
 * copes better with the way people actually abbreviate ("foly cath" vs "foley catheter"):
 * it rewards shared chunks and does not punish missing letters as harshly.
 */
export function similarity(a: string, b: string): number {
  const [x, y] = [normalize(a), normalize(b)];
  if (!x || !y) return 0;
  if (x === y) return 1;

  const bx = bigrams(x);
  const by = bigrams(y);
  const pool = new Map<string, number>();
  for (const g of bx) pool.set(g, (pool.get(g) ?? 0) + 1);

  let hits = 0;
  for (const g of by) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hits++;
      pool.set(g, n - 1);
    }
  }
  return (2 * hits) / (bx.length + by.length);
}

/** True when `word` appears in `text` bounded by spaces or the ends of the string. */
function isWholeWord(text: string, word: string): boolean {
  return ` ${text} `.includes(` ${word} `);
}

export type MatchResult = { entry: CatalogueEntry; score: number } | null;

/**
 * Best catalogue match for a scrap of written text.
 *
 * Exact alias hits win outright - that is the whole reason aliases exist - and only then
 * do we fall back to fuzzy scoring against the name and every alias. Anything under
 * `threshold` returns null rather than a bad guess: a wrong item silently moving stock is
 * far worse than a line the user has to tap once to fix.
 */
export function matchItem(text: string, catalogue: CatalogueEntry[], threshold = 0.55): MatchResult {
  const needle = normalize(text);
  if (!needle) return null;

  for (const entry of catalogue) {
    if (normalize(entry.name) === needle) return { entry, score: 1 };
    if (entry.aliases.some((a) => normalize(a) === needle)) return { entry, score: 1 };
  }

  let best: MatchResult = null;
  for (const entry of catalogue) {
    let score = similarity(needle, entry.name);
    for (const alias of entry.aliases) {
      const normalized = normalize(alias);
      score = Math.max(score, similarity(needle, alias));

      // "gloves m x 2 boxes" contains the alias outright - reward that.
      if (normalized.length >= 4 && needle.includes(normalized)) {
        score = Math.max(score, 0.9);
      }

      // Short aliases are the domain's own shorthand - "ns", "d5", "n95" - and a plain
      // substring test would fire on any word containing those letters. Matching them as
      // WHOLE WORDS keeps the signal and drops the false positives: "ns 500ml" hits,
      // "sensor" does not.
      if (normalized.length < 4 && normalized && isWholeWord(needle, normalized)) {
        score = Math.max(score, 0.9);
      }
    }
    if (!best || score > best.score) best = { entry, score };
  }

  return best && best.score >= threshold ? best : null;
}

function clampBox(bbox: number[] | undefined | null): [number, number, number, number] | null {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => typeof n !== 'number' || !isFinite(n))) {
    return null;
  }
  const [x0, y0, x1, y1] = bbox.map((n) => Math.max(0, Math.min(1000, n)));
  // A zero-area or inverted box would render as an invisible chip; drop it instead.
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1, y1];
}

/**
 * Turn raw model lines into rows the review screen can render.
 *
 * A line needs review when the model was unsure, when we had to fall back to fuzzy
 * matching, when no item matched, or when the quantity was unreadable. Those are exactly
 * the rows the review screen highlights in amber.
 */
export function resolveLines(lines: OcrLine[], catalogue: CatalogueEntry[]): ResolvedLine[] {
  const bySku = new Map(catalogue.map((c) => [c.sku.toUpperCase(), c]));

  return lines.map((line) => {
    let itemId: string | null = null;
    let matchSource: ResolvedLine['matchSource'] = 'NONE';
    let confidence = Number.isFinite(line.confidence) ? Math.max(0, Math.min(1, line.confidence)) : 0;

    const direct = line.sku ? bySku.get(line.sku.toUpperCase()) : undefined;
    if (direct) {
      itemId = direct.id;
      matchSource = 'MODEL';
    } else {
      const fuzzy = matchItem(line.itemGuess || line.rawText, catalogue);
      if (fuzzy) {
        itemId = fuzzy.entry.id;
        matchSource = 'FUZZY';
        // We resolved it ourselves rather than the model naming a SKU, so the line is
        // only as trustworthy as the weaker of the two signals.
        confidence = Math.min(confidence, fuzzy.score);
      }
    }

    const quantity = typeof line.quantity === 'number' && line.quantity > 0 ? Math.round(line.quantity) : 0;

    return {
      rawText: line.rawText,
      itemId,
      itemGuess: line.itemGuess || line.rawText,
      quantity,
      confidence,
      needsReview: !itemId || quantity <= 0 || confidence < REVIEW_CONFIDENCE_THRESHOLD,
      bbox: clampBox(line.bbox),
      matchSource,
    };
  });
}
