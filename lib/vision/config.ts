import * as z from 'zod';

/**
 * Every threshold the recogniser uses, in one place, read from the environment.
 *
 * These numbers are provider-dependent and that is the single most important thing to
 * know about them. A cosine of 0.80 means "probably the same pack" for the built-in
 * descriptor and "probably unrelated" for CLIP, because they are different coordinate
 * spaces with different score distributions. The defaults below are measured against the
 * built-in descriptor. **Switching to `EMBEDDING_PROVIDER=transformers` means re-tuning
 * these**, and because the index is re-taught from scratch on a provider change anyway,
 * that is a good moment to do it.
 *
 * Mirrored in .env.example and docs/visual-recognition.md.
 */
export type VisionConfig = {
  /** Below this cosine, a neighbour is not evidence of anything and is ignored. */
  matchFloor: number;
  /** At or above this — and clear of the runner-up — recognition reads as settled. */
  confidentAt: number;
  /**
   * Two different items whose best scores are within this of each other are not
   * separable by sight. The system says so rather than picking one.
   */
  confusableMargin: number;
  /** Active examples per item per location. The cap is the plateau, made explicit. */
  maxExamplesPerItem: number;
  /** Examples below this count read as "still learning" rather than "good". */
  confidentExampleCount: number;
  /** After this many days an example is down-weighted and flagged for review. */
  staleAfterDays: number;
  /** What a stale example's score is multiplied by. */
  staleWeight: number;
  /** Overrules before an example quarantines itself. */
  overruleLimit: number;
};

export const DEFAULT_VISION_CONFIG: VisionConfig = {
  matchFloor: 0.72,
  confidentAt: 0.84,
  confusableMargin: 0.05,
  maxExamplesPerItem: 12,
  confidentExampleCount: 3,
  staleAfterDays: 365,
  staleWeight: 0.9,
  overruleLimit: 3,
};

const envSchema = z.object({
  VISION_MATCH_FLOOR: z.coerce.number().min(0).max(1).optional(),
  VISION_CONFIDENT_AT: z.coerce.number().min(0).max(1).optional(),
  VISION_CONFUSABLE_MARGIN: z.coerce.number().min(0).max(1).optional(),
  VISION_MAX_EXAMPLES: z.coerce.number().int().min(1).max(100).optional(),
  VISION_CONFIDENT_EXAMPLES: z.coerce.number().int().min(1).max(50).optional(),
  VISION_STALE_AFTER_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
  VISION_STALE_WEIGHT: z.coerce.number().min(0).max(1).optional(),
  VISION_OVERRULE_LIMIT: z.coerce.number().int().min(1).max(50).optional(),
});

export type EnvLike = Record<string, string | undefined>;

/** Parse the thresholds, refusing to start on a malformed value rather than defaulting. */
export function loadVisionConfig(env: EnvLike = process.env): VisionConfig {
  const parsed = envSchema.safeParse({
    VISION_MATCH_FLOOR: env.VISION_MATCH_FLOOR || undefined,
    VISION_CONFIDENT_AT: env.VISION_CONFIDENT_AT || undefined,
    VISION_CONFUSABLE_MARGIN: env.VISION_CONFUSABLE_MARGIN || undefined,
    VISION_MAX_EXAMPLES: env.VISION_MAX_EXAMPLES || undefined,
    VISION_CONFIDENT_EXAMPLES: env.VISION_CONFIDENT_EXAMPLES || undefined,
    VISION_STALE_AFTER_DAYS: env.VISION_STALE_AFTER_DAYS || undefined,
    VISION_STALE_WEIGHT: env.VISION_STALE_WEIGHT || undefined,
    VISION_OVERRULE_LIMIT: env.VISION_OVERRULE_LIMIT || undefined,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid visual-recognition configuration — ${detail}`);
  }

  const e = parsed.data;
  const config: VisionConfig = {
    matchFloor: e.VISION_MATCH_FLOOR ?? DEFAULT_VISION_CONFIG.matchFloor,
    confidentAt: e.VISION_CONFIDENT_AT ?? DEFAULT_VISION_CONFIG.confidentAt,
    confusableMargin: e.VISION_CONFUSABLE_MARGIN ?? DEFAULT_VISION_CONFIG.confusableMargin,
    maxExamplesPerItem: e.VISION_MAX_EXAMPLES ?? DEFAULT_VISION_CONFIG.maxExamplesPerItem,
    confidentExampleCount: e.VISION_CONFIDENT_EXAMPLES ?? DEFAULT_VISION_CONFIG.confidentExampleCount,
    staleAfterDays: e.VISION_STALE_AFTER_DAYS ?? DEFAULT_VISION_CONFIG.staleAfterDays,
    staleWeight: e.VISION_STALE_WEIGHT ?? DEFAULT_VISION_CONFIG.staleWeight,
    overruleLimit: e.VISION_OVERRULE_LIMIT ?? DEFAULT_VISION_CONFIG.overruleLimit,
  };

  // A floor above the confident line would mean nothing can ever be merely "learning":
  // every match would arrive already confident. Catching it here beats discovering it
  // from a screen full of items that all claim to be settled.
  if (config.matchFloor > config.confidentAt) {
    throw new Error(
      `Invalid visual-recognition configuration — VISION_MATCH_FLOOR (${config.matchFloor}) must not be above VISION_CONFIDENT_AT (${config.confidentAt}).`,
    );
  }

  return config;
}
