import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_CONFIG, loadVisionConfig } from '@/lib/vision/config';
import {
  confusablePairs,
  cosine,
  diversity,
  exampleWeight,
  isMisleading,
  itemRecognitionState,
  mostRedundant,
  recognise,
  type ReferenceVector,
} from '@/lib/vision/similarity';
import { unit } from '@/lib/vision/embedding/provider';
import { toVector } from '@/lib/vision/embedding/transformers';

/**
 * The recogniser's maths and its hygiene rules.
 *
 * Every vector here is written by hand so that a failing assertion is about the rule
 * under test and not about what a model happened to produce that day.
 */
const NOW = new Date('2026-09-19T00:00:00Z');
const YEAR_AGO = new Date('2025-01-01T00:00:00Z');

/** A unit vector pointing mostly along `axis`, nudged by `drift`. */
function vec(axis: number, drift = 0): number[] {
  const values = [0, 0, 0, 0, 0];
  values[axis] = 1;
  values[(axis + 1) % 5] = drift;
  return unit(values);
}

function example(overrides: Partial<ReferenceVector> & { id: string; itemId: string; vector: number[] }): ReferenceVector {
  return { timesAgreed: 0, timesOverruled: 0, createdAt: NOW, ...overrides };
}

describe('cosine', () => {
  it('is 1 for a vector against itself and 0 for orthogonal ones', () => {
    expect(cosine(vec(0), vec(0))).toBeCloseTo(1, 10);
    expect(cosine(vec(0), vec(1))).toBeCloseTo(0, 10);
  });

  it('clamps negatives to zero — "less alike than unrelated" is still just unrelated', () => {
    expect(cosine([1, 0], [-1, 0])).toBe(0);
  });

  it('returns 0 rather than throwing on a mismatched or empty vector', () => {
    // One malformed row — a vector from an older provider, a truncated column — must not
    // take down a whole read.
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('recognise', () => {
  const index = [
    example({ id: 'p1', itemId: 'cannula', vector: vec(0) }),
    example({ id: 'p2', itemId: 'cannula', vector: vec(0, 0.2), timesAgreed: 4 }),
    example({ id: 'p3', itemId: 'gauze', vector: vec(1) }),
  ];

  it('finds the nearest item and reports which photos produced it', () => {
    const result = recognise(vec(0, 0.05), index, NOW);
    expect(result.itemId).toBe('cannula');
    expect(result.matchedPhotoIds[0]).toBe('p1');
    expect(result.exampleCount).toBe(2);
    expect(result.timesAgreed).toBe(4);
  });

  it('returns nothing at all below the match floor', () => {
    // Equal parts of all five axes scores 1/√5 ≈ 0.447 against any of them, well under
    // the 0.72 default floor.
    const result = recognise(unit([1, 1, 1, 1, 1]), index, NOW);
    expect(result.itemId).toBeNull();
    expect(result.strength).toBe('none');
  });

  it('returns nothing when the index is empty', () => {
    expect(recognise(vec(0), [], NOW).itemId).toBeNull();
  });

  it('scores an item by its NEAREST example, not the average of them', () => {
    // Averaging would punish an item for having varied examples, which is the one thing
    // we want a set of examples to be.
    const spread = [
      example({ id: 'a', itemId: 'x', vector: vec(0) }),
      example({ id: 'b', itemId: 'x', vector: vec(2) }),
      example({ id: 'c', itemId: 'x', vector: vec(3) }),
    ];
    expect(recognise(vec(0), spread, NOW).score).toBeCloseTo(1, 6);
  });

  it('ties break by item id, so the same photo always gives the same answer', () => {
    const tied = [
      example({ id: 'p1', itemId: 'zebra', vector: vec(0) }),
      example({ id: 'p2', itemId: 'alpha', vector: vec(0) }),
    ];
    expect(recognise(vec(0), tied, NOW).itemId).toBe('alpha');
    expect(recognise(vec(0), [...tied].reverse(), NOW).itemId).toBe('alpha');
  });

  describe('look-alikes', () => {
    const lookAlike = [
      example({ id: 'p1', itemId: 'gloves-m', vector: vec(0) }),
      example({ id: 'p2', itemId: 'gloves-l', vector: vec(0, 0.02) }),
    ];

    it('names the other item rather than picking one', () => {
      const result = recognise(vec(0), lookAlike, NOW);
      expect(result.itemId).toBe('gloves-m');
      expect(result.confusableWith).toEqual(['gloves-l']);
    });

    it('is never "good", however high the score', () => {
      // The single most expensive mistake this system can make is a confident wrong
      // answer between two look-alikes, and the score is silent about it by construction.
      const result = recognise(vec(0), lookAlike, NOW);
      expect(result.score).toBeGreaterThan(DEFAULT_VISION_CONFIG.confidentAt);
      expect(result.strength).toBe('weak');
    });
  });

  describe('strength bands', () => {
    it('reads as "learning" until there are enough examples', () => {
      const one = [example({ id: 'p1', itemId: 'x', vector: vec(0) })];
      expect(recognise(vec(0), one, NOW).strength).toBe('learning');
    });

    it('reads as "good" on a clear match with enough examples', () => {
      const many = [0.02, 0.04, 0.06].map((drift, i) =>
        example({ id: `p${i}`, itemId: 'x', vector: vec(0, drift) }),
      );
      expect(recognise(vec(0), many, NOW).strength).toBe('good');
    });
  });

  it('ignores an example that has been overruled into quarantine', () => {
    const poisoned = [
      example({ id: 'bad', itemId: 'wrong', vector: vec(0), timesOverruled: 5 }),
      example({ id: 'good', itemId: 'right', vector: vec(0, 0.4) }),
    ];
    expect(recognise(vec(0), poisoned, NOW).itemId).toBe('right');
  });
});

describe('staleness', () => {
  it('leaves a recent example at full weight', () => {
    expect(exampleWeight({ createdAt: NOW }, NOW)).toBe(1);
  });

  it('discounts one older than the stale window', () => {
    expect(exampleWeight({ createdAt: YEAR_AGO }, NOW)).toBe(DEFAULT_VISION_CONFIG.staleWeight);
  });

  it('lets a fresh example win over a stale one that matches slightly better', () => {
    // A stale example is worse than no example when the packaging has changed: it still
    // matches confidently, and is now wrong.
    const index = [
      example({ id: 'old', itemId: 'old-packaging', vector: vec(0), createdAt: YEAR_AGO }),
      example({ id: 'new', itemId: 'new-packaging', vector: vec(0, 0.25), createdAt: NOW }),
    ];
    expect(recognise(vec(0), index, NOW).itemId).toBe('new-packaging');
  });
});

describe('isMisleading', () => {
  it('needs both enough overrules and more overrules than agreements', () => {
    expect(isMisleading({ timesAgreed: 0, timesOverruled: 3 })).toBe(true);
    expect(isMisleading({ timesAgreed: 0, timesOverruled: 2 })).toBe(false);
    // A popular example that is usually right but occasionally corrected is not a bad
    // example; it is a common item.
    expect(isMisleading({ timesAgreed: 40, timesOverruled: 4 })).toBe(false);
  });
});

describe('mostRedundant', () => {
  it('drops the example the others already cover, not the oldest', () => {
    const near = new Date('2020-01-01T00:00:00Z');
    const examples = [
      example({ id: 'twin-a', itemId: 'x', vector: vec(0) }),
      example({ id: 'twin-b', itemId: 'x', vector: vec(0, 0.01) }),
      // Old, and the only example from a different angle. Keeping it is the point.
      example({ id: 'unique', itemId: 'x', vector: vec(3), createdAt: near }),
    ];
    expect(mostRedundant(examples)?.id).not.toBe('unique');
  });

  it('is deterministic when two examples are equally redundant', () => {
    const examples = [
      example({ id: 'b', itemId: 'x', vector: vec(0) }),
      example({ id: 'a', itemId: 'x', vector: vec(0) }),
      example({ id: 'c', itemId: 'x', vector: vec(2) }),
    ];
    expect(mostRedundant(examples)?.id).toBe(mostRedundant([...examples].reverse())?.id);
  });

  it('has nothing to drop below two examples', () => {
    expect(mostRedundant([])).toBeNull();
    expect(mostRedundant([example({ id: 'p1', itemId: 'x', vector: vec(0) })])).toBeNull();
  });
});

describe('diversity', () => {
  it('is near zero when every example is the same photograph', () => {
    const same = [0, 1, 2].map((i) => example({ id: `p${i}`, itemId: 'x', vector: vec(0) }));
    expect(diversity(same)).toBeCloseTo(0, 6);
  });

  it('rises as the examples spread out', () => {
    const spread = [0, 1, 2].map((i) => example({ id: `p${i}`, itemId: 'x', vector: vec(i) }));
    expect(diversity(spread)).toBeGreaterThan(0.9);
  });
});

describe('itemRecognitionState', () => {
  const fresh = (n: number, drift = 0.3) =>
    Array.from({ length: n }, (_, i) => example({ id: `p${i}`, itemId: 'x', vector: vec(0, i * drift) }));

  it('is untaught with no examples', () => {
    expect(itemRecognitionState([], { confusable: false, now: NOW })).toBe('untaught');
  });

  it('is learning below the confident count', () => {
    expect(itemRecognitionState(fresh(2), { confusable: false, now: NOW })).toBe('learning');
  });

  it('is good with enough varied examples', () => {
    expect(itemRecognitionState(fresh(4), { confusable: false, now: NOW })).toBe('good');
  });

  it('is saturated at the cap when every example looks the same', () => {
    // The plateau, stated. More photographs of the same angle will not move this.
    const identical = Array.from({ length: DEFAULT_VISION_CONFIG.maxExamplesPerItem }, (_, i) =>
      example({ id: `p${i}`, itemId: 'x', vector: vec(0) }),
    );
    expect(itemRecognitionState(identical, { confusable: false, now: NOW })).toBe('saturated');
  });

  it('is confusable whatever else is true — it outranks "good"', () => {
    expect(itemRecognitionState(fresh(6), { confusable: true, now: NOW })).toBe('confusable');
  });

  it('is stale when every example has aged out', () => {
    const old = fresh(4).map((e) => ({ ...e, createdAt: YEAR_AGO }));
    expect(itemRecognitionState(old, { confusable: false, now: NOW })).toBe('stale');
  });

  it('ignores quarantined examples when deciding the state', () => {
    const quarantined = fresh(4).map((e) => ({ ...e, timesOverruled: 9 }));
    expect(itemRecognitionState(quarantined, { confusable: false, now: NOW })).toBe('untaught');
  });
});

describe('confusablePairs', () => {
  it('finds two items whose examples overlap, and names them in a stable order', () => {
    const index = [
      example({ id: 'a', itemId: 'gloves-m', vector: vec(0) }),
      example({ id: 'b', itemId: 'gloves-l', vector: vec(0, 0.02) }),
      example({ id: 'c', itemId: 'bvm', vector: vec(3) }),
    ];
    const pairs = confusablePairs(index);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]?.a, pairs[0]?.b].sort()).toEqual(['gloves-l', 'gloves-m']);
  });

  it('does not pair an item with itself however similar its own examples are', () => {
    const index = [
      example({ id: 'a', itemId: 'x', vector: vec(0) }),
      example({ id: 'b', itemId: 'x', vector: vec(0) }),
    ];
    expect(confusablePairs(index)).toEqual([]);
  });
});

describe('loadVisionConfig', () => {
  it('uses the documented defaults when nothing is set', () => {
    expect(loadVisionConfig({})).toEqual(DEFAULT_VISION_CONFIG);
  });

  it('reads overrides from the environment', () => {
    expect(loadVisionConfig({ VISION_MAX_EXAMPLES: '5' }).maxExamplesPerItem).toBe(5);
  });

  it('refuses a malformed value rather than silently defaulting', () => {
    // A typo here would mean a deployment running thresholds nobody intended.
    expect(() => loadVisionConfig({ VISION_MATCH_FLOOR: 'nope' })).toThrow(/Invalid visual-recognition/);
    expect(() => loadVisionConfig({ VISION_CONFIDENT_AT: '2' })).toThrow(/Invalid visual-recognition/);
  });

  it('refuses a floor above the confident line', () => {
    // Otherwise nothing could ever read as merely "learning": every match would arrive
    // already claiming to be settled.
    expect(() => loadVisionConfig({ VISION_MATCH_FLOOR: '0.9', VISION_CONFIDENT_AT: '0.8' })).toThrow(
      /must not be above/,
    );
  });
});

describe('toVector — reading whatever transformers.js returned', () => {
  /**
   * The optional CLIP adapter cannot be exercised here: the package is not a dependency,
   * on purpose. What CAN be tested is the part that has actually broken in the wild —
   * transformers.js has shipped a Tensor with `.data`, a nested array and a flat array
   * across versions, and a wrong guess produces a vector of `undefined` that normalises
   * to zeros and silently matches nothing at all.
   */
  it('reads a Tensor-shaped result', () => {
    expect(toVector({ data: Float32Array.from([3, 0, 0, 0]) }, 4)).toEqual([1, 0, 0, 0]);
  });

  it('reads a flat array and a nested one', () => {
    expect(toVector([0, 2, 0, 0], 4)).toEqual([0, 1, 0, 0]);
    expect(toVector([[0, 0, 5, 0]], 4)).toEqual([0, 0, 1, 0]);
  });

  it('throws rather than returning zeros when the shape is unrecognised', () => {
    expect(() => toVector({ embeddings: [1, 2, 3] }, 3)).toThrow(/not a vector/);
    expect(() => toVector([], 3)).toThrow(/not a vector/);
    expect(() => toVector([1, null, 3], 3)).toThrow(/not a vector/);
  });

  it('refuses a vector of the wrong width, naming both numbers', () => {
    // Swapping the model under a populated index would otherwise score every stored
    // example at 0 and look exactly like "it stopped recognising things".
    expect(() => toVector([1, 0, 0], 512)).toThrow(/3 dimensions but the stored examples have 512/);
  });
});
