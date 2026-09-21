import { describe, expect, it } from 'vitest';
import { evaluateCandidate } from '@/lib/decision/rules';
import { distinctMatchedItems, matchPhrase } from '@/lib/catalogue/match';
import { MockExtractionProvider } from '@/lib/extraction/mock';
import { buildExtractionContext } from '@/lib/extraction/provider';
import { resusCatalogue } from '../helpers/catalogue';

/**
 * Photographing the items themselves, with no writing.
 *
 * The evidence is weaker than handwriting: a written line is a person's own record of
 * what they took, checked independently against the catalogue. A visual identification is
 * one opinion about a photograph with nothing to verify it. The rules treat it that way.
 */
const catalogue = resusCatalogue();

function seen(description: string, quantity: number | null = 1, confidence = 0.95) {
  return evaluateCandidate(
    { rawText: description, evidence: 'visible_item', proposedQuantity: quantity, proposedItemId: null, confidence, status: 'high_confidence', reason: '' },
    catalogue,
  );
}

function written(text: string, quantity: number | null = 1) {
  return evaluateCandidate(
    { rawText: text, evidence: 'written_text', proposedQuantity: quantity, proposedItemId: null, confidence: 0.95, status: 'high_confidence', reason: '' },
    catalogue,
  );
}

describe('a visual identification is never confirmable on its own', () => {
  it('caps at needs_review even on a perfect match at full confidence', () => {
    const outcome = seen('surgical mask', 1, 1);
    expect(outcome.decision).toBe('needs_review');
    expect(outcome.reasonCode).toBe('rule_8_visual_identification');
    expect(outcome.matchedItemId).toBe('MASK-SURG-L2');
  });

  it('says so in words a nurse can act on', () => {
    expect(seen('surgical mask').message).toContain('recognised from the photo');
    expect(seen('surgical mask').message).toContain('Check the item and the count');
  });

  it('the identical text, written down, IS confirmable', () => {
    // The difference is not the words. It is that somebody wrote them.
    expect(written('surgical mask').decision).toBe('eligible');
  });

  it('a restricted item stays restricted, not merely needing review', () => {
    expect(seen('morphine ampoule').decision).toBe('restricted');
    expect(seen('adrenaline prefilled syringe').decision).toBe('restricted');
  });

  it('an ambiguous sight stays ambiguous', () => {
    expect(seen('gauze swabs').decision).toBe('ambiguous');
  });
});

describe('matching a description rather than a transcription', () => {
  const skus = (text: string, prose: boolean) =>
    distinctMatchedItems(matchPhrase(text, catalogue, { prose }).matches).map((i) => i.sku);

  it('finds a catalogue entry inside a sentence', () => {
    // The forward test fails here: "pleated", "ear" and "loops" are in no catalogue entry.
    expect(skus('blue pleated surgical mask with ear loops', false)).toEqual([]);
    expect(skus('blue pleated surgical mask with ear loops', true)).toEqual(['MASK-SURG-L2']);
  });

  it.each([
    ['IV giving set with roller clamp and drip chamber', 'GIVING-SET-STD'],
    ['white roll of microporous tape', 'TAPE-MICRO-25'],
    ['a transparent IV dressing still in its wrapper', 'DRESS-IV-TRANSP'],
  ])('%s → %s', (description, sku) => {
    expect(skus(description, true)).toContain(sku);
  });

  it('ignores single-word catalogue entries, which would fire on any sentence', () => {
    // "pads", "bvm", "npa" and "micropore" are all one word. Matching those inside prose
    // would attach an item to almost every description.
    expect(skus('the patient was moved onto absorbent pads and blankets', true)).toEqual([]);
  });

  it('does not change how written text is matched', () => {
    // Prose mode is only ever enabled for visual evidence; handwriting is unaffected.
    expect(skus('3x mask', false)).toEqual(skus('3x mask', true));
    expect(written('18G blue cannula x1').decision).toBe('eligible');
  });
});

describe('what a photograph of loose items actually yields', () => {
  // Four real photographs of trays of supplies, described as a vision model would.
  const lines = [
    'blue nitrile examination gloves, one pair, size not visible',
    'luer slip syringe with graduations, barrel size not legible',
    'blood collection tubes, purple and blue tops, in a rack',
    'Foley catheter with inflation balloon',
    'blue pleated surgical mask with ear loops',
    'IV giving set with roller clamp and drip chamber',
    'white roll of microporous tape',
  ];

  it('never produces a single auto-confirmable line', () => {
    // The headline property. A photograph of a pile of stock is a good prompt for a
    // human, and never a stock movement on its own.
    for (const line of lines) {
      expect(seen(line).decision).not.toBe('eligible');
    }
  });

  it('leaves genuinely indistinguishable items unmatched rather than guessing', () => {
    // A glove with no visible size could be the medium or the large; a syringe with an
    // illegible barrel could be either size. Guessing would be worse than asking.
    expect(seen('blue nitrile examination gloves, one pair, size not visible').matchedItemId).toBeNull();
    expect(seen('luer slip syringe with graduations, barrel size not legible').matchedItemId).toBeNull();
  });

  it('identifies the ones that are genuinely distinctive', () => {
    expect(seen('blue pleated surgical mask with ear loops').matchedItemId).toBe('MASK-SURG-L2');
    expect(seen('IV giving set with roller clamp and drip chamber').matchedItemId).toBe('GIVING-SET-STD');
  });

  it('an unknown count is carried through as unknown', () => {
    // Counting a pile in a photograph is the thing a model gets wrong most often.
    const outcome = seen('several gauze swabs, overlapping', null);
    expect(outcome.quantity).toBeNull();
    expect(outcome.decision).not.toBe('eligible');
  });
});

describe('the offline demo scenario', () => {
  it('shows what a photo of items looks like, and needs review', async () => {
    const provider = new MockExtractionProvider();
    const result = await provider.extract(
      { key: 'k.jpg', mediaType: 'image/jpeg', data: Buffer.from('x') },
      buildExtractionContext(catalogue, 'visible_items'),
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.evidence === 'visible_item')).toBe(true);
    // No writing on the page, so no transcript.
    expect(result.rawText).toBe('');

    for (const candidate of result.candidates) {
      expect(evaluateCandidate(candidate, catalogue).decision).toBe('needs_review');
    }
  });
});
