import type { CatalogueItem, LocationCatalogue } from '@/lib/domain/catalogue';
import { itemPhrase, matchTokens, normalize, phraseTokens, similarity } from '@/lib/catalogue/normalize';

/**
 * Deterministic catalogue matching.
 *
 * Two jobs, kept strictly apart:
 *
 *   matchPhrase()   — decides what the text DOES match. Exact and containment only.
 *                     Its result can make a line confirmable.
 *   suggestItems()  — offers a human some options when nothing matched. Fuzzy.
 *                     Its result can NEVER make a line confirmable.
 *
 * Mixing the two is the classic way these systems go wrong: a fuzzy score creeps into
 * the confirm path, and one day "20G" becomes "18G" because the letters mostly agreed.
 */

export type MatchKind = 'sku' | 'alias' | 'name' | 'contained' | 'described';

export type CatalogueMatch = {
  item: CatalogueItem;
  kind: MatchKind;
  /** The catalogue string that matched — shown to a reviewer so the hit is explicable. */
  matchedOn: string;
};

export type MatchOutcome = {
  /** The normalised item text the matching ran against, quantity removed. */
  phrase: string;
  /** Every item the phrase matches. More than one means ambiguous; zero means unmatched. */
  matches: CatalogueMatch[];
  /** Fuzzy near-misses to show a human. Never used to decide anything. */
  suggestions: CatalogueItem[];
};

/** Rank of each match kind, strongest first. Only used for presentation ordering. */
const KIND_RANK: Record<MatchKind, number> = { sku: 0, alias: 1, name: 2, contained: 3, described: 4 };

/**
 * Does `phrase` match `item`?
 *
 * Exact SKU, exact approved alias, and exact display name are the strong forms. The
 * fourth — every token of the phrase appearing within one single catalogue string — is
 * what makes real handwriting work ("blue cannula" for "IV cannula 22G (blue)") and,
 * just as importantly, what makes ambiguity visible: the same phrase matches every blue
 * cannula in the catalogue, so the rules can refuse it.
 *
 * Tokens must all appear in ONE string. Collecting them across several aliases would let
 * "blue" from one and "cannula" from another combine into a match nobody wrote.
 */
function matchAgainstItem(phrase: string, item: CatalogueItem, prose = false): CatalogueMatch | null {
  if (!phrase) return null;

  if (normalize(item.sku) === phrase) return { item, kind: 'sku', matchedOn: item.sku };

  for (const alias of item.aliases) {
    if (normalize(alias) === phrase) return { item, kind: 'alias', matchedOn: alias };
  }

  if (normalize(item.displayName) === phrase) {
    return { item, kind: 'name', matchedOn: item.displayName };
  }

  // Plurals folded on both sides so "4x syringes" finds "Syringe 10 mL luer lock", and
  // bare counts dropped from the written side so "3 masks" is not defeated by the "3".
  // The catalogue keeps every token it has; only the handwriting is treated leniently.
  const written = phraseTokens(phrase);
  if (written.length === 0) return null;

  for (const candidate of [item.displayName, ...item.aliases]) {
    const haystack = new Set(matchTokens(candidate));
    if (written.every((t) => haystack.has(t))) {
      return { item, kind: 'contained', matchedOn: candidate };
    }
  }

  // Prose runs the containment the other way round.
  //
  // Handwriting is terse — "3x mask" — so we ask whether every written word appears in a
  // catalogue entry. A description of a photograph is a sentence: "blue pleated surgical
  // mask with ear loops". Words like "pleated" and "loops" are never in a catalogue, so
  // the forward test fails on an item that is plainly visible.
  //
  // So for prose we ask instead: does a catalogue entry appear IN the description?
  // "surgical mask" is contained in that sentence, and that is the match.
  //
  // Only used for visual identifications, which can never be `eligible` (rule 8b) — so
  // the worst a loose match can do is put a wrong suggestion in front of a human, never
  // move stock. Entries of a single word are skipped: "pads" or "bvm" would fire on
  // almost any sentence.
  if (prose) {
    const described = new Set(written);
    for (const candidate of [item.displayName, ...item.aliases]) {
      const entry = matchTokens(candidate);
      if (entry.length < 2) continue;
      if (entry.every((t) => described.has(t))) {
        return { item, kind: 'described', matchedOn: candidate };
      }
    }
  }

  return null;
}

/**
 * Every catalogue item the written text matches.
 *
 * Inactive items are excluded: they are no longer stocked, so a phrase matching one is
 * a phrase matching nothing the nurse could have taken.
 */
export function matchPhrase(
  rawText: string,
  catalogue: LocationCatalogue,
  options: { prose?: boolean } = {},
): MatchOutcome {
  const phrase = itemPhrase(rawText);

  const matches: CatalogueMatch[] = [];
  for (const item of catalogue.items) {
    if (!item.isActive) continue;
    const hit = matchAgainstItem(phrase, item, options.prose);
    if (hit) matches.push(hit);
  }

  // Strongest kind first, then closest by text. Ordering is presentation only — it
  // decides which button a nurse sees first, never which item is correct.
  // Compared against `matchedOn` — the catalogue string that actually produced the hit,
  // which is usually an alias rather than the formal display name. "saline" is close to
  // the alias "saline flush"; it is nothing like "Sodium chloride 0.9% flush 10 mL".
  matches.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      similarity(phrase, b.matchedOn) - similarity(phrase, a.matchedOn) ||
      a.item.sku.localeCompare(b.item.sku),
  );

  return {
    phrase,
    matches,
    suggestions: matches.length === 0 ? suggestItems(phrase, catalogue) : [],
  };
}

/**
 * Fuzzy near-misses, strongest first, for a human to choose from.
 *
 * SUGGESTIONS ONLY. Nothing in lib/decision reads this to reach `eligible`; it exists so
 * a "Cannot identify" line can offer three plausible buttons instead of a dead end.
 */
export function suggestItems(rawText: string, catalogue: LocationCatalogue, limit = 3): CatalogueItem[] {
  const phrase = itemPhrase(rawText);
  if (!phrase) return [];

  const scored = catalogue.items
    .filter((item) => item.isActive)
    .map((item) => {
      let score = similarity(phrase, item.displayName);
      for (const alias of item.aliases) score = Math.max(score, similarity(phrase, alias));
      return { item, score };
    })
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.item.sku.localeCompare(b.item.sku));

  return scored.slice(0, limit).map((s) => s.item);
}

/** Distinct items in a match list — the same item matched two ways is still one item. */
export function distinctMatchedItems(matches: CatalogueMatch[]): CatalogueItem[] {
  const seen = new Map<string, CatalogueItem>();
  for (const m of matches) if (!seen.has(m.item.id)) seen.set(m.item.id, m.item);
  return [...seen.values()];
}
