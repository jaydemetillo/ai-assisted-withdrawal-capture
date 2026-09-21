import * as z from 'zod';

/**
 * The contract every extraction provider must satisfy. This schema is the trust
 * boundary: whatever a provider returns is parsed with it before any other code sees
 * it, and a parse failure fails the extraction loudly rather than being coerced into
 * something plausible.
 *
 * Note what is NOT in here: no patient field, no free text beyond what was read off the
 * page, no instruction the provider can give the application. A provider proposes; it
 * never decides.
 */
export const providerStatusSchema = z.enum([
  'high_confidence',
  'ambiguous',
  'unmatched',
  'unreadable',
  'restricted',
]);

/**
 * Where a line came from.
 *
 * `written_text` — somebody wrote it down. That is a human assertion of what they took,
 * and our own matcher verifies it against the catalogue independently.
 *
 * `visible_item` — the model recognised the thing itself in the photograph: a used pack,
 * a wrapper, a drawer of stock. Nobody asserted anything, and there is no text for our
 * matcher to check. Weaker evidence, and the rules treat it as such.
 *
 * Defaults to `written_text` so a provider that does not set it keeps working.
 */
export const evidenceKindSchema = z.enum(['written_text', 'visible_item']).default('written_text');

/**
 * Where the line is in the picture, as four fractions of the PREPARED image — the bytes
 * the provider was actually given, after EXIF rotation and resizing. Never pixels: see
 * the frame discussion at the top of lib/vision/boxes.ts for why pixels cannot be drawn.
 *
 * Optional, and a provider that omits it loses nothing but the overlay. A box is a
 * pointer at the evidence; it is not evidence, and it never makes a line confirmable.
 */
export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const extractionCandidateSchema = z.object({
  /** The words on the page, or — for a visual identification — what was seen. */
  rawText: z.string(),
  evidence: evidenceKindSchema,
  proposedQuantity: z.number().int().positive().nullable(),
  proposedItemId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  status: providerStatusSchema,
  reason: z.string(),
  /**
   * Optional AND nullable: a provider may omit it, or say "I could not localise this"
   * explicitly, and both mean the same thing to everything downstream. Out-of-range and
   * inverted boxes are not rejected here — they are repaired or dropped by
   * `normaliseBox`, because a bad rectangle should cost the overlay, not the reading.
   */
  box: boundingBoxSchema.nullish(),
});

export const extractionResultSchema = z.object({
  rawText: z.string(),
  candidates: z.array(extractionCandidateSchema),
});

export type EvidenceKindValue = z.infer<typeof evidenceKindSchema>;
export type ProviderStatusValue = z.infer<typeof providerStatusSchema>;
export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
