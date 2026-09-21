import type { Embedding, EmbeddingProvider } from '@/lib/vision/embedding/provider';
import { unit } from '@/lib/vision/embedding/provider';
import { log } from '@/lib/log';

/**
 * A hand-computed image descriptor, with no model and no download.
 *
 * **Read this before judging it.** This is not CLIP and does not pretend to be. It is a
 * colour-and-structure fingerprint: where the colours are, how saturated, and where the
 * edges run. It recognises *the same packet photographed twice on the same bench* quite
 * well, which happens to be the entire job here, and it recognises *the concept of a
 * syringe* not at all.
 *
 * Why ship it as the default rather than CLIP:
 *
 *  - It has no dependency, no 90 MB download, and no cold-start penalty, so the feature
 *    works on a deployment nobody has finished configuring. Every previous piece of this
 *    prototype that required setup before it would work at all produced an opaque
 *    failure in front of a user, and this one refuses to repeat that.
 *  - A weak descriptor cannot do damage here, and that is structural rather than lucky.
 *    Visual evidence can never reach `eligible` (rule 8b), so the very worst a bad
 *    vector achieves is putting a wrong suggestion in front of a human who is required
 *    to look at it anyway.
 *  - It makes the shape of the feature real and testable end to end. Swapping in CLIP
 *    later changes one class and re-teaches the index; nothing else moves.
 *
 * Set `EMBEDDING_PROVIDER=transformers` for the real thing. See lib/vision/embedding/
 * transformers.ts.
 *
 * ## The three blocks
 *
 *  1. **Global colour** (24 dims). A hue histogram weighted by saturation and value, so
 *     grey and near-black pixels do not vote for a hue, plus coarse saturation and
 *     brightness histograms — each normalised separately, then combined. Translation-
 *     invariant: the item can be anywhere in frame. Medical packaging is aggressively
 *     colour-coded, which makes this the strongest of the three, and it is weighted
 *     accordingly.
 *  2. **Tiled colour** (48 dims). Mean RGB over a 4×4 grid. Adds "blue on the left, white
 *     on the right", which the global histogram throws away.
 *  3. **Edge orientation** (64 dims). Per tile, gradient energy in four directions. This
 *     is what separates a ribbed syringe barrel from a flat paper wrapper of the same
 *     colour.
 *
 * Each block is normalised on its own and then weighted, so no block can dominate by
 * having larger raw numbers, and the weights are the actual statement about what matters.
 * The result is unit length, so a cosine similarity is a dot product.
 */
export const DESCRIPTOR_MODEL = 'local-descriptor-v1';
export const DESCRIPTOR_GRID = 4;
export const DESCRIPTOR_SIZE = 64;
export const DESCRIPTOR_DIMENSIONS = 24 + DESCRIPTOR_GRID * DESCRIPTOR_GRID * (3 + 4);

const HUE_BINS = 12;
const SAT_BINS = 6;
const VAL_BINS = 6;

/**
 * Block weights. Squares sum to 1 within each level, so the concatenated vector is
 * already unit length.
 *
 * The colour block's THREE sub-histograms are normalised against each other before being
 * combined, and that detail is not a nicety. The hue histogram accumulates `saturation ×
 * brightness`, which totals a few thousand; the saturation and brightness histograms
 * accumulate pixel counts, which total 4096 each. Concatenating them raw and normalising
 * once lets the counts swamp the hue — and hue is the only part that knows blue from
 * orange. Measured on synthetic packs, that bug scored a blue pack against an orange one
 * at 0.98, higher than against another photo of itself.
 */
const WEIGHTS = { colour: Math.sqrt(0.6), tiles: Math.sqrt(0.15), edges: Math.sqrt(0.25) };
const COLOUR_WEIGHTS = { hue: Math.sqrt(0.7), sat: Math.sqrt(0.2), val: Math.sqrt(0.1) };

/**
 * The maths, separated from the decoding.
 *
 * Pure and synchronous: give it raw RGB bytes and it returns the vector. That is what
 * makes the descriptor testable without sharp, without a fixture image, and without
 * guessing at what a JPEG decoder produced.
 *
 * `rgb` is row-major, three bytes per pixel, no alpha.
 */
