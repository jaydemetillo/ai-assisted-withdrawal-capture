import { describe, expect, it } from 'vitest';
import { evaluateSubmission, type CandidateState, type SubmissionState } from '@/lib/decision/submission';
import { DEFAULT_DECISION_CONFIG } from '@/lib/decision/config';
import { resusCatalogue } from '../helpers/catalogue';

const catalogue = resusCatalogue();

function line(overrides: Partial<CandidateState> = {}): CandidateState {
  return {
    id: 'c1',
    sequence: 0,
    rawText: '18G blue cannula x1',
    decision: 'eligible',
    disposition: 'pending',
    matchedItemId: 'IVC-18G-BLUE',
    resolvedItemId: null,
    proposedQuantity: 1,
    resolvedQuantity: null,
    ...overrides,
  };
}

function submission(candidates: CandidateState[], status: SubmissionState['status'] = 'awaiting_review'): SubmissionState {
  return { status, candidates };
}

const asNurse = { actorRole: 'nurse' as const, catalogue, config: DEFAULT_DECISION_CONFIG };
const asReviewer = { actorRole: 'supply_reviewer' as const, catalogue, config: DEFAULT_DECISION_CONFIG };

describe('the happy path', () => {
  it('confirms a submission whose lines are all eligible, with no extra taps', () => {
    const result = evaluateSubmission(
      submission([
        line(),
        line({ id: 'c2', rawText: 'saline flush x2', matchedItemId: 'NS-FLUSH-10ML', proposedQuantity: 2 }),
      ]),
      asNurse,
    );
    expect(result.canConfirm).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.lines).toEqual([
      { candidateId: 'c1', itemId: 'IVC-18G-BLUE', quantity: 1 },
      { candidateId: 'c2', itemId: 'NS-FLUSH-10ML', quantity: 2 },
    ]);
  });
});

describe('an unresolved line blocks the whole submission', () => {
  it.each(['ambiguous', 'unmatched', 'unreadable', 'needs_review', 'restricted'] as const)(
    'blocks on a pending %s line',
    (decision) => {
      const result = evaluateSubmission(
        submission([line(), line({ id: 'c2', decision, matchedItemId: null, disposition: 'pending' })]),
        asNurse,
      );
      expect(result.canConfirm).toBe(false);
      expect(result.blockers.map((b) => b.code)).toContain(`unresolved_${decision}`);
    },
  );

  it('unblocks once a human has chosen an item and a quantity', () => {
    const result = evaluateSubmission(
      submission([
        line({
          decision: 'ambiguous',
          disposition: 'corrected',
          matchedItemId: null,
          resolvedItemId: 'IVC-22G-BLUE',
          resolvedQuantity: 1,
        }),
      ]),
      asNurse,
    );
    expect(result.canConfirm).toBe(true);
    expect(result.lines).toEqual([{ candidateId: 'c1', itemId: 'IVC-22G-BLUE', quantity: 1 }]);
  });

  it('a rejected line is resolved and simply moves no stock', () => {
    const result = evaluateSubmission(
      submission([line(), line({ id: 'c2', decision: 'unmatched', disposition: 'rejected', matchedItemId: null })]),
      asNurse,
    );
    expect(result.canConfirm).toBe(true);
    expect(result.lines).toHaveLength(1);
  });

  it('a line sent to supply review holds the submission', () => {
    const result = evaluateSubmission(submission([line({ disposition: 'escalated' })]), asNurse);
    expect(result.canConfirm).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('awaiting_supply_review');
  });
});

describe('restricted items are never a nurse to self-confirm', () => {
  const restricted = line({ rawText: 'morphine x1', decision: 'restricted', matchedItemId: 'MORPH-10MG' });

  it('blocks a nurse even after the line was resolved', () => {
    const result = evaluateSubmission(submission([{ ...restricted, disposition: 'confirmed' }]), asNurse);
    expect(result.canConfirm).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('restricted_requires_reviewer');
  });

  it('allows a supply reviewer to confirm it', () => {
    const result = evaluateSubmission(submission([{ ...restricted, disposition: 'confirmed' }]), asReviewer);
    expect(result.canConfirm).toBe(true);
    expect(result.lines).toEqual([{ candidateId: 'c1', itemId: 'MORPH-10MG', quantity: 1 }]);
  });

  it('only a deliberate configuration change lets a nurse through', () => {
    const result = evaluateSubmission(submission([{ ...restricted, disposition: 'confirmed' }]), {
      ...asNurse,
      config: { ...DEFAULT_DECISION_CONFIG, restrictedSelfConfirm: true },
    });
    expect(result.canConfirm).toBe(true);
  });

  it('blocks a high-risk item too, not just a controlled one', () => {
    const result = evaluateSubmission(
      submission([
        line({ rawText: 'defib pads x2', decision: 'restricted', matchedItemId: 'DEFIB-PADS-ADULT', disposition: 'confirmed', proposedQuantity: 2 }),
      ]),
      asNurse,
    );
    expect(result.canConfirm).toBe(false);
  });
});

describe('submission status', () => {
  it.each(['received', 'extracting', 'confirmed', 'cancelled', 'failed'] as const)(
    'refuses to confirm a %s submission',
    (status) => {
      const result = evaluateSubmission(submission([line()], status), asNurse);
      expect(result.canConfirm).toBe(false);
      expect(result.blockers.map((b) => b.code)).toContain('submission_not_reviewable');
    },
  );

  it('says plainly when a submission was already confirmed', () => {
    const result = evaluateSubmission(submission([line()], 'confirmed'), asNurse);
    expect(result.blockers[0]?.message).toContain('already been confirmed');
  });

  it('lets a reviewer confirm one that is in the supply-review queue', () => {
    expect(evaluateSubmission(submission([line()], 'in_supply_review'), asReviewer).canConfirm).toBe(true);
  });
});

describe('nothing to apply', () => {
  it('refuses an empty submission', () => {
    const result = evaluateSubmission(submission([]), asNurse);
    expect(result.canConfirm).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('nothing_to_apply');
  });

  it('refuses one where every line was rejected', () => {
    const result = evaluateSubmission(submission([line({ disposition: 'rejected' })]), asNurse);
    expect(result.canConfirm).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('nothing_to_apply');
  });
});

describe('a resolved line still has to make sense', () => {
  it('blocks when no item was chosen', () => {
    const result = evaluateSubmission(
      submission([line({ decision: 'unmatched', disposition: 'confirmed', matchedItemId: null })]),
      asNurse,
    );
    expect(result.blockers.map((b) => b.code)).toContain('no_item_selected');
  });

  it('blocks on a nonsensical quantity', () => {
    for (const quantity of [0, -1, 1.5, 999]) {
      const result = evaluateSubmission(
        submission([line({ disposition: 'corrected', resolvedQuantity: quantity })]),
        asNurse,
      );
      expect(result.blockers.map((b) => b.code)).toContain('invalid_quantity');
    }
  });

  it('blocks an item that is not in this location catalogue', () => {
    const result = evaluateSubmission(
      submission([line({ disposition: 'corrected', resolvedItemId: 'SOMETHING-ELSE', resolvedQuantity: 1 })]),
      asNurse,
    );
    expect(result.blockers.map((b) => b.code)).toContain('no_item_selected');
  });
});
