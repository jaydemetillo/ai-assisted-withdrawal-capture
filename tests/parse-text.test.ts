import { describe, expect, it } from 'vitest';
import { detectAction, extractQuantity, parseWrittenList } from '@/lib/ocr/parse-text';
import type { CatalogueEntry } from '@/lib/ocr/types';

const catalogue: CatalogueEntry[] = [
  { id: 'MASK-L2', sku: 'MASK-L2', name: 'Surgical Mask (Level 2)', unit: 'piece', aliases: ['mask', 'masks'] },
  { id: 'SYR-10ML', sku: 'SYR-10ML', name: 'Syringe 10ml', unit: 'piece', aliases: ['syringe', 'syringes'] },
  { id: 'SAL-09-500', sku: 'SAL-09-500', name: 'Normal Saline 0.9% 500ml', unit: 'bag', aliases: ['saline', 'ns'] },
  { id: 'GLOVE-NIT-M', sku: 'GLOVE-NIT-M', name: 'Nitrile Gloves (Medium)', unit: 'box', aliases: ['gloves', 'gloves m'] },
  { id: 'ECG-ELEC', sku: 'ECG-ELEC', name: 'ECG Electrodes', unit: 'pack', aliases: ['ecg', 'ecg electrodes'] },
  { id: 'BIOHAZ-BAG', sku: 'BIOHAZ-BAG', name: 'Biohazard Bag', unit: 'piece', aliases: ['biohazard bag', 'biohzd bags'] },
];

describe('extractQuantity', () => {
  const cases: [string, number | null, string][] = [
    ['3x Mask', 3, 'Mask'],
    ['4 x Syringes', 4, 'Syringes'],
    ['3xMasks', 3, 'Masks'],
    ['Masks x 3', 3, 'Masks'],
    ['ECG electrodes x10', 10, 'ECG electrodes'],
    ['Syringe 10ml - 8', 8, 'Syringe 10ml'],
    ['NS 500ml ...... 3', 3, 'NS 500ml'],
    ['6 Alcohol swabs', 6, 'Alcohol swabs'],
  ];
  for (const [line, qty, rest] of cases) {
    it(`reads "${line}"`, () => {
      expect(extractQuantity(line)).toEqual({ quantity: qty, rest });
    });
  }

  it('does not read a unit word as the quantity', () => {
    // "2 boxes", not 2 hundred and not the "M" size.
    expect(extractQuantity('Gloves (M) x 2 boxes').quantity).toBe(2);
  });

  it('does not mistake a strength for a quantity', () => {
    expect(extractQuantity('Saline 500ml').quantity).toBeNull();
  });

  it('returns null for a quantity the writer marked unreadable', () => {
    expect(extractQuantity('?? x biohzd bags')).toEqual({ quantity: null, rest: 'biohzd bags' });
  });
});

describe('detectAction', () => {
  it('reads withdrawal wording', () => {
    expect(detectAction('Withdrawn').action).toBe('WITHDRAW');
    expect(detectAction('taken out for ward round').action).toBe('WITHDRAW');
  });

  it('reads disposal wording', () => {
    expect(detectAction('DISPOSED - expired batch').action).toBe('DISPOSE');
  });

  it('treats an expired batch as a disposal even when the note also says withdrawn', () => {
    expect(detectAction('expired, withdrawn from shelf').action).toBe('DISPOSE');
  });

  it('returns null when the note says neither', () => {
    expect(detectAction('3x Masks').action).toBeNull();
  });
});

describe('parseWrittenList', () => {
  it('parses the note a nurse actually wrote', () => {
    const result = parseWrittenList('3x Mask\n4x Syringes\n5x Saline\n\nWithdrawn\nJay', catalogue);
    expect(result.action).toBe('WITHDRAW');
    expect(result.lines.map((l) => [l.itemId, l.quantity])).toEqual([
      ['MASK-L2', 3],
      ['SYR-10ML', 4],
      ['SAL-09-500', 5],
    ]);
    expect(result.lines.every((l) => !l.needsReview)).toBe(true);
  });

  it('drops headings, action words and signatures', () => {
    const result = parseWrittenList(
      'Ward 411 - S15 Medical\n\n3x Masks\n\nWithdrawn\n- A. Rahman\nchecked by Fang',
      catalogue,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].itemId).toBe('MASK-L2');
  });

  it('flags an unreadable quantity instead of guessing it', () => {
    const result = parseWrittenList('?? x biohzd bags\nwithdrawn', catalogue);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].quantity).toBe(0);
    expect(result.lines[0].needsReview).toBe(true);
  });

  it('flags an item that is not in the catalogue rather than dropping it', () => {
    const result = parseWrittenList('4 x defibrillator pads\nwithdrawn', catalogue);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].itemId).toBeNull();
    expect(result.lines[0].needsReview).toBe(true);
  });

  it('handles mixed formats in one note', () => {
    const result = parseWrittenList(
      'Gloves (M) x 2 boxes\nSyringe 10ml - 8\nNS 500ml ...... 3\nECG electrodes x10\nwithdrawn',
      catalogue,
    );
    expect(result.lines.map((l) => [l.itemId, l.quantity])).toEqual([
      ['GLOVE-NIT-M', 2],
      ['SYR-10ML', 8],
      ['SAL-09-500', 3],
      ['ECG-ELEC', 10],
    ]);
  });

  it('returns nothing for a note with no items', () => {
    expect(parseWrittenList('Ward 411\nsigned Jay', catalogue).lines).toHaveLength(0);
  });

  it('ignores blank input', () => {
    expect(parseWrittenList('   \n\n  ', catalogue).lines).toHaveLength(0);
  });
});
