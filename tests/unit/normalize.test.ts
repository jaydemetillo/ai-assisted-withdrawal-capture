import { describe, expect, it } from 'vitest';
import { itemPhrase, matchTokens, normalize, similarity, singular, tokens } from '@/lib/catalogue/normalize';

describe('normalize', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalize('  IV Cannula  18G (blue) ')).toBe('iv cannula 18g blue');
    expect(normalize("Hartmann's 1L")).toBe('hartmann s 1l');
    expect(normalize('Sodium chloride 0.9%')).toBe('sodium chloride 0 9%');
  });

  it('returns an empty string for text with nothing in it', () => {
    expect(normalize('???')).toBe('');
    expect(normalize('   ')).toBe('');
  });

  it('tokenises to an empty array rather than [""]', () => {
    expect(tokens('???')).toEqual([]);
    expect(tokens('blue cannula')).toEqual(['blue', 'cannula']);
  });
});

describe('itemPhrase', () => {
  it('strips explicit multiplier forms wherever they appear', () => {
    expect(itemPhrase('18G blue cannula x1')).toBe('18g blue cannula');
    expect(itemPhrase('2 x saline flush')).toBe('saline flush');
    expect(itemPhrase('saline flush qty 2')).toBe('saline flush');
  });

  it('strips a bare integer at either end only when something is left', () => {
    expect(itemPhrase('saline flush 2')).toBe('saline flush');
    expect(itemPhrase('2 saline flush')).toBe('saline flush');
    // Two tokens must survive, so a gauge is never mistaken for a count.
    expect(itemPhrase('gauze 10')).toBe('gauze 10');
  });

  it('keeps sizes that carry a unit letter', () => {
    expect(itemPhrase('18G cannula')).toBe('18g cannula');
    expect(itemPhrase('10ml syringe x3')).toBe('10ml syringe');
  });

  it('leaves a line with no readable words empty', () => {
    expect(itemPhrase('???')).toBe('');
  });
});

describe('similarity', () => {
  it('is 1 for identical normalised text and 0 for nothing in common', () => {
    expect(similarity('Blue Cannula', 'blue cannula')).toBe(1);
    expect(similarity('gauze', '')).toBe(0);
  });

  it('scores near-misses above unrelated words', () => {
    const near = similarity('foly cath', 'foley catheter');
    const unrelated = similarity('foly cath', 'surgical mask level 2');
    expect(near).toBeGreaterThan(unrelated);
  });
});

describe('singular', () => {
  it('folds the plurals people actually write', () => {
    expect(singular('syringes')).toBe('syringe');
    expect(singular('masks')).toBe('mask');
    expect(singular('gloves')).toBe('glove');
    expect(singular('electrodes')).toBe('electrode');
    expect(singular('pads')).toBe('pad');
  });

  it('handles -es and -ies endings', () => {
    expect(singular('boxes')).toBe('box');
    expect(singular('flushes')).toBe('flush');
    expect(singular('supplies')).toBe('supply');
  });

  it('leaves the catalogue shorthand alone', () => {
    // Three letters or fewer are never folded: "ns" and "gas" are words in this domain,
    // and stripping a letter from them would do real damage.
    expect(singular('ns')).toBe('ns');
    expect(singular('gas')).toBe('gas');
    expect(singular('10ml')).toBe('10ml');
  });

  it('leaves singulars and -ss words unchanged', () => {
    expect(singular('saline')).toBe('saline');
    expect(singular('gauze')).toBe('gauze');
    expect(singular('dress')).toBe('dress');
  });
});

describe('matchTokens', () => {
  it('folds plurals on the way into matching', () => {
    expect(matchTokens('4x syringes')).toEqual(['4x', 'syringe']);
  });
});
