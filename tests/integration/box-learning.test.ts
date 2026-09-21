import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { confirmWithdrawal } from '@/lib/inventory/confirm';
import { setStorage } from '@/lib/storage';
import { createSubmission } from '@/lib/withdrawals/create';
import { embeddingProvider, setEmbeddingProvider } from '@/lib/vision/embedding';
import { learnFromConfirmation, learnedFrom } from '@/lib/vision/learn';
import { cropToBox } from '@/lib/vision/recognize';
import { cosine } from '@/lib/vision/similarity';
import { describeWithDb } from '../helpers/db';
import {
  MemoryStorage,
  itemBySku,
  resetBalances,
  resetWorkingData,
  resusLocation,
  userWithRole,
} from '../helpers/factory';

/**
 * What a bounding box is actually for: teaching from a photograph of more than one thing.
 *
 * Unlike the scripted-vector tests next door, this runs the REAL default embedding
 * provider over REAL JPEGs, because the thing under test is whether the crop cuts out the
 * right region — and a scripted provider that reads its vector from the file bytes cannot
 * tell you that. A crop landing on the wrong half of the image is precisely the failure
 * that is invisible in the training data and only shows up later as a recogniser that
 * confidently suggests the wrong item.
 *
 * The fixtures are two flat colours side by side. Nothing subtle: if the crop is right,
 * the example learned for the left-hand item matches a plain blue photo far better than a
 * plain orange one, and that ordering is the assertion.
 */
const BLUE = { r: 29, g: 78, b: 216 };
const ORANGE = { r: 234, g: 88, b: 12 };

/** A two-colour "tray": left half blue, right half orange. */
async function trayImage(width = 400, height = 200): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = x < width / 2 ? BLUE : ORANGE;
      const at = (y * width + x) * 3;
      pixels[at] = colour.r;
      pixels[at + 1] = colour.g;
      pixels[at + 2] = colour.b;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg()
    .toBuffer();
}

async function flat(colour: { r: number; g: number; b: number }, size = 200): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: colour },
  })
    .jpeg()
    .toBuffer();
}

/** Boxes over each half of the upright tray, inset so neither touches the seam. */
const LEFT_BOX = { x: 0.04, y: 0.12, width: 0.4, height: 0.76 };
const RIGHT_BOX = { x: 0.56, y: 0.12, width: 0.4, height: 0.76 };

