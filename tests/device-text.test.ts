import { describe, expect, it } from 'vitest';
import { applyDeviceReading, assembleReadText, looksLikeAnItemLine, parseDeviceLines, tidyReadLine, type DeviceLine } from '@/lib/ocr/device-text';
import { parseWrittenList } from '@/lib/ocr/parse-text';
import type { CatalogueEntry, ResolvedLine } from '@/lib/ocr/types';

const CATALOGUE: CatalogueEntry[] = [
  { id: 'mask', sku: 'MASK-L2', name: 'Surgical Mask (Level 2)', unit: 'piece', aliases: ['mask', 'masks'] },
  { id: 'syringe', sku: 'SYR-10ML', name: 'Syringe 10ml', unit: 'piece', aliases: ['syringe', 'syringes'] },
  { id: 'saline', sku: 'SAL-09-500', name: 'Normal Saline 0.9% 500ml', unit: 'bag', aliases: ['saline', 'ns'] },
];

/** Shorthand for a word the engine was sure about. */
const sure = (text: string) => ({ text, confidence: 0.95 });
const unsure = (text: string) => ({ text, confidence: 0.2 });

describe('tidyReadLine', () => {
  it('keeps a clean line as it was written', () => {
    expect(tidyReadLine([sure('3x'), sure('Masks')])).toBe('3x Masks');
  });

  it('drops the stray marks a photo of paper produces', () => {
    // The "|" here is the edge of the page, read as a character.
    expect(tidyReadLine([sure('DISPOSED'), sure('-'), sure('expired'), sure('batch'), unsure('|')])).toBe(
      'DISPOSED - expired batch',
    );
  });

  it('keeps the separators a quantity can hide behind', () => {
    expect(tidyReadLine([sure('Syringe'), sure('10ml'), sure('-'), sure('8')])).toBe('Syringe 10ml - 8');
    expect(tidyReadLine([sure('NS'), sure('500ml'), sure('...'), sure('3')])).toBe('NS 500ml ... 3');
  });

  it('drops a doubted stray digit rather than reading it as the quantity', () => {
    // This is the one that matters: without it, "3x Masks" plus a smudge becomes five
    // masks withdrawn, and the number looks exactly as trustworthy as a real one.
    const line = tidyReadLine([sure('3x'), sure('Masks'), unsure('5')]);
    expect(line).toBe('3x Masks');
    expect(parseWrittenList(line, CATALOGUE).lines[0].quantity).toBe(3);
  });

  it('keeps a leading single character, which is usually the quantity', () => {
    expect(tidyReadLine([unsure('4'), sure('x'), sure('Masks')])).toBe('4 x Masks');
  });

  it('keeps a doubted digit that is more than one character', () => {
    expect(tidyReadLine([sure('Masks'), sure('x'), unsure('12')])).toBe('Masks x 12');
  });
});

describe('looksLikeAnItemLine', () => {
  it('recognises the quantity shapes people actually write', () => {
    for (const line of ['3x Masks', '3 Masks', 'Masks x 3', 'Gloves (M) x 2 boxes', 'Syringe 10ml - 8', 'NS 500ml ... 3', '?? x biohazard bags']) {
      expect(looksLikeAnItemLine(line), line).toBe(true);
    }
  });

  it('does not count a heading, a signature or a blank', () => {
    // This is why it exists: "Ward 411 - S15 Medical" has digits in it, and counting
    // digits claimed four items on a note that has three.
    for (const line of ['Ward 411 - S15 Medical', 'Withdrawn', '- A. Rahman', 'checked by Fang', '   ']) {
      expect(looksLikeAnItemLine(line), line).toBe(false);
    }
  });

  it('agrees with the parser about what is a row', () => {
    const note = 'Ward 411 - S15 Medical\n3x Masks\n4x Syringes\n5x Saline\nWithdrawn\n- A. Rahman';
    const counted = note.split('\n').filter(looksLikeAnItemLine).length;
    expect(counted).toBe(parseWrittenList(note, CATALOGUE).lines.length);
  });
});

describe('assembleReadText', () => {
  it('is one line per recognised line, with the blanks dropped', () => {
    expect(assembleReadText([{ text: '3x Masks' }, { text: '  ' }, { text: '4x Syringes' }])).toBe(
      '3x Masks\n4x Syringes',
    );
  });
});

describe('applyDeviceReading', () => {
  const read: DeviceLine[] = [
    { text: '3x Masks', confidence: 0.9, bbox: [100, 200, 400, 250] },
    { text: '4x Syringes', confidence: 0.5, bbox: [100, 260, 420, 310] },
  ];

  function rowsFor(text: string): ResolvedLine[] {
    return applyDeviceReading(parseWrittenList(text, CATALOGUE).lines, read);
  }

  it('puts the engine geometry back on the rows it read', () => {
    const rows = rowsFor('3x Masks\n4x Syringes');
    expect(rows[0].bbox).toEqual([100, 200, 400, 250]);
    expect(rows[1].bbox).toEqual([100, 260, 420, 310]);
  });

  it('caps a row at how sure the engine was about the words', () => {
    // A perfect catalogue match on words the engine only half read is not a sure row.
    const rows = rowsFor('3x Masks\n4x Syringes');
    expect(rows[0].confidence).toBeCloseTo(0.9);
    expect(rows[1].confidence).toBeCloseTo(0.5);
    expect(rows[1].needsReview).toBe(true);
  });

  it('leaves a line the person retyped without a box', () => {
    // The box described handwriting the row no longer claims to be.
    const rows = rowsFor('3x Masks\n7x Saline');
    expect(rows[0].bbox).toEqual([100, 200, 400, 250]);
    expect(rows[1].bbox).toBeNull();
    expect(rows[1].itemId).toBe('saline');
    expect(rows[1].quantity).toBe(7);
  });

  it('never gives two rows the same box', () => {
    const rows = applyDeviceReading(parseWrittenList('3x Masks\n3x Masks', CATALOGUE).lines, [read[0]]);
    expect(rows[0].bbox).toEqual([100, 200, 400, 250]);
    expect(rows[1].bbox).toBeNull();
  });

  it('still matches a line whose spelling the person corrected', () => {
    // "Maske" -> "Masks" is the common fix, and it is the same line on the page.
    const rows = applyDeviceReading(parseWrittenList('3x Masks', CATALOGUE).lines, [
      { text: '3x Maske', confidence: 0.8, bbox: [10, 20, 30, 40] },
    ]);
    expect(rows[0].bbox).toEqual([10, 20, 30, 40]);
  });
});

describe('parseDeviceLines', () => {
  it('drops anything that is not a usable line', () => {
    expect(parseDeviceLines(null)).toEqual([]);
    expect(parseDeviceLines('3x Masks')).toEqual([]);
    expect(parseDeviceLines([{ text: '   ' }, null, 42])).toEqual([]);
  });

  it('clamps confidence and rejects an impossible box', () => {
    expect(
      parseDeviceLines([
        { text: 'a', confidence: 5, bbox: [0, 0, 10, 10] },
        { text: 'b', confidence: -1, bbox: [10, 10, 5, 5] },
        { text: 'c', bbox: 'nope' },
        { text: 'd', bbox: [0, 0, 5000, 5000] },
      ]),
    ).toEqual([
      { text: 'a', confidence: 1, bbox: [0, 0, 10, 10] },
      { text: 'b', confidence: 0, bbox: null },
      { text: 'c', confidence: 0, bbox: null },
      { text: 'd', confidence: 0, bbox: [0, 0, 1000, 1000] },
    ]);
  });
});
