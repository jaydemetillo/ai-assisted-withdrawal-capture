import { describe, expect, it } from 'vitest';
import { distinctMatchedItems, matchPhrase, suggestItems } from '@/lib/catalogue/match';
import { resusCatalogue, storeCatalogue } from '../helpers/catalogue';

const resus = resusCatalogue();

function skus(text: string): string[] {
  return distinctMatchedItems(matchPhrase(text, resus).matches).map((i) => i.sku).sort();
}

describe('matchPhrase — exact forms', () => {
  it('matches an exact SKU', () => {
    expect(skus('IVC-18G-BLUE')).toEqual(['IVC-18G-BLUE']);
  });

  it('matches an exact display name', () => {
    expect(skus('Sodium chloride 0.9% flush 10 mL')).toEqual(['NS-FLUSH-10ML']);
  });

  it('matches an approved alias regardless of case and punctuation', () => {
    expect(skus('Saline Flush')).toEqual(['NS-FLUSH-10ML']);
    expect(skus('saline flush!')).toEqual(['NS-FLUSH-10ML']);
  });

  it('reports which catalogue string produced the hit', () => {
    const outcome = matchPhrase('saline flush x2', resus);
    expect(outcome.matches[0]?.kind).toBe('alias');
    expect(outcome.matches[0]?.matchedOn).toBe('saline flush');
  });
});

describe('matchPhrase — token containment', () => {
  it('matches when every written word appears in one catalogue string', () => {
    expect(skus('18G blue cannula')).toEqual(['IVC-18G-BLUE']);
  });

  it('finds every item a loose phrase could mean', () => {
    // This is the behaviour the whole ambiguity story depends on.
    expect(skus('blue cannula')).toEqual(['IVC-18G-BLUE', 'IVC-22G-BLUE']);
    expect(skus('gauze')).toEqual(['GAUZE-10X10', 'GAUZE-5X5']);
    expect(skus('mask')).toEqual(['BVM-ADULT', 'MASK-SURG-L2', 'OXY-MASK-NRB']);
  });

  it('does not combine tokens from two different aliases into one match', () => {
    // "blue" comes from one alias of the 23G needle and "gloves" from another item;
    // neither single string contains both, so nothing matches.
    expect(skus('blue gloves')).toEqual([]);
  });

  it('ignores the quantity when matching', () => {
    expect(skus('18G blue cannula x1')).toEqual(['IVC-18G-BLUE']);
    expect(skus('2 x saline flush')).toEqual(['NS-FLUSH-10ML']);
  });
});

describe('matchPhrase — location scoping', () => {
  it('cannot match an item that is not stocked at the location', () => {
    // Morphine lives in the CD cupboard, not the general store room.
    expect(distinctMatchedItems(matchPhrase('morphine', storeCatalogue()).matches)).toEqual([]);
    expect(skus('morphine')).toEqual(['MORPH-10MG']);
  });

  it('skips inactive items', () => {
    const catalogue = resusCatalogue();
    const item = catalogue.items.find((i) => i.sku === 'NS-FLUSH-10ML');
    if (item) item.isActive = false;
    expect(distinctMatchedItems(matchPhrase('saline flush', catalogue).matches)).toEqual([]);
  });
});

describe('suggestItems', () => {
  it('offers near-misses when nothing matched', () => {
    const outcome = matchPhrase('surgicl mask', resus);
    expect(outcome.matches).toHaveLength(0);
    expect(outcome.suggestions.map((i) => i.sku)).toContain('MASK-SURG-L2');
  });

  it('offers nothing for text with no words in it', () => {
    expect(suggestItems('???', resus)).toEqual([]);
  });

  it('is not consulted when there is a real match', () => {
    expect(matchPhrase('saline flush', resus).suggestions).toEqual([]);
  });
});
