import { log } from '@/lib/log';
import { normaliseBox, pixelRegion, widenForCrop, type NormalisedBox } from '@/lib/vision/boxes';
import { loadVisionConfig } from '@/lib/vision/config';
import { embeddingProvider, visualRecognitionEnabled } from '@/lib/vision/embedding';
import { loadIndex } from '@/lib/vision/reference-photos';
import { recognise, type ReferenceVector, type VisualRecognition } from '@/lib/vision/similarity';

/**
 * Recognise a submitted photograph against one location's learned examples.
 *
 * The seam between the pure matching in lib/vision/similarity.ts and the world: this is
 * where the database and the model live, so that one stays testable without either.
 *
 * ## What may be recognised, and why it used to be so little
 *
 * An embedding describes a WHOLE IMAGE. A photo of one chest seal on a bench embeds to
 * "chest seal on a bench"; a photo of a tray holding four different things embeds to "a
 * tray holding four different things", which is near none of the four. Attributing that
 * one vector to one of four lines would be a coin toss dressed up as a match, so until
 * there were boxes the recogniser simply refused every multi-item photo — which is most
 * real photos, and meant the system learned almost nothing from normal use.
 *
 * A bounding box removes the ambiguity entirely. With one, the crop is the item, the
 * vector describes the item, and four lines on a tray become four honest recognitions
 * and, on confirmation, four training examples. That is the whole reason boxes were
 * worth building, and it is considerably more valuable than the overlay they also make
 * possible.
 *
 * So each line is recognised on one of three bases:
 *
 *  - `crop` — it has a usable box. Crop, embed the crop, match. Any number of lines.
 *  - `whole_image` — no box, but it is the ONLY thing in the picture, so the whole image
 *    unambiguously is that item. The pre-box behaviour, kept because a provider that
 *    cannot localise should not lose recognition it could previously do.
 *  - `none` — anything else. No guess.
 *
 * None of this changes authority. Every visual line is `needs_review` by rule 8b, with or
 * without a box, at any score. A box says WHERE to look, never whether to trust.
 */

/** Why a line can, or cannot, be matched against the index. */
export type RecognitionBasis = 'crop' | 'whole_image' | 'none';

export type RecognisableLine = {
  /** Anything stable that identifies the line to the caller — sequence, id, key. */
  key: string;
  evidence: string;
  /** Whatever the provider returned. Validated here, not trusted. */
  box: unknown;
};

/**
 * Decide how a line may be recognised, given what else is in the photograph.
 *
 * Pure and exported so the rule can be read and tested on its own — it is the guard that
 * stops a whole-tray vector being filed against whichever line happened to come first.
 */
export function recognitionBasis(line: RecognisableLine, all: readonly RecognisableLine[]): RecognitionBasis {
  if (line.evidence !== 'visible_item') return 'none';
  if (normaliseBox(line.box)) return 'crop';
  return all.length === 1 ? 'whole_image' : 'none';
}

/** The callable factory, not the namespace — that is what `sharp(buffer)` needs. */
type SharpFactory = (typeof import('sharp'))['default'];

let sharpModule: SharpFactory | null | undefined;

async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

/**
 * Cut one item out of the photograph.
 *
 * `.rotate()` comes first and is not optional. The box is in the PREPARED frame, which is
 * EXIF-upright; the stored bytes are the phone's originals, which may carry "rotate 90°"
 * as metadata rather than in the pixels. Cropping the unrotated bytes with upright
 * coordinates cuts out a region at right angles to the item — the overlay bug, moved into
 * the training data where nobody would ever see it.
 *
 * Done in two passes because sharp reports metadata for the source, not for the rotated
 * result, and the dimensions swap under a 90° orientation. Two passes over a photo this
 * size is not worth optimising into a class of bug that silently poisons the index.
 */
export async function cropToBox(data: Buffer, box: NormalisedBox): Promise<Buffer | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;

  try {
    const upright = await sharp(data, { failOn: 'none' }).rotate().toBuffer();
    const meta = await sharp(upright).metadata();
    if (!meta.width || !meta.height) return null;

    const region = pixelRegion(widenForCrop(box), { width: meta.width, height: meta.height });
    return await sharp(upright).extract(region).toBuffer();
  } catch (error) {
    log.warn('could not crop to a box', { reason: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/**
 * Match every line that can honestly be matched, in one pass over one index load.
 *
 * Returns a map keyed by `line.key`. A line absent from the map was not recognised — it
 * had no basis, the crop failed, or the index is empty. Absence is always safe: it means
 * the suggestion is whatever the general model said, which is where this started.
 */
export async function recogniseLines(input: {
  locationId: string;
  image: { data: Buffer; mediaType: string };
  lines: readonly RecognisableLine[];
}): Promise<Map<string, VisualRecognition>> {
  const results = new Map<string, VisualRecognition>();
  if (!visualRecognitionEnabled()) return results;

  const bases = input.lines.map((line) => ({ line, basis: recognitionBasis(line, input.lines) }));
  if (bases.every((entry) => entry.basis === 'none')) return results;

  let index: ReferenceVector[];
  try {
    index = await loadIndex(input.locationId);
  } catch (error) {
    log.warn('visual recognition unavailable for this submission', {
      locationId: input.locationId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return results;
  }
  if (index.length === 0) return results;

  const config = loadVisionConfig();
  const now = new Date();

  for (const { line, basis } of bases) {
    if (basis === 'none') continue;

    try {
      const provider = embeddingProvider();
      let bytes = input.image.data;

      if (basis === 'crop') {
        // normaliseBox ran in recognitionBasis; it is deterministic, so this cannot be
        // null here. Re-running it rather than threading the value through keeps the
        // basis decision in one place.
        const box = normaliseBox(line.box);
        const cropped = box ? await cropToBox(input.image.data, box) : null;
        // A failed crop must NOT silently fall back to the whole image: that is exactly
        // the misattribution the box was introduced to prevent.
        if (!cropped) continue;
        bytes = cropped;
      }

      const embedding = await provider.embed(bytes, input.image.mediaType);
      results.set(line.key, recognise(embedding.vector, index, now, config));
    } catch (error) {
      // Recognition is an enhancement to a suggestion a human must review either way.
      // Failing the whole extraction because one crop would not embed would trade a
      // slightly worse suggestion for no reading at all.
      log.warn('visual recognition failed for one line', {
        locationId: input.locationId,
        basis,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  log.info('visual recognition ran', {
    locationId: input.locationId,
    indexSize: index.length,
    lines: input.lines.length,
    cropped: bases.filter((entry) => entry.basis === 'crop').length,
    recognised: results.size,
  });

  return results;
}
