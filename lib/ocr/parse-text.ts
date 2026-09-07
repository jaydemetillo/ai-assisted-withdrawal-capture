import type { CatalogueEntry, ResolvedLine } from '@/lib/ocr/types';
import { matchItem } from '@/lib/ocr/match';
import type { Action } from '@/lib/constants';

/**
 * Turn a written list that is ALREADY TEXT into matched line items - no model involved.
 *
 * This exists because the phone can usually do the hard part for free. iOS Live Text and
 * Android's Lens read handwriting off a photo natively; someone copies the text and
 * pastes it here, and the rest of the pipeline - matching, the review gate, the ledger -
 * runs exactly as it does for a vision read.
 *
 * It is also the right fallback when a photo is unreadable, when there is no signal, or
 * when someone would simply rather type. Deterministic, instant and free.
 */

/** Words that say what happened to the items. Checked against the whole note. */
const DISPOSE_WORDS = ['dispose', 'disposed', 'disposal', 'discard', 'discarded', 'expired', 'wasted', 'binned', 'damaged'];
const WITHDRAW_WORDS = ['withdraw', 'withdrawn', 'withdrawal', 'taken', 'took', 'used', 'issued', 'collected'];

export type ParsedList = {
  action: Action | null;
  actionEvidence: string;
  lines: ResolvedLine[];
};

/**
 * Pull the quantity out of one written line, in the shapes people actually use:
 *
 *   3x Masks          Masks x 3         3 Masks
 *   Syringe 10ml - 8  NS 500ml ..... 3  Gloves (M) x 2 boxes
 *
 * Returns the number plus the line with that number removed, so what remains can be
 * matched against the catalogue. `null` means a quantity was written but is unreadable
 * (a literal "??"), which must reach a human rather than be guessed.
 */
export function extractQuantity(line: string): { quantity: number | null; rest: string } {
  const t = line.trim();

  // Leading count: "3x Masks", "3 x Masks"
  let m = t.match(/^(\d+)\s*[x×]\s+(.*)$/i);
  if (m) return { quantity: Number(m[1]), rest: m[2] };

  // Leading count with no space: "3xMasks"
  m = t.match(/^(\d+)\s*[x×]([a-z].*)$/i);
  if (m) return { quantity: Number(m[1]), rest: m[2] };

  // Trailing count, optionally followed by a unit word that is NOT the quantity:
  // "Masks x 3", "Gloves (M) x 2 boxes", "ECG electrodes x10"
  m = t.match(/^(.*?)\s*[x×]\s*(\d+)\s*[a-z]*\.?$/i);
  if (m) return { quantity: Number(m[2]), rest: m[1] };

  // Count after a separator: "Syringe 10ml - 8", "NS 500ml ...... 3"
  m = t.match(/^(.*?)\s*[-–—:.]{1,8}\s*(\d+)\s*$/);
  if (m) return { quantity: Number(m[2]), rest: m[1] };

  // Bare leading count: "6 Alcohol swabs". The space matters, so "10ml" is not a count.
  m = t.match(/^(\d+)\s+([a-z].*)$/i);
  if (m) return { quantity: Number(m[1]), rest: m[2] };

  // The writer marked it unreadable themselves: "?? x biohazard bags"
  m = t.match(/^\?+\s*[x×]?\s*(.*)$/);
  if (m) return { quantity: null, rest: m[1] };

  return { quantity: null, rest: t };
}

export function detectAction(text: string): { action: Action | null; evidence: string } {
  const lower = text.toLowerCase();
  // Disposal first: "expired and withdrawn from the shelf" is a disposal.
  for (const word of DISPOSE_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return { action: 'DISPOSE', evidence: word };
  }
  for (const word of WITHDRAW_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return { action: 'WITHDRAW', evidence: word };
  }
  return { action: null, evidence: '' };
}

export function parseWrittenList(text: string, catalogue: CatalogueEntry[]): ParsedList {
  const { action, evidence } = detectAction(text);
  const lines: ResolvedLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const { quantity, rest } = extractQuantity(trimmed);
    const match = matchItem(rest, catalogue);

    // Neither a quantity nor a recognisable item: a heading, a signature, or prose.
    // Dropping these is what keeps "Withdrawn" and "- A. Rahman" out of the ledger.
    if (!match && quantity === null) continue;

    lines.push({
      rawText: trimmed,
      itemId: match ? match.entry.id : null,
      itemGuess: rest.trim() || trimmed,
      quantity: quantity ?? 0,
      // The text is exact, so the only thing left to be unsure about is which item.
      confidence: match ? match.score : 0,
      needsReview: !match || quantity === null || quantity <= 0,
      bbox: null,
      matchSource: match ? 'FUZZY' : 'NONE',
    });
  }

  return { action, actionEvidence: evidence, lines };
}
