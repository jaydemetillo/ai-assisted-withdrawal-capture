import { describe, expect, it } from 'vitest';
import {
  DESCRIPTOR_DIMENSIONS,
  DESCRIPTOR_GRID,
  describePixels,
} from '@/lib/vision/embedding/descriptor';
import { cosine } from '@/lib/vision/similarity';

/**
 * The image descriptor, tested on pixels rather than on JPEGs.
 *
 * describePixels is pure and synchronous precisely so these tests can exist: no sharp,
 * no fixture images, no wondering what a decoder did to the bytes. Every image below is
 * an array this file built, so an assertion about a score is an assertion about the
 * maths.
 */
const W = 64;
const H = 64;

type RGB = [number, number, number];

/** A `size`×`size` block of `fg` at (x, y) on a field of `bg`. */
function image(options: { bg: RGB; fg: RGB; x: number; y: number; size: number; stripes?: number }): Uint8Array {
  const pixels = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside =
        x >= options.x && x < options.x + options.size && y >= options.y && y < options.y + options.size;
      let colour: RGB = inside ? options.fg : options.bg;
      // Horizontal stripes give the edge-orientation block something to find.
      if (inside && options.stripes && (y - options.y) % options.stripes === 0) colour = [15, 15, 15];
      const p = (y * W + x) * 3;
      pixels[p] = colour[0];
      pixels[p + 1] = colour[1];
      pixels[p + 2] = colour[2];
    }
  }
  return pixels;
}

const BENCH: RGB = [232, 230, 228];
const BLUE: RGB = [40, 90, 200];
const ORANGE: RGB = [235, 130, 25];

describe('describePixels', () => {
  it('returns a unit-length vector of the advertised size', () => {
    const vector = describePixels(image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28 }), W, H);
    expect(vector).toHaveLength(DESCRIPTOR_DIMENSIONS);
    expect(vector.every((v) => Number.isFinite(v))).toBe(true);
    expect(cosine(vector, vector)).toBeCloseTo(1, 10);
  });

  it('is deterministic — the same pixels give the identical vector', () => {
    const pixels = image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28 });
    expect(describePixels(pixels, W, H)).toEqual(describePixels(pixels, W, H));
  });

  it('survives a degenerate image without producing NaN or a zero-length vector', () => {
    // All black: no hue anywhere, no edges. The colour block normalises from zeros, and
    // a naive implementation returns NaN here and then scores 0 against everything for
    // reasons nobody can see from the outside.
    const black = describePixels(new Uint8Array(W * H * 3), W, H);
    expect(black.every((v) => Number.isFinite(v))).toBe(true);
    expect(black.some((v) => v !== 0)).toBe(true);
  });

  it('refuses input that is not width × height × 3 bytes', () => {
    expect(() => describePixels(new Uint8Array(10), W, H)).toThrow(/RGB/);
    expect(() => describePixels(new Uint8Array(W * H * 3), 0, H)).toThrow();
  });

  it('uses a 4×4 grid, which the dimension count depends on', () => {
    expect(DESCRIPTOR_GRID).toBe(4);
    expect(DESCRIPTOR_DIMENSIONS).toBe(24 + 16 * 7);
  });
});

describe('what the descriptor can and cannot tell apart', () => {
  /**
   * The property the whole feature rests on: the SAME item photographed differently
   * must score higher than a DIFFERENT item photographed identically. An earlier version
   * failed this — the saturation and brightness histograms were raw pixel counts and
   * swamped the hue, so a blue pack scored 0.98 against an orange one.
   */
  it('scores the same item across framing above a different item in the same frame', () => {
    const blueA = describePixels(image({ bg: BENCH, fg: BLUE, x: 14, y: 18, size: 30, stripes: 6 }), W, H);
    const blueB = describePixels(image({ bg: BENCH, fg: BLUE, x: 22, y: 12, size: 26, stripes: 6 }), W, H);
    const orange = describePixels(image({ bg: BENCH, fg: ORANGE, x: 14, y: 18, size: 30, stripes: 6 }), W, H);

    const same = cosine(blueA, blueB);
    const different = cosine(blueA, orange);

    expect(same).toBeGreaterThan(different);
    expect(same - different).toBeGreaterThan(0.1);
  });

  it('separates colour even when the shape is identical', () => {
    const blue = describePixels(image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28 }), W, H);
    const orange = describePixels(image({ bg: BENCH, fg: ORANGE, x: 16, y: 16, size: 28 }), W, H);
    expect(cosine(blue, orange)).toBeLessThan(0.9);
  });

  it('separates structure even when the colour is identical', () => {
    const plain = describePixels(image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28 }), W, H);
    const ribbed = describePixels(image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28, stripes: 3 }), W, H);
    expect(cosine(plain, ribbed)).toBeLessThan(0.999);
  });

  /**
   * The honest limit, asserted rather than left in a comment.
   *
   * Two items that differ only in a size printed on the label are the same picture. No
   * number of examples changes that, which is exactly why a visually identified line can
   * never be confirmable on its own and why the confusable-pair machinery exists.
   */
  it('cannot tell apart two items that differ only in printed text', () => {
    const medium = describePixels(image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28 }), W, H);
    const large = describePixels(image({ bg: BENCH, fg: BLUE, x: 16, y: 16, size: 28 }), W, H);
    expect(cosine(medium, large)).toBeCloseTo(1, 6);
  });
});
