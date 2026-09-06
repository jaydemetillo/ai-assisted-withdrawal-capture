import { describe, expect, it } from 'vitest';
import { matchItem, normalize, resolveLines, similarity } from '@/lib/ocr/match';
import type { CatalogueEntry, OcrLine } from '@/lib/ocr/types';

const catalogue: CatalogueEntry[] = [
  { id: 'i-mask', sku: 'MASK-L2', name: 'Surgical Mask (Level 2)', unit: 'piece', aliases: ['mask', 'masks', 'face mask'] },
  { id: 'i-syr', sku: 'SYR-10ML', name: 'Syringe 10ml', unit: 'piece', aliases: ['syringe', 'syringes', 'syr 10ml'] },
  { id: 'i-sal', sku: 'SAL-09-500', name: 'Normal Saline 0.9% 500ml', unit: 'bag', aliases: ['saline', 'ns', 'normal saline'] },
  { id: 'i-foley', sku: 'FOLEY-16', name: 'Foley Catheter 16Fr', unit: 'piece', aliases: ['foley', 'foley catheter', 'foly cath'] },
  { id: 'i-glove', sku: 'GLOVE-NIT-M', name: 'Nitrile Gloves (Medium)', unit: 'box', aliases: ['gloves', 'gloves m', 'nitrile gloves'] },
];

describe('normalize', () => {
  it('strips punctuation and case', () => {
    expect(normalize('Gloves (M)')).toBe('gloves m');
    expect(normalize('  NS  500ml ...... ')).toBe('ns 500ml');
  });
});

describe('similarity', () => {
  it('scores identical strings 1', () => {
    expect(similarity('saline', 'saline')).toBe(1);
  });

  it('rates a plausible abbreviation above an unrelated word', () => {
    expect(similarity('foly cath', 'foley catheter')).toBeGreaterThan(similarity('foly cath', 'surgical mask'));
  });
});

describe('matchItem', () => {
  it('resolves the plural a nurse actually writes', () => {
    expect(matchItem('Masks', catalogue)?.entry.sku).toBe('MASK-L2');
    expect(matchItem('Syringes', catalogue)?.entry.sku).toBe('SYR-10ML');
  });

  it('resolves a domain abbreviation via alias', () => {
    expect(matchItem('NS', catalogue)?.entry.sku).toBe('SAL-09-500');
  });

  it('resolves an alias buried inside a longer line', () => {
    expect(matchItem('Gloves (M) x 2 boxes', catalogue)?.entry.sku).toBe('GLOVE-NIT-M');
  });

  it('tolerates dropped vowels', () => {
    expect(matchItem('foly cath 16', catalogue)?.entry.sku).toBe('FOLEY-16');
  });

  it('returns null rather than guessing at nonsense', () => {
    expect(matchItem('zzzz qqqq', catalogue)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(matchItem('   ', catalogue)).toBeNull();
  });
});

describe('resolveLines', () => {
  const line = (over: Partial<OcrLine>): OcrLine => ({
    rawText: '3x Masks', quantity: 3, itemGuess: 'Masks', sku: 'MASK-L2',
    confidence: 0.95, bbox: [10, 10, 100, 50], ...over,
  });

  it('trusts a confident SKU from the model', () => {
    const [row] = resolveLines([line({})], catalogue);
    expect(row).toMatchObject({ itemId: 'i-mask', quantity: 3, matchSource: 'MODEL', needsReview: false });
  });

  it('falls back to fuzzy matching when no SKU is given', () => {
    const [row] = resolveLines([line({ sku: null })], catalogue);
    expect(row.itemId).toBe('i-mask');
    expect(row.matchSource).toBe('FUZZY');
  });

  it('flags an unreadable quantity instead of inventing one', () => {
    const [row] = resolveLines([line({ quantity: null, rawText: '?? x biohzd bags' })], catalogue);
    expect(row.quantity).toBe(0);
    expect(row.needsReview).toBe(true);
  });

  it('flags a low-confidence read even when an item matched', () => {
    const [row] = resolveLines([line({ confidence: 0.4 })], catalogue);
    expect(row.needsReview).toBe(true);
  });

  it('flags a line nothing matched', () => {
    const [row] = resolveLines([line({ sku: null, itemGuess: 'zzzz qqqq' })], catalogue);
    expect(row.itemId).toBeNull();
    expect(row.needsReview).toBe(true);
  });

  it('ignores an unknown SKU and re-resolves from the text', () => {
    const [row] = resolveLines([line({ sku: 'NOT-A-REAL-SKU' })], catalogue);
    expect(row.itemId).toBe('i-mask');
    expect(row.matchSource).toBe('FUZZY');
  });

  it('drops a degenerate bounding box rather than drawing an invisible chip', () => {
    const [row] = resolveLines([line({ bbox: [50, 50, 50, 50] })], catalogue);
    expect(row.bbox).toBeNull();
  });

  it('clamps an out-of-range bounding box into the canvas', () => {
    const [row] = resolveLines([line({ bbox: [-40, 10, 3000, 60] })], catalogue);
    expect(row.bbox).toEqual([0, 10, 1000, 60]);
  });
});
