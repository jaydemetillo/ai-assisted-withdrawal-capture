import { log } from '@/lib/log';

/**
 * Prepare a photo before a vision model reads it.
 *
 * This is not cosmetic. A phone photo of a scrap of paper is typically rotated by EXIF,
 * several times larger than the model will use, and under-contrasted because the note was
 * shot in a corridor. Each of those costs accuracy or money:
 *
 *  - **EXIF orientation** — an iPhone stores "rotate 90°" as metadata rather than
 *    rotating the pixels. A model reading the raw bytes sees sideways handwriting.
 *  - **Long edge capped at 1568px** — Anthropic downsamples above this anyway, so a
 *    4000px photo buys nothing and costs tokens on every single read.
 *  - **Normalise** — stretches the contrast range, which is what makes grey biro on a
 *    grey-white pack label legible.
 *
 * **sharp is optional.** It ships native binaries, and a deployment that gates install
 * scripts may not have them. Preparation is an optimisation, not a requirement, so a
 * missing sharp degrades to sending the original bytes — correctly labelled — rather
 * than failing the read. The one thing that must never happen is sending bytes under the
 * wrong media type: the vision API rejects the whole request, turning a recoverable
 * filter failure into a failed read.
 *
 * What this does NOT do, and a production version should: detect the paper's edges and
 * crop to them, and correct skew. Both meaningfully improve a photo taken at an angle
 * from across a bay. They need edge detection rather than a filter chain, and inventing a
 * half-working version would be worse than being honest that it is missing.
 */
export const MAX_EDGE_PX = 1568;

export type PreparedImage = {
  data: Buffer;
  /** The type of the bytes ACTUALLY being returned — not what we hoped to produce. */
  mediaType: string;
  width: number;
  height: number;
  /** False when the bytes are the originals, unprocessed. */
  processed: boolean;
};

/** The callable factory, not the namespace — that is what `sharp(buffer)` needs. */
type SharpFactory = (typeof import('sharp'))['default'];

let sharpModule: SharpFactory | null | undefined;

/** Load sharp once, and remember that it is unavailable rather than retrying per photo. */
async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default;
  } catch (error) {
    log.warn('sharp is unavailable — photos will be sent without preparation', {
      reason: error instanceof Error ? error.message.split('\n')[0] : 'unknown',
    });
    sharpModule = null;
  }
  return sharpModule;
}

/** Whether image preparation is available, for the health endpoint to report. */
export async function imagePreparationAvailable(): Promise<boolean> {
  return (await loadSharp()) !== null;
}

/**
 * `sourceMediaType` is what the bytes already are. It matters because both fallback
 * paths return them unchanged.
 */
export async function prepareImageForVision(
  input: Buffer,
  sourceMediaType = 'image/jpeg',
): Promise<PreparedImage> {
  const original: PreparedImage = {
    data: input,
    mediaType: sourceMediaType,
    width: 0,
    height: 0,
    processed: false,
  };

  const sharp = await loadSharp();
  if (!sharp) return original;

  try {
    const { data, info } = await sharp(input, { failOn: 'none' })
      .rotate() // applies EXIF orientation
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .normalise()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return { data, mediaType: 'image/jpeg', width: info.width, height: info.height, processed: true };
  } catch (error) {
    log.warn('image preparation failed, sending original bytes', {
      reason: error instanceof Error ? error.name : 'unknown',
      inputBytes: input.byteLength,
      sourceMediaType,
    });
    return original;
  }
}
