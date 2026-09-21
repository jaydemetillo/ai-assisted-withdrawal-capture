import * as z from 'zod';

/**
 * Every business rule that a deployment might legitimately want to set differently,
 * in one place, read from the environment, with a documented default.
 *
 * Mirrored in .env.example and docs/safety-and-decision-rules.md. If you add one here,
 * add it there too — a threshold nobody can find is a threshold nobody reviews.
 */
export const negativeStockPolicies = ['allow_with_discrepancy', 'block'] as const;
export type NegativeStockPolicy = (typeof negativeStockPolicies)[number];

export type DecisionConfig = {
  /** Below this, a candidate needs review no matter what the provider claimed. */
  confidenceThreshold: number;
  /** Above this, a line needs review — guards a misread "1" as "100". */
  maxLineQuantity: number;
  /** What happens when the requested quantity exceeds stock on hand. */
  negativeStockPolicy: NegativeStockPolicy;
  /** Whether a nurse may confirm a controlled or high-risk line themselves. */
  restrictedSelfConfirm: boolean;
  /** Optimistic-locking retries before a confirmation fails rather than half-applying. */
  confirmMaxRetries: number;
};

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  confidenceThreshold: 0.9,
  maxLineQuantity: 50,
  negativeStockPolicy: 'allow_with_discrepancy',
  restrictedSelfConfirm: false,
  confirmMaxRetries: 3,
};

const booleanish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => ['true', 'false', '1', '0', 'yes', 'no'].includes(v), {
    message: 'expected a boolean like "true" or "false"',
  })
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  MAX_LINE_QUANTITY: z.coerce.number().int().positive().optional(),
  NEGATIVE_STOCK_POLICY: z.enum(negativeStockPolicies).optional(),
  RESTRICTED_SELF_CONFIRM: booleanish.optional(),
  CONFIRM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).optional(),
});

/**
 * Parse configuration, failing loudly on a malformed value.
 *
 * A typo in CONFIDENCE_THRESHOLD silently falling back to a default would mean a
 * deployment running safety rules nobody intended. Better to refuse to start.
 */
/** A plain map rather than NodeJS.ProcessEnv, so tests can pass exactly the keys under test. */
export type EnvLike = Record<string, string | undefined>;

export function loadDecisionConfig(env: EnvLike = process.env): DecisionConfig {
  const parsed = envSchema.safeParse({
    CONFIDENCE_THRESHOLD: env.CONFIDENCE_THRESHOLD || undefined,
    MAX_LINE_QUANTITY: env.MAX_LINE_QUANTITY || undefined,
    NEGATIVE_STOCK_POLICY: env.NEGATIVE_STOCK_POLICY || undefined,
    RESTRICTED_SELF_CONFIRM: env.RESTRICTED_SELF_CONFIRM || undefined,
    CONFIRM_MAX_RETRIES: env.CONFIRM_MAX_RETRIES || undefined,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid decision-rule configuration — ${detail}`);
  }

  const e = parsed.data;
  return {
    confidenceThreshold: e.CONFIDENCE_THRESHOLD ?? DEFAULT_DECISION_CONFIG.confidenceThreshold,
    maxLineQuantity: e.MAX_LINE_QUANTITY ?? DEFAULT_DECISION_CONFIG.maxLineQuantity,
    negativeStockPolicy: e.NEGATIVE_STOCK_POLICY ?? DEFAULT_DECISION_CONFIG.negativeStockPolicy,
    restrictedSelfConfirm: e.RESTRICTED_SELF_CONFIRM ?? DEFAULT_DECISION_CONFIG.restrictedSelfConfirm,
    confirmMaxRetries: e.CONFIRM_MAX_RETRIES ?? DEFAULT_DECISION_CONFIG.confirmMaxRetries,
  };
}
