import { createHash } from 'node:crypto';
import type { CatalogueEntry, OcrOutcome, OcrResult } from '@/lib/ocr/types';
import { matchItem } from '@/lib/ocr/match';

/**
 * Offline stand-in for the vision call, used whenever ANTHROPIC_API_KEY is unset.
 *
 * It exists so the whole product - capture, review, commit, stock movement, evidence
 * modal - can be demoed and tested with no key and no network. It is NOT an OCR
 * implementation: it returns canned readings. The UI labels any capture it produced as
 * "Demo OCR" so nobody mistakes a fixture for a real read.
 */

type MockNote = { slug: string; documentAction: OcrResult['documentAction']; actionEvidence: string; transcript: string; lines: { rawText: string; quantity: number | null; itemGuess: string; confidence: number; bbox: [number, number, number, number] }[] };

const NOTES: MockNote[] = [
  {
    slug: 'withdraw-basic',
    documentAction: 'withdraw',
    actionEvidence: 'Withdrawn',
    transcript: 'Ward 411 - S15 Medical\n\n3x Masks\n4x Syringes\n5x Saline\n\nWithdrawn\n- A. Rahman',
    lines: [
      { rawText: '3x Masks', quantity: 3, itemGuess: 'Masks', confidence: 0.95, bbox: [126, 236, 330, 282] },
      { rawText: '4x Syringes', quantity: 4, itemGuess: 'Syringes', confidence: 0.93, bbox: [130, 288, 355, 334] },
      { rawText: '5x Saline', quantity: 5, itemGuess: 'Saline', confidence: 0.94, bbox: [126, 340, 320, 386] },
    ],
  },
  {
    slug: 'dispose-expired',
    documentAction: 'dispose',
    actionEvidence: 'DISPOSED - expired batch',
    transcript: '12 x Gauze pads\n2 x ETCO2 sensor\n6 x Alcohol swabs\n\nDISPOSED - expired batch\nchecked by Fang',
    lines: [
      { rawText: '12 x Gauze pads', quantity: 12, itemGuess: 'Gauze pads', confidence: 0.92, bbox: [128, 128, 430, 172] },
      { rawText: '2 x ETCO2 sensor', quantity: 2, itemGuess: 'ETCO2 sensor', confidence: 0.89, bbox: [128, 180, 448, 224] },
      { rawText: '6 x Alcohol swabs', quantity: 6, itemGuess: 'Alcohol swabs', confidence: 0.91, bbox: [128, 232, 462, 276] },
    ],
  },
  {
    slug: 'messy-mixed',
    documentAction: 'withdraw',
    actionEvidence: 'taken out for ward round / withdrawn',
    transcript: 'Gloves (M) x 2 boxes\nSyringe 10ml  - 8\nNS 500ml ...... 3\nECG electrodes x10\n\ntaken out for ward round\nwithdrawn',
    lines: [
      { rawText: 'Gloves (M) x 2 boxes', quantity: 2, itemGuess: 'Gloves (M)', confidence: 0.88, bbox: [122, 130, 470, 176] },
      { rawText: 'Syringe 10ml  - 8', quantity: 8, itemGuess: 'Syringe 10ml', confidence: 0.9, bbox: [122, 186, 415, 230] },
      { rawText: 'NS 500ml ...... 3', quantity: 3, itemGuess: 'NS 500ml', confidence: 0.72, bbox: [122, 240, 400, 284] },
      { rawText: 'ECG electrodes x10', quantity: 10, itemGuess: 'ECG electrodes', confidence: 0.91, bbox: [122, 294, 452, 338] },
    ],
  },
  {
    slug: 'low-confidence',
    documentAction: 'withdraw',
    actionEvidence: 'withdrawn',
    transcript: '4 x thermmtr prb cvrs\n2 x foly cath 16\n?? x biohzd bags\n\nwithdrawn',
    lines: [
      { rawText: '4 x thermmtr prb cvrs', quantity: 4, itemGuess: 'thermmtr prb cvrs', confidence: 0.64, bbox: [148, 118, 540, 158] },
      { rawText: '2 x foly cath 16', quantity: 2, itemGuess: 'foly cath 16', confidence: 0.69, bbox: [148, 170, 425, 210] },
      { rawText: '?? x biohzd bags', quantity: null, itemGuess: 'biohzd bags', confidence: 0.41, bbox: [148, 222, 428, 262] },
    ],
  },
];

export const MOCK_NOTE_SLUGS = NOTES.map((n) => n.slug);

/**
 * Pick a canned note. An explicit slug wins (the "Use a sample note" button passes one);
 * otherwise we hash the image so the same photo always yields the same reading, which
 * keeps the demo stable and makes test failures reproducible.
 */
function pickNote(image: Buffer, slug?: string): MockNote {
  if (slug) {
    const named = NOTES.find((n) => n.slug === slug);
    if (named) return named;
  }
  const digest = createHash('sha256').update(image).digest();
  return NOTES[digest[0] % NOTES.length];
}

export function mockHandwriting(image: Buffer, catalogue: CatalogueEntry[], slug?: string): OcrOutcome {
  const note = pickNote(image, slug);

  return {
    provider: 'mock',
    model: 'demo-fixture',
    result: {
      documentAction: note.documentAction,
      actionEvidence: note.actionEvidence,
      transcript: note.transcript,
      // Resolve the SKU through the same matcher the real path uses, so the mock cannot
      // accidentally "pass" a matching bug that the live path would hit.
      lines: note.lines.map((line) => ({
        rawText: line.rawText,
        quantity: line.quantity,
        itemGuess: line.itemGuess,
        sku: matchItem(line.itemGuess, catalogue)?.entry.sku ?? null,
        confidence: line.confidence,
        bbox: line.bbox,
      })),
    },
  };
}
