import { DEFAULT_VISION_CONFIG, type VisionConfig } from '@/lib/vision/config';

/**
 * Nearest-neighbour recognition, and the hygiene rules that keep it honest.
 *
 * This module is PURE, for exactly the same reason lib/decision/rules.ts is: no
 * database, no clock, no randomness. `now` is a parameter. Give it the same query
 * vector and the same examples and it returns the same answer in CI, on a phone, and in
 * a reconstruction two years from now.
 *
 * ## What it will not do
 *
 * Nothing in here returns a decision. It returns evidence — "closest to these photos,
 * this far away, and here is what else was nearly as close". The rules decide, and for
 * visual evidence they always decide `needs_review`. Learning improves the SUGGESTION
 * and never the AUTHORITY, and keeping the two in separate modules is how that stays
 * true when somebody is in a hurry.
 *
 * ## Why nearest neighbour rather than a centroid
 *
 * An item's score is its single closest example, not the average of them. Averaging
 * punishes exactly the thing we want: an item with photos from four angles has a diffuse
 * centroid and scores worse than one with four near-identical photos, so the metric
 * would quietly reward a useless index. Nearest neighbour asks the right question — "has
 * anyone here photographed it looking like this before?"
 *
 * The cost is sensitivity to one bad example, which is why overrule tracking and the
 * quarantine rule below exist rather than being nice-to-haves.
 */

export type ReferenceVector = {
  id: string;
  itemId: string;
  vector: number[];
  timesAgreed: number;
  timesOverruled: number;
  createdAt: Date;
};

/** How strongly the index recognises something. Deliberately words, not a percentage. */
export type RecognitionStrength = 'none' | 'weak' | 'learning' | 'good';

export type VisualRecognition = {
  /** The best item, or null when nothing cleared the floor. */
  itemId: string | null;
  /** 0..1. For display bands only — never shown to a nurse as a number. */
  score: number;
  /** The examples behind the winning score, best first. Overrule tracking needs these. */
  matchedPhotoIds: string[];
  /** Active examples of the winning item at this location. */
  exampleCount: number;
  /** Times examples of the winning item were confirmed correct. Familiarity, not proof. */
  timesAgreed: number;
  /** The best OTHER item, if any. */
  runnerUpItemId: string | null;
  runnerUpScore: number;
  /** Other items too close to separate by sight. Non-empty means "I will always ask". */
  confusableWith: string[];
  strength: RecognitionStrength;
};

