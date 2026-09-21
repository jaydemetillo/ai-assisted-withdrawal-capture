import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { confirmWithdrawal } from '@/lib/inventory/confirm';
import { setStorage } from '@/lib/storage';
import { createSubmission } from '@/lib/withdrawals/create';
import { loadVisionConfig } from '@/lib/vision/config';
import { setEmbeddingProvider, type Embedding, type EmbeddingProvider } from '@/lib/vision/embedding';
import { learnFromConfirmation, learnedFrom } from '@/lib/vision/learn';
import {
  addReferencePhoto,
  exampleCounts,
  loadIndex,
  recordMatchOutcome,
  referencePhotosForLocation,
  retireReferencePhoto,
} from '@/lib/vision/reference-photos';
import { recognise } from '@/lib/vision/similarity';
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
 * The learning loop, end to end against a real database.
 *
 * The embedding provider is replaced with one that reads the vector straight out of the
 * image bytes — `vec:1,0,0` is the vector [1,0,0]. Photographs of medical supplies are
 * not available in CI, and a test that depends on what a model thinks of a JPEG fails
 * for reasons that have nothing to do with the rule under test. What is being tested
 * here is the plumbing and the hygiene: what gets stored, what gets read back, what gets
 * retired, and what a confirmation teaches.
 */
const DIMENSIONS = 3;

class ScriptedEmbeddings implements EmbeddingProvider {
  readonly name = 'scripted';
  readonly isDescriptorOnly = true;
  readonly dimensions = DIMENSIONS;
  constructor(readonly model = 'scripted-v1') {}

  async embed(image: Buffer): Promise<Embedding> {
    const text = image.toString('utf8');
    const match = /^vec:([-\d.,]+)$/.exec(text);
    if (!match) throw new Error(`ScriptedEmbeddings cannot read ${text.slice(0, 20)}`);
    return {
      vector: (match[1] as string).split(',').map(Number),
      model: this.model,
    };
  }
}

/** A photo whose bytes ARE its vector. */
function photo(...vector: number[]) {
  return {
    data: Buffer.from(`vec:${vector.join(',')}`),
    mediaType: 'image/jpeg',
  };
}

const MASK = [1, 0, 0];
const GAUZE = [0, 1, 0];

