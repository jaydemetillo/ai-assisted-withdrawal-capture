export const ACTIONS = ['WITHDRAW', 'DISPOSE'] as const;
export type Action = (typeof ACTIONS)[number];

export const REASONS = ['EMERGENCY', 'FORGOT_TO_RECORD'] as const;
export type Reason = (typeof REASONS)[number];

export const REASON_LABELS: Record<Reason, { title: string; blurb: string }> = {
  EMERGENCY: { title: 'Emergency', blurb: 'I need to capture items urgently' },
  FORGOT_TO_RECORD: { title: 'Forgot to Record', blurb: 'I forgot to log my activity earlier' },
};

/**
 * Withdrawal and disposal do the same arithmetic - both subtract - but they are
 * different events to an auditor, so every user-facing string is kept apart here
 * rather than branching on the action inside components.
 */
export const ACTION_COPY: Record<
  Action,
  { verb: string; past: string; noun: string; sentence: string; columnHeader: string }
> = {
  WITHDRAW: {
    verb: 'Withdraw',
    past: 'Withdrawn',
    noun: 'withdrawal',
    sentence: 'taken from the storeroom for use',
    columnHeader: 'Withdrawn',
  },
  DISPOSE: {
    verb: 'Dispose',
    past: 'Disposed',
    noun: 'disposal',
    sentence: 'removed from the storeroom and discarded',
    columnHeader: 'Disposed',
  },
};

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export function isReason(value: unknown): value is Reason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value);
}

/** Confidence at or below this routes a line to the review screen instead of being trusted. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
