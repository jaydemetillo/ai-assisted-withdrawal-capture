import { describe, expect, it } from 'vitest';
import { inspectDocument } from '@/lib/decision/document';
import { evaluateCandidate } from '@/lib/decision/rules';
import { resusCatalogue } from '../helpers/catalogue';

/**
 * Four photographs taken during testing: three prescriptions and one supply note.
 *
 * The lines below are what a vision model would return for each — patient identifiers
 * deliberately excluded, because the prompt forbids transcribing them and a correct
 * reader would not emit them either.
 */
const catalogue = resusCatalogue();

function decide(rawText: string, quantity: number | null) {
  return evaluateCandidate(
    { rawText, evidence: 'written_text', proposedQuantity: quantity, proposedItemId: null, confidence: 0.93, status: 'high_confidence', reason: '' },
    catalogue,
  );
}

describe('a photographed prescription', () => {
  const lines: [string, number | null][] = [
    ['Betaloc 100mg - 1 tab BID', 1],
    ['Dorzolamidum 10 mg - 1 tab BID', 1],
    ['Cimetidine 50 mg - 2 tabs TID', 2],
    ['Oxprelol 50mg - 1 tab QD', 1],
    ['Amoxicillin 500mg Cap #21', 21],
    ['Amoxicillin + Clavulanic acid 500/125 mg/tab #21', 21],
    ['Paracetamol 500 mg/tab #5', 5],
  ];

  it('produces no confirmable withdrawal, line by line', () => {
    // This is the correct outcome, not a failure: none of these are stocked in a resus
    // cart, and this is an inventory workflow, not a dispensing one.
    for (const [text, qty] of lines) {
      expect(decide(text, qty).decision).toBe('unmatched');
    }
  });

  it('is recognised as a prescription so the screen can say why', () => {
    const hint = inspectDocument('Rx\nBetaloc 100mg - 1 tab BID\nSig: take one\nRefill 0 1 2 3');
    expect(hint.looksLikePrescription).toBe(true);
  });

  it('flags a page carrying patient fields', () => {
    const hint = inspectDocument('Name: ____  Address: ____  Age: 34  Sex: M\nRx\nAmoxicillin 500mg Cap #21');
    expect(hint.mayContainPatientDetails).toBe(true);
    expect(hint.looksLikePrescription).toBe(true);
  });

  it('does not cry wolf on an ordinary supply note', () => {
    const hint = inspectDocument('3x Mask\n4x Syringes\n5x Saline\nWithdrawn\nJay');
    expect(hint.looksLikePrescription).toBe(false);
    expect(hint.mayContainPatientDetails).toBe(false);
  });

  it('needs more than one marker before it calls something a prescription', () => {
    // "Rx" alone appears on plenty of supply paperwork. A warning on every note is a
    // warning nobody reads.
    expect(inspectDocument('Rx supplies cupboard').looksLikePrescription).toBe(false);
  });

  it('says nothing about an empty reading', () => {
    expect(inspectDocument(null)).toEqual({ looksLikePrescription: false, mayContainPatientDetails: false });
  });
});

describe('the supply note photographed on a desk', () => {
  // "3x Mask / 4x Syringes / 5x Saline / Withdrawn / Jay"
  it('matches every supply line, with options to choose from', () => {
    for (const [text, qty] of [['3x Mask', 3], ['4x Syringes', 4], ['5x Saline', 5]] as const) {
      const outcome = decide(text, qty);
      expect(outcome.decision).toBe('ambiguous');
      expect(outcome.suggestedItemIds.length).toBeGreaterThan(1);
    }
  });

  it('offers the closest item first, so the likely choice is the first button', () => {
    expect(decide('3x Mask', 3).suggestedItemIds[0]).toBe('MASK-SURG-L2');
    expect(decide('4x Syringes', 4).suggestedItemIds[0]).toBe('SYR-5ML');
    expect(decide('5x Saline', 5).suggestedItemIds[0]).toBe('NS-FLUSH-10ML');
  });

  it('ignores the heading and the signature', () => {
    expect(decide('Withdrawn', null).decision).toBe('unmatched');
    expect(decide('Jay', null).decision).toBe('unmatched');
  });

  it('becomes confirmable the moment the note names the item', () => {
    expect(decide('3x Surgical Mask', 3).decision).toBe('eligible');
    expect(decide('4x 10ml Syringes', 4).decision).toBe('eligible');
    expect(decide('5x Saline Flush', 5).decision).toBe('eligible');
  });
});
