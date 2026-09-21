import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareImageForVision, MAX_EDGE_PX } from '@/lib/extraction/image';

/**
 * The bug this guards: when sharp cannot process the bytes we fall back to sending them
 * unchanged. Labelling those bytes JPEG regardless meant a PNG went to the vision API
 * tagged as a JPEG, and the whole request was rejected — a recoverable filter failure
 * turned into a failed read.
 */
describe('prepareImageForVision', () => {
  it('re-encodes a real photo to JPEG and caps the long edge', async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const prepared = await prepareImageForVision(big, 'image/jpeg');
    expect(prepared.processed).toBe(true);
    expect(prepared.mediaType).toBe('image/jpeg');
    expect(Math.max(prepared.width, prepared.height)).toBe(MAX_EDGE_PX);
    expect(prepared.data.byteLength).toBeLessThan(big.byteLength);
  });

  it('converts a PNG to JPEG', async () => {
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const prepared = await prepareImageForVision(png, 'image/png');
    expect(prepared.mediaType).toBe('image/jpeg');
  });

  it('reports the TRUE media type when it cannot process the bytes', async () => {
    const notAnImage = Buffer.from('this is not an image at all');
    const prepared = await prepareImageForVision(notAnImage, 'image/png');

    expect(prepared.data).toEqual(notAnImage);
    // The whole point: not 'image/jpeg'.
    expect(prepared.mediaType).toBe('image/png');
    expect(prepared.processed).toBe(false);
  });

  it('does not enlarge a small image', async () => {
    const small = await sharp({
      create: { width: 200, height: 150, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const prepared = await prepareImageForVision(small, 'image/jpeg');
    expect(prepared.width).toBe(200);
    expect(prepared.height).toBe(150);
  });
});