describeWithDb('visual recognition learns from what people do', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    await prisma.itemReferencePhoto.deleteMany();
    setStorage(new MemoryStorage());
    setEmbeddingProvider(new ScriptedEmbeddings());
  });

  afterAll(async () => {
    await prisma.itemReferencePhoto.deleteMany();
    setStorage(null);
    setEmbeddingProvider(null);
    await prisma.$disconnect();
  });

  async function teach(sku: string, vector: number[]) {
    const [item, location, nurse] = await Promise.all([
      itemBySku(prisma, sku),
      resusLocation(prisma),
      userWithRole(prisma, 'nurse'),
    ]);
    return addReferencePhoto({
      itemId: item.id,
      locationId: location.id,
      image: photo(...vector),
      source: 'taught',
      labelledBy: nurse,
    });
  }

  it('teaches one photo and recognises it on the next one', async () => {
    await teach('MASK-SURG-L2', MASK);

    const location = await resusLocation(prisma);
    const index = await loadIndex(location.id);
    expect(index).toHaveLength(1);

    const mask = await itemBySku(prisma, 'MASK-SURG-L2');
    const result = recognise([0.98, 0.2, 0], index, new Date());
    expect(result.itemId).toBe(mask.id);
    // One example is a start, never a settled answer.
    expect(result.strength).toBe('learning');
  });

  it('keeps examples out of another location entirely', async () => {
    // ED Resus and the store room stock different things. An example from one is
    // evidence about the other only by coincidence.
    await teach('MASK-SURG-L2', MASK);
    const store = await prisma.location.findUniqueOrThrow({
      where: { code: 'ED_STORE_01' },
    });
    expect(await loadIndex(store.id)).toHaveLength(0);
  });

  it('hides examples taken under a different embedding model', async () => {
    // Vectors from two providers are unrelated coordinates. Mixing them produces scores
    // that look entirely reasonable and mean nothing, so a provider change reads as an
    // empty index rather than a subtly wrong one.
    await teach('MASK-SURG-L2', MASK);
    setEmbeddingProvider(new ScriptedEmbeddings('a-different-model'));
    const location = await resusLocation(prisma);
    expect(await loadIndex(location.id)).toHaveLength(0);
  });

  it('refuses to learn an item this location does not stock', async () => {
    const location = await resusLocation(prisma);
    const nurse = await userWithRole(prisma, 'nurse');
    const elsewhere = await prisma.inventoryItem.create({
      data: {
        sku: `NOWHERE-${Date.now()}`,
        displayName: 'Stocked nowhere',
        category: 'added_on_ward',
      },
    });

    await expect(
      addReferencePhoto({
        itemId: elsewhere.id,
        locationId: location.id,
        image: photo(...MASK),
        source: 'taught',
        labelledBy: nurse,
      }),
    ).rejects.toThrow(/not stocked/);

    await prisma.inventoryItem.delete({ where: { id: elsewhere.id } });
  });

  it('holds the example cap by dropping the most redundant photo', async () => {
    const config = loadVisionConfig();
    const location = await resusLocation(prisma);
    const mask = await itemBySku(prisma, 'MASK-SURG-L2');

    // One genuinely different angle, then near-duplicates until we are over the cap.
    await teach('MASK-SURG-L2', [0, 0, 1]);
    for (let i = 0; i <= config.maxExamplesPerItem; i++) {
      await teach('MASK-SURG-L2', [1, i * 0.001, 0]);
    }

    const active = await loadIndex(location.id);
    expect(active.length).toBe(config.maxExamplesPerItem);

    // The odd angle survives: it is the only thing that recognises the pack that way,
    // and evicting by age would have thrown it away first.
    const odd = recognise([0, 0, 1], active, new Date());
    expect(odd.itemId).toBe(mask.id);
    expect(odd.score).toBeCloseTo(1, 6);
  });

  it('credits the nearest example when a human agrees', async () => {
    const created = await teach('MASK-SURG-L2', MASK);
    const mask = await itemBySku(prisma, 'MASK-SURG-L2');

    await recordMatchOutcome({
      visualMatchItemId: mask.id,
      visualMatchPhotoIds: [created?.id as string],
      chosenItemId: mask.id,
    });

    const row = await prisma.itemReferencePhoto.findUniqueOrThrow({
      where: { id: created?.id },
    });
    expect(row.timesAgreed).toBe(1);
    expect(row.timesOverruled).toBe(0);
  });

  it('quarantines an example that keeps being overruled', async () => {
    const created = await teach('MASK-SURG-L2', MASK);
    const mask = await itemBySku(prisma, 'MASK-SURG-L2');
    const gauze = await itemBySku(prisma, 'GAUZE-10X10');
    const config = loadVisionConfig();

    for (let i = 0; i < config.overruleLimit; i++) {
      await recordMatchOutcome({
        visualMatchItemId: mask.id,
        visualMatchPhotoIds: [created?.id as string],
        // The human picked something else. That is the one detectable form of "the
        // system learned something wrong".
        chosenItemId: gauze.id,
      });
    }

    const row = await prisma.itemReferencePhoto.findUniqueOrThrow({
      where: { id: created?.id },
    });
    expect(row.timesOverruled).toBe(config.overruleLimit);
    expect(row.isActive).toBe(false);
    expect(row.retiredReason).toContain('Overruled');

    // Quarantined, not deleted: the evidence of why it went wrong is still there.
    const location = await resusLocation(prisma);
    expect(await loadIndex(location.id)).toHaveLength(0);
    expect(await referencePhotosForLocation(location.id, { includeRetired: true })).toHaveLength(1);
  });

  it('removes an example the moment a reviewer deletes it', async () => {
    // No retraining, no residue: the next photograph sees the change.
    const created = await teach('MASK-SURG-L2', MASK);
    const reviewer = await userWithRole(prisma, 'supply_reviewer');
    const location = await resusLocation(prisma);

    expect(await loadIndex(location.id)).toHaveLength(1);
    await retireReferencePhoto({
      id: created?.id as string,
      actor: reviewer,
      reason: 'Wrong item.',
    });
    expect(await loadIndex(location.id)).toHaveLength(0);
  });

  /**
   * The part that needs no extra work from anybody: a confirmed withdrawal teaches.
   */
  describe('learning from confirmations', () => {
    async function singleItemSubmission(options: { vector: number[]; lines: number }) {
      const [nurse, location, mask, gauze] = await Promise.all([
        userWithRole(prisma, 'nurse'),
        resusLocation(prisma),
        itemBySku(prisma, 'MASK-SURG-L2'),
        itemBySku(prisma, 'GAUZE-10X10'),
      ]);

      const { id } = await createSubmission({
        user: nurse,
        locationId: location.id,
        image: photo(...options.vector),
      });

      // Built directly rather than through the mock reader: these tests are about what a
      // CONFIRMATION teaches, and the reader's own output is covered elsewhere.
      for (let i = 0; i < options.lines; i++) {
        const item = i === 0 ? mask : gauze;
        await prisma.extractedCandidate.create({
          data: {
            submissionId: id,
            sequence: i,
            rawText: 'a white paper packet',
            evidence: 'visible_item',
            proposedQuantity: 1,
            providerConfidence: 0.9,
            providerStatus: 'high_confidence',
            providerReason: '',
            decision: 'needs_review',
            decisionReasonCode: 'rule_8_visual_identification',
            decisionMessage: 'Recognised from the photo.',
            // The explicit human choice. A visual line can reach a confirmation no other
            // way — evaluateSubmission blocks an unresolved needs_review line.
            disposition: 'corrected',
            resolvedItemId: item.id,
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

      return { id, nurse, location, mask };
    }

    it('turns one confirmed single-item photo into a reference example', async () => {
      const { id, nurse, location, mask } = await singleItemSubmission({
        vector: MASK,
        lines: 1,
      });

      await confirmWithdrawal({ submissionId: id, actor: nurse });

      const learned = await prisma.itemReferencePhoto.findMany({
        where: { locationId: location.id },
      });
      expect(learned).toHaveLength(1);
      expect(learned[0]?.itemId).toBe(mask.id);
      expect(learned[0]?.source).toBe('learned_from_correction');
      expect(learned[0]?.sourceCandidateId).not.toBeNull();

      // And the receipt is allowed to say so, because it actually happened.
      expect(await learnedFrom(id)).toEqual([{ itemName: 'Surgical mask level 2' }]);
    });

    it('learns nothing from a photo holding several items', async () => {
      // A whole-image vector cannot be attributed to one of two lines. Filing it under
      // whichever came first would teach the recogniser something false about both.
      const { id, nurse, location } = await singleItemSubmission({
        vector: [0.5, 0.5, 0],
        lines: 2,
      });

      await confirmWithdrawal({ submissionId: id, actor: nurse });

      expect(
        await prisma.itemReferencePhoto.count({
          where: { locationId: location.id },
        }),
      ).toBe(0);
      expect(await learnedFrom(id)).toEqual([]);
    });

    it('teaches the same lesson only once, however many times a confirmation replays', async () => {
      const { id, nurse, location } = await singleItemSubmission({
        vector: MASK,
        lines: 1,
      });

      await confirmWithdrawal({ submissionId: id, actor: nurse });
      // A double-tap replays the stored result; it must not also replay the learning.
      await confirmWithdrawal({ submissionId: id, actor: nurse });
      await learnFromConfirmation(id);

      expect(
        await prisma.itemReferencePhoto.count({
          where: { locationId: location.id },
        }),
      ).toBe(1);
    });

    it('learns nothing from a submission that was never confirmed', async () => {
      // An abandoned submission is somebody who was not sure. Learning from it would fill
      // the index with exactly the cases that went wrong.
      const { id, location } = await singleItemSubmission({
        vector: MASK,
        lines: 1,
      });
      await learnFromConfirmation(id);
      expect(
        await prisma.itemReferencePhoto.count({
          where: { locationId: location.id },
        }),
      ).toBe(0);
    });

    it('counts what it has learned, for the badge on the review card', async () => {
      const { id, nurse, location, mask } = await singleItemSubmission({
        vector: MASK,
        lines: 1,
      });
      await confirmWithdrawal({ submissionId: id, actor: nurse });

      const counts = await exampleCounts(location.id);
      expect(counts.get(mask.id)).toEqual({ examples: 1, timesAgreed: 0 });
    });

    it('records the overrule when the human picked something else', async () => {
      const [nurse, location, mask, gauze] = await Promise.all([
        userWithRole(prisma, 'nurse'),
        resusLocation(prisma),
        itemBySku(prisma, 'MASK-SURG-L2'),
        itemBySku(prisma, 'GAUZE-10X10'),
      ]);

      const taught = await addReferencePhoto({
        itemId: mask.id,
        locationId: location.id,
        image: photo(...MASK),
        source: 'taught',
        labelledBy: nurse,
      });

      const { id } = await createSubmission({
        user: nurse,
        locationId: location.id,
        image: photo(...GAUZE),
      });
      await prisma.extractedCandidate.create({
        data: {
          submissionId: id,
          sequence: 0,
          rawText: 'a white paper packet',
          evidence: 'visible_item',
          proposedQuantity: 1,
          providerConfidence: 0.9,
          providerStatus: 'high_confidence',
          providerReason: '',
          decision: 'needs_review',
          decisionReasonCode: 'rule_8_visual_recognised',
          decisionMessage: 'Recognised from photos taken here.',
          // The index said mask; the nurse said gauze.
          visualMatchItemId: mask.id,
          visualMatchPhotoIds: [taught?.id as string],
          disposition: 'corrected',
          resolvedItemId: gauze.id,
          resolvedQuantity: 1,
          resolvedById: nurse.id,
          resolvedAt: new Date(),
        },
      });
      await prisma.withdrawalSubmission.update({
        where: { id },
        data: { status: 'awaiting_review', extractionStatus: 'succeeded' },
      });

      await confirmWithdrawal({ submissionId: id, actor: nurse });

      const row = await prisma.itemReferencePhoto.findUniqueOrThrow({
        where: { id: taught?.id },
      });
      expect(row.timesOverruled).toBe(1);
      expect(row.timesAgreed).toBe(0);
    });
  });
});
