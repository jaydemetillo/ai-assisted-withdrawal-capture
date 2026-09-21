import { describe, expect, it } from 'vitest';
import { chosenItemId, offerNotOnList, type LineState } from '@/lib/decision/line-state';

function line(overrides: Partial<LineState> = {}): LineState {
  return { disposition: 'pending', matchedItemId: null, resolvedItemId: null, ...overrides };
}

/**
 * One photograph produces a MIX of decisions. A prescription came back as some unmatched,
 * some needs_review, some ambiguous — all rendering as "Not identified" — and the escape
 * hatch appeared on one card out of four. Keying on the line's state rather than on which
 * rule fired is what makes it predictable.
 */
describe('offerNotOnList', () => {
  it('offers it on every line with no item, whatever the rules called it', () => {
    // The four shapes a single photographed prescription actually produced.
    expect(offerNotOnList(line())).toBe(true);
    expect(offerNotOnList(line({ disposition: 'pending' }))).toBe(true);
    expect(offerNotOnList(line({ disposition: 'escalated' }))).toBe(true);
    expect(offerNotOnList(line({ disposition: 'confirmed' }))).toBe(true);
  });

  it('does not offer it once an item is on the line', () => {
    expect(offerNotOnList(line({ matchedItemId: 'GAUZE-10X10' }))).toBe(false);
    expect(offerNotOnList(line({ resolvedItemId: 'GAUZE-10X10' }))).toBe(false);
  });

  it('does not offer it on a dropped line', () => {
    expect(offerNotOnList(line({ disposition: 'rejected' }))).toBe(false);
    expect(offerNotOnList(line({ disposition: 'rejected', matchedItemId: null }))).toBe(false);
  });

  it('a human choice wins over our own match', () => {
    expect(chosenItemId(line({ matchedItemId: 'A', resolvedItemId: 'B' }))).toBe('B');
    expect(chosenItemId(line({ matchedItemId: 'A' }))).toBe('A');
    expect(chosenItemId(line())).toBeNull();
  });
});