describeWithDb('bounding boxes make a multi-item photo teachable', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    await prisma.itemReferencePhoto.deleteMany();
    setStorage(new MemoryStorage());
    // The real provider, deliberately: the crop is the thing under test.
    setEmbeddingProvider(null);
  });

  afterAll(async () => {
    await prisma.itemReferencePhoto.deleteMany();
    setStorage(null);
    await prisma.$disconnect();
  });

  /**
   * A confirmed two-line submission over one tray photo, each line boxed and resolved by
   * a person — which is the only way a visual line can reach a confirmation at all.
   */
  async function trayySubmission(options: { image: Buffer; boxes: (typeof LEFT_BOX | null)[] }) {
    const [nurse, location, mask, gauze] = await Promise.all([
      userWithRole(prisma, 'nurse'),
      resusLocation(prisma),
      itemBySku(prisma, 'MASK-SURG-L2'),
      itemBySku(prisma, 'GAUZE-10X10'),
    ]);

    const { id } = await createSubmission({
      user: nurse,
      locationId: location.id,
      image: { data: options.image, mediaType: 'image/jpeg' },
    });

    const items = [mask, gauze];
    for (let i = 0; i < options.boxes.length; i += 1) {
      const box = options.boxes[i];
      await prisma.extractedCandidate.create({
        data: {
          submissionId: id,
          sequence: i,
          rawText: i === 0 ? 'a blue packet, left of the tray' : 'an orange packet, right of the tray',
          evidence: 'visible_item',
          proposedQuantity: 1,
          providerConfidence: 0.9,
          providerStatus: 'high_confidence',
          providerReason: '',
          decision: 'needs_review',
          decisionReasonCode: 'rule_8_visual_identification',
          decisionMessage: 'Recognised from the photo.',
          boxX: box?.x ?? null,
          boxY: box?.y ?? null,
          boxWidth: box?.width ?? null,
          boxHeight: box?.height ?? null,
          disposition: 'corrected',
          resolvedItemId: (items[i] as { id: string }).id,
          resolvedQuantity: 1,
          resolvedById: nurse.id,
          resolvedAt: new Date(),
        },
      });
    }

    await prisma.withdrawalSubmission.update({
      where: { id },
      data: { status: 'awaiting_review', extractionStatus: 'succeeded' },
    });

    return { id, nurse, location, mask, gauze };
  }

  it('teaches one example per boxed line instead of none', async () => {
    // Before boxes this photograph taught NOTHING, because a whole-image vector cannot be
    // attributed to one of two lines. That was the ceiling on the whole learning loop:
    // most real photos hold more than one thing.
    const { id, nurse, location, mask, gauze } = await trayySubmission({
      image: await trayImage(),
      boxes: [LEFT_BOX, RIGHT_BOX],
    });

    await confirmWithdrawal({ submissionId: id, actor: nurse });

    const learned = await prisma.itemReferencePhoto.findMany({
      where: { locationId: location.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(learned).toHaveLength(2);
    expect(new Set(learned.map((photo) => photo.itemId))).toEqual(new Set([mask.id, gauze.id]));
  });

  it('cuts out the right region, and not merely some region', async () => {
    // The assertion that matters. A crop offset onto the wrong half still produces two
    // tidy-looking rows in the database; only comparing what was actually learned against
    // a known colour shows which half it came from.
    const { id, nurse, mask, gauze } = await trayySubmission({
      image: await trayImage(),
      boxes: [LEFT_BOX, RIGHT_BOX],
    });

    await confirmWithdrawal({ submissionId: id, actor: nurse });

    const provider = embeddingProvider();
    const blue = await provider.embed(await flat(BLUE), 'image/jpeg');
    const orange = await provider.embed(await flat(ORANGE), 'image/jpeg');

    const maskPhoto = await prisma.itemReferencePhoto.findFirstOrThrow({ where: { itemId: mask.id } });
    const gauzePhoto = await prisma.itemReferencePhoto.findFirstOrThrow({ where: { itemId: gauze.id } });

    expect(cosine(maskPhoto.embedding, blue.vector)).toBeGreaterThan(
      cosine(maskPhoto.embedding, orange.vector),
    );
    expect(cosine(gauzePhoto.embedding, orange.vector)).toBeGreaterThan(
      cosine(gauzePhoto.embedding, blue.vector),
    );
  });

  it('crops the upright image, not the bytes, when the phone stored a rotation', async () => {
    // An iPhone records "rotate 90°" as EXIF metadata rather than rotating the pixels.
    // The box describes the UPRIGHT frame — what the model was shown and what a browser
    // displays — so a crop that skipped the rotation would cut a region at right angles
    // to the item. In the overlay that is a visible bug; here it silently poisons the
    // index, which is worse.
    const rotated = await sharp(await trayImage())
      .withMetadata({ orientation: 6 })
      .toBuffer();

    // Upright, this 400x200 landscape becomes 200x400 portrait with blue on TOP.
    const topBox = { x: 0.12, y: 0.04, width: 0.76, height: 0.4 };
    const bottomBox = { x: 0.12, y: 0.56, width: 0.76, height: 0.4 };

    const { id, nurse, mask, gauze } = await trayySubmission({
      image: rotated,
      boxes: [topBox, bottomBox],
    });

    await confirmWithdrawal({ submissionId: id, actor: nurse });

    const provider = embeddingProvider();
    const blue = await provider.embed(await flat(BLUE), 'image/jpeg');
    const orange = await provider.embed(await flat(ORANGE), 'image/jpeg');

    const maskPhoto = await prisma.itemReferencePhoto.findFirstOrThrow({ where: { itemId: mask.id } });
    const gauzePhoto = await prisma.itemReferencePhoto.findFirstOrThrow({ where: { itemId: gauze.id } });

    expect(cosine(maskPhoto.embedding, blue.vector)).toBeGreaterThan(
      cosine(maskPhoto.embedding, orange.vector),
    );
    expect(cosine(gauzePhoto.embedding, orange.vector)).toBeGreaterThan(
      cosine(gauzePhoto.embedding, blue.vector),
    );
  });

  it('still refuses an unboxed line on a photo of several things', async () => {
    // The old guard has not been relaxed, only given an alternative. Without a box there
    // is still no honest way to say which part of this photograph is the item.
    const { id, nurse, location } = await trayySubmission({
      image: await trayImage(),
      boxes: [null, null],
    });

    await confirmWithdrawal({ submissionId: id, actor: nurse });

    expect(await prisma.itemReferencePhoto.count({ where: { locationId: location.id } })).toBe(0);
    expect(await learnedFrom(id)).toEqual([]);
  });

  it('names every item it learned, rather than counting them', async () => {
    const { id, nurse } = await trayySubmission({
      image: await trayImage(),
      boxes: [LEFT_BOX, RIGHT_BOX],
    });

    await confirmWithdrawal({ submissionId: id, actor: nurse });

    const learned = await learnedFrom(id);
    expect(learned.map((entry) => entry.itemName).sort()).toEqual([
      'Gauze swabs 10 x 10 cm pack of 5',
      'Surgical mask level 2',
    ]);
  });

  it('teaches each boxed line only once, however often a confirmation replays', async () => {
    const { id, nurse, location } = await trayySubmission({
      image: await trayImage(),
      boxes: [LEFT_BOX, RIGHT_BOX],
    });

    await confirmWithdrawal({ submissionId: id, actor: nurse });
    await confirmWithdrawal({ submissionId: id, actor: nurse });
    await learnFromConfirmation(id);

    expect(await prisma.itemReferencePhoto.count({ where: { locationId: location.id } })).toBe(2);
  });
});

describe('cropToBox', () => {
  it('returns the region the box describes', async () => {
    const image = await trayImage(400, 200);
    const cropped = await cropToBox(image, { x: 0, y: 0, width: 0.25, height: 1 });
    expect(cropped).not.toBeNull();

    const meta = await sharp(cropped as Buffer).metadata();
    // widenForCrop adds a 4% margin, so the crop is a little larger than a quarter —
    // deliberately, because a cut exactly on the edge throws away the item's outline.
    expect(meta.width).toBeGreaterThan(100);
    expect(meta.width).toBeLessThan(160);
    expect(meta.height).toBe(200);
  });

  it('gives back nothing rather than something wrong when the bytes are not an image', async () => {
    // A failed crop must never fall back to the whole photo: that is exactly the
    // misattribution the box was introduced to prevent.
    expect(
      await cropToBox(Buffer.from('not an image'), { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }),
    ).toBeNull();
  });
});
