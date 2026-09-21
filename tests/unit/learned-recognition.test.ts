import { describe, expect, it } from 'vitest';
import { evaluateCandidate } from '@/lib/decision/rules';
import { NO_RECOGNITION, type VisualRecognition } from '@/lib/vision/similarity';
import { resusCatalogue } from '../helpers/catalogue';

/**
 * What the LEARNED index is allowed to change, and what it is not.
 *
 * The one-line summary of this whole feature: learning improves the SUGGESTION and never
 * the AUTHORITY. Every test below is an instance of that, and the last block is the
 * invariant stated directly — no combination of score, example count and agreement count
 * produces a line that moves stock without a person.
 */
const catalogue = resusCatalogue();
const MASK = 'MASK-SURG-L2';
const GAUZE = 'GAUZE-10X10';

function found(overrides: Partial<VisualRecognition> = {}): VisualRecognition {
  return {
    ...NO_RECOGNITION,
    itemId: MASK,
    score: 0.91,
    matchedPhotoIds: ['photo-1', 'photo-2'],
    exampleCount: 4,
    timesAgreed: 14,
    strength: 'good',
    ...overrides,
  };
}

function seen(description: string, visual: VisualRecognition | null, quantity: number | null = 2) {
  return evaluateCandidate(
    {
      rawText: description,
      evidence: 'visible_item',
      proposedQuantity: quantity,
      proposedItemId: null,
      confidence: 0.95,
      status: 'high_confidence',
      reason: '',
    },
    catalogue,
    undefined,
    visual,
  );
}

describe('when the index and the description agree', () => {
  const outcome = seen('a blue pleated surgical mask with ear loops', found());

  it('keeps the item and still asks a person', () => {
    expect(outcome.matchedItemId).toBe(MASK);
    expect(outcome.decision).toBe('needs_review');
    expect(outcome.reasonCode).toBe('rule_8_visual_recognised');
  });

  it('says the match came from photos taken here, not from writing', () => {
    expect(outcome.message).toContain('matched against photos taken here, not read from writing');
  });

  it('states the familiarity count alongside the obligation to confirm', () => {
    // Never one without the other. A rising number read as a rising guarantee is how a
    // system that got better ends up being checked less.
    expect(outcome.message).toContain('Seen 14 times here before');
    expect(outcome.message).toContain('you still need to confirm it');
  });

  it('never puts a percentage in front of a nurse', () => {
    expect(outcome.message).not.toMatch(/\d+%|0\.\d+/);
  });
});

describe('when the index finds something the description did not', () => {
  it('proposes the learned item rather than giving up', () => {
    // The description matched no catalogue entry; without the index this line would have
    // arrived as "Cannot identify" and a dropdown of thirty items.
    const outcome = seen('a flat rectangular paper packet, mostly white', found());
    expect(outcome.matchedItemId).toBe(MASK);
    expect(outcome.decision).toBe('needs_review');
  });
});

describe('when the index and the description disagree', () => {
  const outcome = seen('gauze swabs 10x10', found({ itemId: MASK }));

  it('resolves nothing and offers both', () => {
    expect(outcome.matchedItemId).toBeNull();
    expect(outcome.suggestedItemIds).toEqual([MASK, GAUZE]);
    expect(outcome.reasonCode).toBe('rule_8_visual_disagreement');
  });

  it('names both readings so the nurse can tell which is which', () => {
    expect(outcome.message).toContain('Gauze');
    expect(outcome.message).toContain('mask');
  });
});

describe('when two items look the same in a photograph', () => {
  const outcome = seen('a white paper packet', found({ confusableWith: [GAUZE], strength: 'weak' }));

  it('says so and offers both rather than picking one', () => {
    expect(outcome.reasonCode).toBe('rule_8_visual_confusable');
    expect(outcome.suggestedItemIds).toEqual([MASK, GAUZE]);
  });

  it('tells the nurse what to look at instead', () => {
    expect(outcome.message).toContain('look the same in a photo');
    expect(outcome.message).toContain('Check the label');
  });

  it('drops a look-alike that is not stocked at this location', () => {
    // The recogniser is location-scoped, but a stale id must never reach a nurse as the
    // name of something this bay does not have.
    const stray = seen('a white paper packet', found({ confusableWith: ['NOT-STOCKED-HERE'] }));
    expect(stray.reasonCode).toBe('rule_8_visual_recognised');
  });
});

