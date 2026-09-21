import { describe, expect, it } from 'vitest';
import { evaluateCandidate } from '@/lib/decision/rules';
import { resusCatalogue } from '../helpers/catalogue';

/**
 * How real notes are written.
 *
 * These are not the demo note. They are the spellings, abbreviations and plurals a
 * nurse would plausibly scribble, and the point of the suite is that the OUTCOME does
 * not depend on which of them they chose. A matcher tuned to one example is a matcher
 * that fails on the next person's handwriting.
 */
const catalogue = resusCatalogue();

function decide(rawText: string, quantity: number | null = 1) {
  return evaluateCandidate(
    { rawText, evidence: 'written_text', proposedQuantity: quantity, proposedItemId: null, confidence: 0.95, status: 'high_confidence', reason: '' },
    catalogue,
  );
}

describe('the same intent, written seven ways', () => {
  const spellings = ['3x mask', 'mask x3', '3 masks', 'masks 3', 'masks - 3', '3 × masks', 'x3 masks'];

  it('reaches an identical decision however the count is written', () => {
    const outcomes = spellings.map((s) => decide(s, 3));
    const decisions = new Set(outcomes.map((o) => o.decision));
    const options = new Set(outcomes.map((o) => o.suggestedItemIds.slice().sort().join('|')));

    expect(decisions.size).toBe(1);
    expect(options.size).toBe(1);
    // Three masks are stocked, so the honest answer is "which one?" — every time.
    expect([...decisions][0]).toBe('ambiguous');
  });

  it('is unaffected by case, padding and trailing punctuation', () => {
    for (const noisy of ['Masks.', '  3x  MASK  ', '3x mask,', 'MASKS']) {
      expect(decide(noisy, 3).decision).toBe('ambiguous');
    }
  });
});

describe('plurals a nurse would actually write', () => {
  it.each([
    ['2 gloves', 'ambiguous'],
    ['4x syringes', 'ambiguous'],
    ['2 cannulas', 'ambiguous'],
    ['6 swabs', 'ambiguous'],
    ['needles', 'ambiguous'],
    ['5 electrodes', 'eligible'],
  ])('%s → %s', (text, expected) => {
    expect(decide(text, 2).decision).toBe(expected);
  });

  it('never leaves a plural as a dead end when the singular is stocked', () => {
    // The original bug: "syringes" matched nothing, so the nurse got "Cannot identify"
    // with no way forward.
    for (const text of ['syringes', 'masks', 'gloves', 'cannulas', 'needles', 'electrodes']) {
      const outcome = decide(text, 1);
      expect(outcome.decision).not.toBe('unmatched');
      if (outcome.decision === 'ambiguous') expect(outcome.suggestedItemIds.length).toBeGreaterThan(1);
    }
  });
});

describe('a note written specifically enough is confirmable outright', () => {
  it.each([
    '3x surgical mask',
    '4x 10ml syringe',
    '5x saline flush',
    '2 medium gloves',
    '1 non rebreather',
    '2 giving sets',
    '1 bvm',
    '3 ecg dots',
    '2 micropore',
    '1 hartmanns',
    '2 ns 500ml',
    '4 green needles',
    '3 blue needles',
    'IV set x1',
    'NRB mask x1',
    'gloves M x2',
    '10x10 gauze x3',
    '18G blue cannula x1',
  ])('%s is eligible', (text) => {
    expect(decide(text, 2).decision).toBe('eligible');
  });
});

describe('things on a note that are not supplies', () => {
  it.each(['withdrawn', 'ED resus 2', '18/09/26', 'signed A.Tan', 'taken for pt'])(
    '%s never becomes a stock movement',
    (text) => {
      expect(decide(text, null).decision).not.toBe('eligible');
    },
  );
});

describe('sizes survive, counts do not', () => {
  it('keeps a number that identifies the item', () => {
    // "18g", "10ml", "500ml" and "10x10" name the thing; a bare "3" counts it.
    expect(decide('18g cannula', 1).matchedItemId).toBe('IVC-18G-BLUE');
    expect(decide('22g cannula', 1).matchedItemId).toBe('IVC-22G-BLUE');
    expect(decide('10x10 gauze', 1).matchedItemId).toBe('GAUZE-10X10');
    expect(decide('5x5 gauze', 1).matchedItemId).toBe('GAUZE-5X5');
  });

  it('does not let a count distinguish two items', () => {
    // "3 gauze" must not resolve to the 5x5 just because a 5 appears somewhere.
    expect(decide('3 gauze', 3).decision).toBe('ambiguous');
  });
});

describe('high-risk items in the options', () => {
  it('escalates when every reading is restricted', () => {
    expect(decide('3 pads', 3).decision).toBe('restricted');
    expect(decide('adrenaline', 1).decision).toBe('restricted');
    expect(decide('morphine', 1).decision).toBe('restricted');
  });

  it('asks rather than escalates when a safe reading exists', () => {
    // "syringes" could be the adrenaline prefilled syringe, but it could equally be a
    // plain one. The choice is the human's; the restriction is re-checked on whatever
    // they pick, at confirmation.
    const outcome = decide('4x syringes', 4);
    expect(outcome.decision).toBe('ambiguous');
    expect(outcome.suggestedItemIds).toContain('ADREN-1MG-10ML');
  });
});
