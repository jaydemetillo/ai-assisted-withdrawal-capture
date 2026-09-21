import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_CONFIG } from '@/lib/vision/config';
import { LocalDescriptorProvider } from '@/lib/vision/embedding/descriptor';
import { recognise, type ReferenceVector } from '@/lib/vision/similarity';

/**
 * The DEFAULT provider, on real encoded images, through the real decoder.
 *
 * tests/unit/descriptor.test.ts tests the maths on raw pixels. This one tests the thing
 * a deployment with no configuration actually runs: JPEG bytes in, EXIF rotation,
 * resize, colourspace conversion, vector out. A descriptor that works on hand-built
 * arrays and falls over on an encoded photo would pass that suite and fail every user.
 *
 * The images are synthetic packs, not photographs. What they can prove is that the
 * pipeline is sound and the thresholds are in the right neighbourhood. What they cannot
 * prove is how it does on a real resus cart in real light — nothing but a real cart
 * can, which is why every visually identified line still goes to a person.
 */
const provider = new LocalDescriptorProvider();

type Pack = { bg: string; fg: string; x: number; y: number; size: number; rotate?: number };

async function render(pack: Pack): Promise<Buffer> {
  const stripes = Array.from(
    { length: 5 },
    (_, i) => `<rect x="0" y="${(i + 1) * 14}" width="${pack.size}" height="3" fill="#141414"/>`,
  ).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="400" height="400" fill="${pack.bg}"/>
      <g transform="translate(${pack.x},${pack.y}) rotate(${pack.rotate ?? 0})">
        <rect width="${pack.size}" height="${pack.size * 0.6}" rx="8" fill="${pack.fg}"/>
        ${stripes}
      </g>
    </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function vector(pack: Pack): Promise<number[]> {
  return (await provider.embed(await render(pack), 'image/jpeg')).vector;
}

/** The same blue pack, photographed three ways. */
const BLUE: Pack[] = [
  { bg: '#ebe8e4', fg: '#2857c8', x: 90, y: 120, size: 220 },
  { bg: '#e1e0dc', fg: '#2e60d0', x: 120, y: 95, size: 240, rotate: 6 },
  { bg: '#f5f0ec', fg: '#2254be', x: 70, y: 150, size: 200, rotate: -5 },
];
const ORANGE: Pack = { bg: '#ebe8e4', fg: '#e6822a', x: 95, y: 118, size: 220 };

function index(vectors: number[][], itemId: string, offset = 0): ReferenceVector[] {
  return vectors.map((v, i) => ({
    id: `${itemId}-${offset + i}`,
    itemId,
    vector: v,
    timesAgreed: 0,
    timesOverruled: 0,
    createdAt: new Date(),
  }));
}

describe('the built-in descriptor on encoded images', () => {
  it('produces a unit vector from a JPEG', async () => {
    const v = await vector(BLUE[0] as Pack);
    expect(v).toHaveLength(provider.dimensions);
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('gives the identical vector for the identical bytes', async () => {
    const bytes = await render(BLUE[0] as Pack);
    const a = await provider.embed(bytes, 'image/jpeg');
    const b = await provider.embed(bytes, 'image/jpeg');
    expect(a.vector).toEqual(b.vector);
    expect(a.model).toBe(b.model);
  });

  it('recognises the same pack from a photo it has not seen', async () => {
    const taught = index([await vector(BLUE[0] as Pack), await vector(BLUE[1] as Pack)], 'blue-pack');
    const result = recognise(await vector(BLUE[2] as Pack), taught, new Date());
    expect(result.itemId).toBe('blue-pack');
    expect(result.score).toBeGreaterThan(DEFAULT_VISION_CONFIG.matchFloor);
  });

  it('prefers the right pack when a differently coloured one is also in the index', async () => {
    const taught = [
      ...index([await vector(BLUE[0] as Pack), await vector(BLUE[1] as Pack)], 'blue-pack'),
      ...index([await vector(ORANGE)], 'orange-pack'),
    ];
    const result = recognise(await vector(BLUE[2] as Pack), taught, new Date());
    expect(result.itemId).toBe('blue-pack');
    expect(result.confusableWith).not.toContain('orange-pack');
  });

  it('says nothing rather than guessing when the index holds only the wrong item', async () => {
    // The failure that matters. A confident wrong suggestion costs more trust than an
    // honest "I have not seen this" — and the floor is what buys that.
    const taught = index([await vector(ORANGE)], 'orange-pack');
    expect(recognise(await vector(BLUE[0] as Pack), taught, new Date()).itemId).toBeNull();
  });

  it('is unaffected by EXIF orientation', async () => {
    // A phone stores "rotate 90°" as metadata rather than rotating the pixels. Without
    // .rotate() in the pipeline, the same pack photographed in portrait lands in
    // completely different tiles and matches nothing.
    const upright = await render(BLUE[0] as Pack);
    const tagged = await sharp(upright).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const taught = index([(await provider.embed(upright, 'image/jpeg')).vector], 'blue-pack');
    const result = recognise((await provider.embed(tagged, 'image/jpeg')).vector, taught, new Date());
    expect(result.itemId).toBe('blue-pack');
  });
});