describe('with nothing learned yet', () => {
  it('falls back to the original behaviour, word for word', () => {
    const outcome = seen('surgical mask', null);
    expect(outcome.reasonCode).toBe('rule_8_visual_identification');
    expect(outcome.message).toContain('recognised from the photo, not read from writing');
  });

  it('treats an empty recognition the same as none at all', () => {
    expect(seen('surgical mask', NO_RECOGNITION).reasonCode).toBe('rule_8_visual_identification');
  });
});

describe('the quantity is always called out', () => {
  it('says so plainly when the count could not be read', () => {
    // Counting items in a pile is the weakest thing a vision model does, so this is on
    // every visual line rather than only when parsing failed.
    const outcome = seen('surgical mask', found(), null);
    expect(outcome.quantity).toBeNull();
    expect(outcome.message).toContain('The number could not be read');
  });

  it('asks for a check even when the count parsed cleanly', () => {
    expect(seen('surgical mask', found(), 3).message).toContain('Check the item and the count');
  });
});

describe('the invariant: learning never grants authority', () => {
  const extremes: VisualRecognition[] = [
    found(),
    found({ score: 1, exampleCount: 500, timesAgreed: 9999, strength: 'good' }),
    found({ confusableWith: [GAUZE] }),
    found({ itemId: GAUZE }),
    NO_RECOGNITION,
  ];

  it('never reaches "eligible", at any score or example count', () => {
    for (const visual of extremes) {
      for (const text of ['surgical mask', 'gauze swabs 10x10', 'a white packet', '']) {
        const outcome = seen(text, visual);
        expect(outcome.decision).not.toBe('eligible');
      }
    }
  });

  it('cannot turn a restricted item into a confirmable one', () => {
    // Recognising a controlled item perfectly is still a controlled item. The rule that
    // governs WHO may act outranks the one about what it is.
    const outcome = seen('morphine ampoule', found({ itemId: 'MORPH-10MG', score: 1, timesAgreed: 500 }));
    expect(outcome.decision).toBe('restricted');
  });

  it('is ignored entirely for a line that was written down', () => {
    // A photograph of a note is a piece of paper. "Which catalogue item does this note
    // look like?" is a question with no meaningful answer, so it is never asked.
    const written = evaluateCandidate(
      {
        rawText: '10x10 gauze',
        evidence: 'written_text',
        proposedQuantity: 2,
        proposedItemId: null,
        confidence: 0.95,
        status: 'high_confidence',
        reason: '',
      },
      catalogue,
      undefined,
      found({ itemId: MASK, score: 1 }),
    );
    expect(written.decision).toBe('eligible');
    expect(written.matchedItemId).toBe(GAUZE);
  });
});

describe('an ambiguous visual line', () => {
  // This description contains both "blue cannula" (the 18G's alias) and "22g cannula"
  // (the 22G's), so the matcher genuinely cannot separate them — which is the situation
  // worth testing rather than one contrived to produce it.
  const both = 'a blue 22g cannula in a plastic wrapper';

  it('puts the learned item first without resolving the ambiguity', () => {
    // A human still picks. The index only decides which button is nearest the thumb.
    const outcome = seen(both, found({ itemId: 'IVC-22G-BLUE' }));
    expect(outcome.decision).toBe('ambiguous');
    expect(outcome.matchedItemId).toBeNull();
    expect(outcome.suggestedItemIds[0]).toBe('IVC-22G-BLUE');
    expect(outcome.suggestedItemIds.length).toBeGreaterThan(1);
    expect(outcome.message).toContain('looks most like the first one');
  });

  it('leaves the order alone, and the wording, when nothing was learned', () => {
    const outcome = seen(both, null);
    expect(outcome.decision).toBe('ambiguous');
    expect(outcome.message).not.toContain('looks most like');
  });
});