export const NO_RECOGNITION: VisualRecognition = {
  itemId: null,
  score: 0,
  matchedPhotoIds: [],
  exampleCount: 0,
  timesAgreed: 0,
  runnerUpItemId: null,
  runnerUpScore: 0,
  confusableWith: [],
  strength: 'none',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cosine similarity, clamped to 0..1.
 *
 * Vectors are stored unit-length so this could be a bare dot product, but the norms are
 * computed anyway: a vector that arrived from an older provider, a truncated column or a
 * hand-written test would otherwise score arbitrarily high for free. Mismatched lengths
 * are 0, not an exception — one malformed row must not take down a whole read.
 *
 * Negative similarity is clamped away because it carries no meaning here: "less alike
 * than unrelated" and "unrelated" are the same answer.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  const value = dot / Math.sqrt(na * nb);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * An example's weight, between 0 and 1.
 *
 * Age is the only thing that reduces it. A supplier changes the packaging, a ward is
 * refitted with different lighting, somebody switches phones — and the examples now
 * describe a world that has gone. **A stale example is worse than no example**, because
 * it still matches confidently and is now wrong, so old ones are quietly discounted and
 * flagged for a human to look at rather than trusted forever.
 *
 * Reinforcement deliberately does NOT raise the weight. Letting an example that has been
 * agreed with fourteen times score higher than a fresh one is confidence inflation: the
 * numbers rise because the item is common, not because the match is better, and the
 * system ends up looking more certain without being more correct.
 */
export function exampleWeight(
  example: Pick<ReferenceVector, 'createdAt'>,
  now: Date,
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): number {
  const ageDays = (now.getTime() - example.createdAt.getTime()) / DAY_MS;
  return ageDays > config.staleAfterDays ? config.staleWeight : 1;
}

/** True when an example has misled people often enough to stop being used. */
export function isMisleading(
  example: Pick<ReferenceVector, 'timesAgreed' | 'timesOverruled'>,
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): boolean {
  return example.timesOverruled >= config.overruleLimit && example.timesOverruled > example.timesAgreed;
}

type ItemScore = {
  itemId: string;
  score: number;
  photoIds: string[];
  exampleCount: number;
  timesAgreed: number;
};

/** Best score per item, strongest first. Exported because the health screen wants it too. */
export function scoreItems(
  query: number[],
  examples: ReferenceVector[],
  now: Date,
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): ItemScore[] {
  const byItem = new Map<string, { scored: { id: string; score: number }[]; agreed: number }>();

  for (const example of examples) {
    if (isMisleading(example, config)) continue;
    const score = cosine(query, example.vector) * exampleWeight(example, now, config);
    const entry = byItem.get(example.itemId) ?? { scored: [], agreed: 0 };
    entry.scored.push({ id: example.id, score });
    entry.agreed += example.timesAgreed;
    byItem.set(example.itemId, entry);
  }

  const scores: ItemScore[] = [];
  for (const [itemId, entry] of byItem) {
    entry.scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    scores.push({
      itemId,
      score: entry.scored[0]?.score ?? 0,
      photoIds: entry.scored.map((s) => s.id),
      exampleCount: entry.scored.length,
      timesAgreed: entry.agreed,
    });
  }

  // Ties broken by item id so the answer is stable across processes. Without it, two
  // equally-scoring items would order by hash iteration and the "same photo, same
  // answer" promise would quietly stop holding.
  scores.sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId));
  return scores;
}

/**
 * Recognise a photograph against one location's examples.
 *
 * `examples` must already be scoped to the location and to the active embedding model —
 * this function cannot check either, and mixing coordinate spaces produces scores that
 * look entirely reasonable and mean nothing.
 */
export function recognise(
  query: number[],
  examples: ReferenceVector[],
  now: Date,
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): VisualRecognition {
  if (query.length === 0 || examples.length === 0) return NO_RECOGNITION;

  const scores = scoreItems(query, examples, now, config);
  const best = scores[0];
  if (!best || best.score < config.matchFloor) return NO_RECOGNITION;

  const runnerUp = scores[1] ?? null;

  // Everything within the margin of the winner. A non-empty list is the honest answer to
  // "which of these two is it?": both, as far as a photograph can tell.
  const confusableWith = scores
    .slice(1)
    .filter((s) => s.score >= config.matchFloor && best.score - s.score <= config.confusableMargin)
    .map((s) => s.itemId);

  return {
    itemId: best.itemId,
    score: best.score,
    matchedPhotoIds: best.photoIds,
    exampleCount: best.exampleCount,
    timesAgreed: best.timesAgreed,
    runnerUpItemId: runnerUp?.itemId ?? null,
    runnerUpScore: runnerUp?.score ?? 0,
    confusableWith,
    strength: strengthOf(best, confusableWith, config),
  };
}