export function describePixels(rgb: Uint8Array | Buffer, width: number, height: number): number[] {
  if (width <= 0 || height <= 0 || rgb.length < width * height * 3) {
    throw new Error('describePixels needs width × height × 3 bytes of RGB');
  }

  const hue = new Array<number>(HUE_BINS).fill(0);
  const sat = new Array<number>(SAT_BINS).fill(0);
  const val = new Array<number>(VAL_BINS).fill(0);

  const cells = DESCRIPTOR_GRID * DESCRIPTOR_GRID;
  const tileSum = new Array<number>(cells * 3).fill(0);
  const tileCount = new Array<number>(cells).fill(0);
  const edges = new Array<number>(cells * 4).fill(0);

  // Luminance is needed twice — once per pixel for the gradients of its neighbours — so
  // it is computed once up front rather than three times inside the loop.
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 3) {
    luma[i] = (0.299 * (rgb[p] as number) + 0.587 * (rgb[p + 1] as number) + 0.114 * (rgb[p + 2] as number)) / 255;
  }

  for (let y = 0; y < height; y++) {
    const tileY = Math.min(DESCRIPTOR_GRID - 1, Math.floor((y * DESCRIPTOR_GRID) / height));
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 3;
      const r = (rgb[p] as number) / 255;
      const g = (rgb[p + 1] as number) / 255;
      const b = (rgb[p + 2] as number) / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      const s = max === 0 ? 0 : chroma / max;

      let h = 0;
      if (chroma > 0) {
        if (max === r) h = ((g - b) / chroma + 6) % 6;
        else if (max === g) h = (b - r) / chroma + 2;
        else h = (r - g) / chroma + 4;
        h /= 6; // 0..1
      }

      // Weighted by saturation AND brightness: a washed-out grey pixel has a hue, but it
      // is meaningless, and letting it vote turns every photo of a white bench into the
      // same vector.
      const hueIndex = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS));
      hue[hueIndex] = (hue[hueIndex] as number) + s * max;
      const satIndex = Math.min(SAT_BINS - 1, Math.floor(s * SAT_BINS));
      sat[satIndex] = (sat[satIndex] as number) + 1;
      const valIndex = Math.min(VAL_BINS - 1, Math.floor(max * VAL_BINS));
      val[valIndex] = (val[valIndex] as number) + 1;

      const tileX = Math.min(DESCRIPTOR_GRID - 1, Math.floor((x * DESCRIPTOR_GRID) / width));
      const cell = tileY * DESCRIPTOR_GRID + tileX;
      tileSum[cell * 3] = (tileSum[cell * 3] as number) + r;
      tileSum[cell * 3 + 1] = (tileSum[cell * 3 + 1] as number) + g;
      tileSum[cell * 3 + 2] = (tileSum[cell * 3 + 2] as number) + b;
      tileCount[cell] = (tileCount[cell] as number) + 1;

      // Central differences, skipping the border rather than clamping it — a clamped
      // edge invents a gradient that is an artefact of the crop, not of the item.
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const gx = (luma[i + 1] as number) - (luma[i - 1] as number);
        const gy = (luma[i + width] as number) - (luma[i - width] as number);
        const magnitude = Math.hypot(gx, gy);
        if (magnitude > 0) {
          // Orientation is mod π: an edge and the same edge seen dark-to-light rather
          // than light-to-dark are the same edge.
          const angle = (Math.atan2(gy, gx) + Math.PI) % Math.PI;
          const bin = Math.min(3, Math.floor((angle / Math.PI) * 4));
          edges[cell * 4 + bin] = (edges[cell * 4 + bin] as number) + magnitude;
        }
      }
    }
  }

  const tiles: number[] = [];
  for (let cell = 0; cell < cells; cell++) {
    const count = (tileCount[cell] as number) || 1;
    tiles.push(
      (tileSum[cell * 3] as number) / count,
      (tileSum[cell * 3 + 1] as number) / count,
      (tileSum[cell * 3 + 2] as number) / count,
    );
  }

  const colourBlock = [
    ...unit(hue).map((v) => v * COLOUR_WEIGHTS.hue),
    ...unit(sat).map((v) => v * COLOUR_WEIGHTS.sat),
    ...unit(val).map((v) => v * COLOUR_WEIGHTS.val),
  ].map((v) => v * WEIGHTS.colour);
  const tileBlock = unit(tiles).map((v) => v * WEIGHTS.tiles);
  const edgeBlock = unit(edges).map((v) => v * WEIGHTS.edges);

  // Already unit length by construction, but normalised again so a degenerate input —
  // a wholly black image, whose colour block is all zeros — cannot produce a vector of
  // length 0.87 that quietly scores lower against everything.
  return unit([...colourBlock, ...tileBlock, ...edgeBlock]);
}

type SharpFactory = (typeof import('sharp'))['default'];
let sharpModule: SharpFactory | null | undefined;

async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default;
  } catch (error) {
    log.warn('sharp is unavailable — visual recognition is disabled', {
      reason: error instanceof Error ? error.message.split('\n')[0] : 'unknown',
    });
    sharpModule = null;
  }
  return sharpModule;
}

export class LocalDescriptorProvider implements EmbeddingProvider {
  readonly name = 'local-descriptor';
  readonly model = DESCRIPTOR_MODEL;
  readonly dimensions = DESCRIPTOR_DIMENSIONS;
  readonly isDescriptorOnly = true;

  /**
   * `mediaType` is accepted and ignored: sharp sniffs the container from the bytes, and
   * a caller's label has been wrong before now. Kept in the signature so the concrete
   * class is interchangeable with the interface at a call site.
   */
  async embed(image: Buffer, _mediaType?: string): Promise<Embedding> {
    const sharp = await loadSharp();
    if (!sharp) {
      throw new Error(
        'Visual recognition needs the sharp image library, which is not installed on this deployment.',
      );
    }

    // `fit: 'fill'` on purpose: aspect ratio is thrown away so that the same item shot
    // portrait and landscape lands in the same tiles. Preserving it would make framing
    // part of the fingerprint, and framing is exactly the thing that varies.
    const { data, info } = await sharp(image, { failOn: 'none' })
      .rotate() // EXIF orientation, or the tiles are rotated relative to each other
      .resize(DESCRIPTOR_SIZE, DESCRIPTOR_SIZE, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { vector: describePixels(data, info.width, info.height), model: this.model };
  }
}
