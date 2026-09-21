import type { LocationCatalogue } from '@/lib/domain/catalogue';
import { isRestricted, itemById } from '@/lib/domain/catalogue';
import { DEFAULT_DECISION_CONFIG, type DecisionConfig } from '@/lib/decision/config';
import type { DecisionValue } from '@/lib/decision/rules';

/**
 * Submission-level confirmability — also pure, also deterministic.
 *
 * The review screen disables the Confirm button using this. The confirm endpoint then
 * runs the SAME function again server-side against freshly read data. The client-side
 * disable is a courtesy; this is the control.
 *
 * Specified in docs/safety-and-decision-rules.md §4.
 */

export type DispositionValue = 'pending' | 'confirmed' | 'corrected' | 'rejected' | 'escalated' | 'applied';
export type ActorRole = 'nurse' | 'supply_reviewer' | 'admin';
export type SubmissionStatusValue =
  | 'received'
  | 'extracting'
  | 'awaiting_review'
  | 'in_supply_review'
  | 'confirmed'
  | 'cancelled'
  | 'failed';

export type CandidateState = {
  id: string;
  sequence: number;
  rawText: string;
  decision: DecisionValue;
  disposition: DispositionValue;
  /** What our matcher concluded. */
  matchedItemId: string | null;
  /** What a human chose, if they chose. Wins over matchedItemId. */
  resolvedItemId: string | null;
  proposedQuantity: number | null;
  resolvedQuantity: number | null;
};

export type SubmissionState = {
  status: SubmissionStatusValue;
  candidates: CandidateState[];
};

export type ConfirmableLine = {
  candidateId: string;
  itemId: string;
  quantity: number;
};

export type Blocker = {
  candidateId: string | null;
  code: string;
  message: string;
};

export type SubmissionEvaluation = {
  canConfirm: boolean;
  lines: ConfirmableLine[];
  blockers: Blocker[];
};

/**
 * A candidate stops blocking when a human has dealt with it — or when the rules already
 * found it unambiguous, in which case the act of pressing Confirm IS the human decision.
 * That is what keeps the happy path one tap: an eligible line needs no separate approval.
 */
function isResolved(c: CandidateState): boolean {
  if (c.disposition === 'confirmed' || c.disposition === 'corrected' || c.disposition === 'rejected') {
    return true;
  }
  if (c.disposition === 'applied') return true;
  return c.disposition === 'pending' && c.decision === 'eligible';
}

export function evaluateSubmission(
  submission: SubmissionState,
  options: { actorRole: ActorRole; catalogue: LocationCatalogue; config?: DecisionConfig },
): SubmissionEvaluation {
  const config = options.config ?? DEFAULT_DECISION_CONFIG;
  const blockers: Blocker[] = [];
  const lines: ConfirmableLine[] = [];

  if (submission.status !== 'awaiting_review' && submission.status !== 'in_supply_review') {
    blockers.push({
      candidateId: null,
      code: 'submission_not_reviewable',
      message:
        submission.status === 'confirmed'
          ? 'This withdrawal has already been confirmed.'
          : `This submission cannot be confirmed while it is "${submission.status}".`,
    });
  }

  for (const candidate of submission.candidates) {
    if (candidate.disposition === 'rejected') continue; // resolved, and moves no stock

    // Checked before the general unresolved case so the nurse is told where the line
    // actually is, rather than being asked to decide something already handed over.
    if (candidate.disposition === 'escalated') {
      blockers.push({
        candidateId: candidate.id,
        code: 'awaiting_supply_review',
        message: `"${candidate.rawText}" is with supply review.`,
      });
      continue;
    }

    if (!isResolved(candidate)) {
      blockers.push({
        candidateId: candidate.id,
        code: `unresolved_${candidate.decision}`,
        message: `"${candidate.rawText}" still needs a decision before anything can be confirmed.`,
      });
      continue;
    }

    const itemId = candidate.resolvedItemId ?? candidate.matchedItemId;
    const item = itemById(options.catalogue, itemId);
    if (!item) {
      blockers.push({
        candidateId: candidate.id,
        code: 'no_item_selected',
        message: `"${candidate.rawText}" has no item chosen.`,
      });
      continue;
    }

    const quantity = candidate.resolvedQuantity ?? candidate.proposedQuantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > config.maxLineQuantity
    ) {
      blockers.push({
        candidateId: candidate.id,
        code: 'invalid_quantity',
        message: `${item.displayName} has no usable quantity.`,
      });
      continue;
    }

    // A controlled or high-risk line is never a nurse's to self-confirm while
    // RESTRICTED_SELF_CONFIRM is off — not even one a reviewer has already corrected,
    // because the sign-off is the reviewer's to give, on the reviewer's own action.
    if (isRestricted(item) && options.actorRole === 'nurse' && !config.restrictedSelfConfirm) {
      blockers.push({
        candidateId: candidate.id,
        code: 'restricted_requires_reviewer',
        message: `${item.displayName} is controlled or high-risk. Supply review must confirm this one.`,
      });
      continue;
    }

    lines.push({ candidateId: candidate.id, itemId: item.id, quantity });
  }

  if (lines.length === 0 && blockers.length === 0) {
    blockers.push({
      candidateId: null,
      code: 'nothing_to_apply',
      message: 'There is nothing left to withdraw on this submission.',
    });
  }

  return { canConfirm: blockers.length === 0 && lines.length > 0, lines, blockers };
}