function strengthOf(best: ItemScore, confusableWith: string[], config: VisionConfig): RecognitionStrength {
  // An item it cannot separate from another is never "good", however high the score. A
  // confident wrong answer between two look-alikes is the single most expensive mistake
  // this system can make, and the score is silent about it by construction.
  if (confusableWith.length > 0) return 'weak';
  if (best.score < config.confidentAt) return best.exampleCount >= 1 ? 'learning' : 'weak';
  return best.exampleCount >= config.confidentExampleCount ? 'good' : 'learning';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hygiene — the rules that stop the index rotting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which example to retire when an item is at its cap.
 *
 * **The most redundant one, not the oldest.** Keeping the most recent photos sounds
 * sensible and is wrong: twelve photos taken this month from the same angle on the same
 * bench are worth roughly one photo, while the eleven-month-old shot of the pack lying
 * on its side is the only thing that recognises it lying on its side. Diversity is the
 * whole value of a set of examples, so eviction protects diversity.
 *
 * "Most redundant" is the example with the highest mean similarity to its siblings —
 * the one the others already cover. Returns null when there is nothing safe to drop.
 */
export function mostRedundant(examples: ReferenceVector[]): ReferenceVector | null {
  if (examples.length < 2) return null;

  let worst: ReferenceVector | null = null;
  let worstMean = -1;

  for (const example of examples) {
    let total = 0;
    for (const other of examples) {
      if (other.id === example.id) continue;
      total += cosine(example.vector, other.vector);
    }
    const mean = total / (examples.length - 1);
    // Ties broken by id, so eviction is deterministic rather than insertion-ordered.
    if (mean > worstMean || (mean === worstMean && worst && example.id < worst.id)) {
      worstMean = mean;
      worst = example;
    }
  }

  return worst;
}

/** 0..1. Low means every example looks the same, so the twelfth taught nothing. */
export function diversity(examples: ReferenceVector[]): number {
  if (examples.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < examples.length; i++) {
    for (let j = i + 1; j < examples.length; j++) {
      total += cosine((examples[i] as ReferenceVector).vector, (examples[j] as ReferenceVector).vector);
      pairs++;
    }
  }
  return Math.min(1, Math.max(0, 1 - total / pairs));
}

/**
 * What an item's recognition is actually worth, for the catalogue screen.
 *
 * `saturated` and `confusable` are the two states that say the improvement curve has
 * stopped, and they are shown rather than hidden. A plateau presented as a known
 * boundary reads as the system being honest; the same plateau presented as a rising
 * "it's learning!" reads as the system having broken.
 */
export type ItemRecognitionState = 'untaught' | 'learning' | 'good' | 'saturated' | 'confusable' | 'stale';

export function itemRecognitionState(
  examples: ReferenceVector[],
  options: { confusable: boolean; now: Date; config?: VisionConfig },
): ItemRecognitionState {
  const config = options.config ?? DEFAULT_VISION_CONFIG;
  const usable = examples.filter((e) => !isMisleading(e, config));

  if (usable.length === 0) return 'untaught';
  if (options.confusable) return 'confusable';
  if (usable.every((e) => exampleWeight(e, options.now, config) < 1)) return 'stale';
  if (usable.length < config.confidentExampleCount) return 'learning';
  // At the cap with near-identical photos: more of the same will not help, and saying so
  // is more useful than an encouraging progress bar that will never move again.
  if (usable.length >= config.maxExamplesPerItem && diversity(usable) < 0.1) return 'saturated';
  return 'good';
}

/**
 * Pairs of items whose examples overlap enough that photographs cannot separate them.
 *
 * Computed by scoring every item's examples against every other item's. Quadratic in the
 * number of examples, which is fine for the hundreds this is designed for and is why the
 * catalogue health screen computes it on demand rather than caching a stale answer.
 */
export function confusablePairs(
  examples: ReferenceVector[],
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): { a: string; b: string; score: number }[] {
  const usable = examples.filter((e) => !isMisleading(e, config));
  const best = new Map<string, number>();

  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const left = usable[i] as ReferenceVector;
      const right = usable[j] as ReferenceVector;
      if (left.itemId === right.itemId) continue;
      const score = cosine(left.vector, right.vector);
      if (score < config.confidentAt - config.confusableMargin) continue;
      const key = left.itemId < right.itemId ? `${left.itemId}|${right.itemId}` : `${right.itemId}|${left.itemId}`;
      best.set(key, Math.max(best.get(key) ?? 0, score));
    }
  }

  return [...best.entries()]
    .map(([key, score]) => {
      const [a, b] = key.split('|') as [string, string];
      return { a, b, score };
    })
    .sort((x, y) => y.score - x.score || x.a.localeCompare(y.a));
}
