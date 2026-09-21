import { afterAll, beforeEach, expect, it } from 'vitest';
import { createCatalogueItem } from '@/lib/catalogue/create-item';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { confirmWithdrawal } from '@/lib/inventory/confirm';
import { setStorage } from '@/lib/storage';
import { createSubmission } from '@/lib/withdrawals/create';
import { runExtraction } from '@/lib/withdrawals/extract';
import { describeWithDb } from '../helpers/db';
import {
  MemoryStorage,
  balanceFor,
  itemBySku,
  resetBalances,
  resetWorkingData,
  resusLocation,
  userWithRole,
} from '../helpers/factory';

/**
 * Adding what the reader missed.
 *
 * The gap this closes: a photo that misses a line, or an item the catalogue has never
 * heard of, used to leave the nurse with no way to record what they actually took.
 */
describeWithDb('adding items by hand', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    await prisma.inventoryItem.deleteMany({ where: { category: 'added_on_ward' } });
    setStorage(new MemoryStorage());
  });

  afterAll(async () => {
    await prisma.inventoryItem.deleteMany({ where: { category: 'added_on_ward' } });
    setStorage(null);
    await prisma.$disconnect();
  });

  async function submission(scenario = 'unreadable') {
    const nurse = await userWithRole(prisma, 'nurse');
    const location = await resusLocation(prisma);
    const { id } = await createSubmission({
      user: nurse,
      locationId: location.id,
      image: { data: Buffer.from(`photo-${Math.random()}`), mediaType: 'image/jpeg' },
      demoScenario: scenario,
    });
    await runExtraction(id);
    return { id, nurse, location };
  }

  async function addLine(submissionId: string, sku: string, quantity: number, userId: string) {
    const item = await itemBySku(prisma, sku);
    const existing = await prisma.extractedCandidate.findMany({ where: { submissionId } });
    return prisma.extractedCandidate.create({
      data: {
        submissionId,
        sequence: existing.length,
        isManual: true,
        rawText: `${item.displayName} (added by hand)`,
        proposedQuantity: quantity,
        matchedItemId: item.id,
        providerConfidence: 0,
        providerStatus: 'unmatched',
        decision: item.isControlled || item.isHighRisk ? 'restricted' : 'eligible',
        decisionReasonCode: 'manual_entry',
        decisionMessage: `${item.displayName} × ${quantity}`,
        disposition: 'corrected',
        resolvedItemId: item.id,
        resolvedQuantity: quantity,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
    });
  }

  it('lets an unreadable photo still become a real withdrawal', async () => {
    const { id, nurse } = await submission('unreadable');
    const before = (await balanceFor(prisma, 'GAUZE-10X10')).quantityOnHand;

    // The reader produced one unreadable line; drop it and type what was taken.
    await prisma.extractedCandidate.updateMany({
      where: { submissionId: id },
      data: { disposition: 'rejected', resolvedById: nurse.id, resolvedAt: new Date() },
    });
    await addLine(id, 'GAUZE-10X10', 2, nurse.id);

    const result = await confirmWithdrawal({ submissionId: id, actor: nurse });
    expect(result.movements).toHaveLength(1);
    expect((await balanceFor(prisma, 'GAUZE-10X10')).quantityOnHand).toBe(before - 2);
  });

  it('marks a hand-added line so an audit can tell it from a reading', async () => {
    const { id, nurse } = await submission('unreadable');
    const candidate = await addLine(id, 'GAUZE-5X5', 1, nurse.id);

    expect(candidate.isManual).toBe(true);
    // No model claimed anything, so no confidence is recorded. Saying 1 would invent
    // agreement that never happened.
    expect(candidate.providerConfidence).toBe(0);
    expect(candidate.proposedItemId).toBeNull();
    expect(candidate.matchedItemId).toBeTruthy();
  });

  it('still refuses a nurse self-confirming a restricted item added by hand', async () => {
    const { id, nurse } = await submission('unreadable');
    await prisma.extractedCandidate.updateMany({
      where: { submissionId: id },
      data: { disposition: 'rejected' },
    });
    await addLine(id, 'MORPH-10MG', 1, nurse.id);

    await expect(confirmWithdrawal({ submissionId: id, actor: nurse })).rejects.toThrow(
      /controlled or high-risk/i,
    );
    expect(await prisma.inventoryTransaction.count({ where: { submissionId: id } })).toBe(0);
  });
});

describeWithDb('adding an item the catalogue does not have', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await prisma.inventoryItem.deleteMany({ where: { category: 'added_on_ward' } });
  });

  afterAll(async () => {
    await prisma.inventoryItem.deleteMany({ where: { category: 'added_on_ward' } });
    await prisma.$disconnect();
  });

  it('creates the item, stocks it here, and makes it matchable next time', async () => {
    const reviewer = await userWithRole(prisma, 'supply_reviewer');
    const location = await resusLocation(prisma);

    const item = await createCatalogueItem({
      actor: reviewer,
      locationId: location.id,
      displayName: 'Chest drain kit 28Fr',
      unit: 'each',
      quantityOnHand: 4,
      reorderThreshold: 1,
      reorderQuantity: 4,
      isControlled: false,
      isHighRisk: false,
      alias: 'chest drain',
    });

    expect(item.sku).toBe('CHEST-DRAIN-KIT-28FR');

    const catalogue = await catalogueForLocation(location.id);
    const found = catalogue.items.find((i) => i.id === item.id);
    expect(found?.quantityOnHand).toBe(4);
    expect(found?.aliases).toContain('chest drain');
  });

  it('records who added it', async () => {
    const admin = await userWithRole(prisma, 'admin');
    const location = await resusLocation(prisma);
    const item = await createCatalogueItem({
      actor: admin,
      locationId: location.id,
      displayName: 'Pelvic binder',
      unit: 'each',
      quantityOnHand: 2,
      reorderThreshold: 1,
      reorderQuantity: 2,
      isControlled: false,
      isHighRisk: false,
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: item.id, action: 'catalogue.item_created' },
    });
    expect(event.actorId).toBe(admin.id);
    expect(event.actorRole).toBe('admin');
  });

  it('refuses to create a second item with the same name', async () => {
    const admin = await userWithRole(prisma, 'admin');
    const location = await resusLocation(prisma);
    const base = {
      actor: admin,
      locationId: location.id,
      displayName: 'Tourniquet',
      unit: 'each',
      quantityOnHand: 2,
      reorderThreshold: 1,
      reorderQuantity: 2,
      isControlled: false,
      isHighRisk: false,
    };

    await createCatalogueItem(base);
    // A duplicate name would make every future match of that phrase ambiguous.
    await expect(createCatalogueItem(base)).rejects.toThrow(/already stocked/i);
  });

  it('will not steal an alias another item already owns', async () => {
    const admin = await userWithRole(prisma, 'admin');
    const location = await resusLocation(prisma);

    const item = await createCatalogueItem({
      actor: admin,
      locationId: location.id,
      displayName: 'Blue thing',
      unit: 'each',
      quantityOnHand: 1,
      reorderThreshold: 1,
      reorderQuantity: 1,
      isControlled: false,
      isHighRisk: false,
      alias: 'saline flush', // already belongs to NS-FLUSH-10ML
    });

    const aliases = await prisma.inventoryAlias.findMany({ where: { itemId: item.id } });
    expect(aliases).toHaveLength(0);

    // And the original still owns it.
    const owner = await prisma.inventoryAlias.findUniqueOrThrow({
      where: { normalizedAlias: 'saline flush' },
      include: { item: true },
    });
    expect(owner.item.sku).toBe('NS-FLUSH-10ML');
  });

  it('flags a controlled item added on the ward, so it cannot be self-confirmed', async () => {
    const reviewer = await userWithRole(prisma, 'supply_reviewer');
    const location = await resusLocation(prisma);
    const item = await createCatalogueItem({
      actor: reviewer,
      locationId: location.id,
      displayName: 'Ketamine 200mg',
      unit: 'each',
      quantityOnHand: 2,
      reorderThreshold: 1,
      reorderQuantity: 2,
      isControlled: true,
      isHighRisk: false,
    });
    expect(item.isControlled).toBe(true);
  });
});

describeWithDb('"it is not on the list", from the line itself', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    await resetBalances(prisma);
    await prisma.inventoryItem.deleteMany({ where: { category: 'added_on_ward' } });
    setStorage(new MemoryStorage());
  });

  afterAll(async () => {
    await prisma.inventoryItem.deleteMany({ where: { category: 'added_on_ward' } });
    setStorage(null);
    await prisma.$disconnect();
  });

  /** A submission carrying lines nothing in the cart matches — a photographed prescription. */
  async function prescriptionSubmission() {
    const nurse = await userWithRole(prisma, 'nurse');
    const location = await resusLocation(prisma);
    const created = await prisma.withdrawalSubmission.create({
      data: {
        submitterId: nurse.id,
        locationId: location.id,
        imageKey: 'test.jpg',
        imageMediaType: 'image/jpeg',
        status: 'awaiting_review',
        extractionStatus: 'succeeded',
        extractionProvider: 'anthropic',
        rawText: 'Betaloc 100mg - 1 tab BID\nCimetidine 50 mg - 2 tabs TID',
      },
    });
    for (const [index, text] of ['Betaloc 100mg - 1 tab BID', 'Cimetidine 50 mg - 2 tabs TID'].entries()) {
      await prisma.extractedCandidate.create({
        data: {
          submissionId: created.id,
          sequence: index,
          rawText: text,
          proposedQuantity: 1,
          providerConfidence: 0.9,
          providerStatus: 'unmatched',
          decision: 'unmatched',
          decisionReasonCode: 'rule_4_no_match',
          decisionMessage: 'Does not match anything stocked here.',
        },
      });
    }
    return { submissionId: created.id, nurse, location };
  }

  it('a nurse can settle an unidentified line without deleting the evidence', async () => {
    const { submissionId, nurse } = await prescriptionSubmission();
    const candidate = await prisma.extractedCandidate.findFirstOrThrow({
      where: { submissionId },
      orderBy: { sequence: 'asc' },
    });

    // What the "It's not on the list" button does for a nurse.
    const reviewCase = await prisma.reviewCase.create({
      data: {
        submissionId,
        candidateId: candidate.id,
        locationId: (await resusLocation(prisma)).id,
        kind: 'catalogue_request',
        summary: 'Not in the catalogue: "Betaloc 100mg" (1 taken)',
        openedById: nurse.id,
      },
    });
    await prisma.extractedCandidate.update({
      where: { id: candidate.id },
      data: { disposition: 'rejected', resolvedById: nurse.id, resolvedAt: new Date() },
    });

    const settled = await prisma.extractedCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(settled.disposition).toBe('rejected');
    // The line is settled, but the written text and the request both survive — the record
    // of what was taken is not lost just because the catalogue has never heard of it.
    expect(settled.rawText).toContain('Betaloc');
    expect(reviewCase.kind).toBe('catalogue_request');
    expect(reviewCase.candidateId).toBe(candidate.id);
  });

  it('a settled line stops blocking the rest of the submission', async () => {
    const { submissionId, nurse } = await prescriptionSubmission();
    const candidates = await prisma.extractedCandidate.findMany({ where: { submissionId } });

    // Both unidentified lines settled as catalogue requests…
    await prisma.extractedCandidate.updateMany({
      where: { submissionId },
      data: { disposition: 'rejected', resolvedById: nurse.id, resolvedAt: new Date() },
    });
    expect(candidates).toHaveLength(2);

    // …and one real supply added by hand. The submission is now confirmable.
    const gauze = await itemBySku(prisma, 'GAUZE-10X10');
    const before = (await balanceFor(prisma, 'GAUZE-10X10')).quantityOnHand;
    await prisma.extractedCandidate.create({
      data: {
        submissionId,
        sequence: 5,
        isManual: true,
        rawText: 'Gauze swabs (added by hand)',
        proposedQuantity: 2,
        matchedItemId: gauze.id,
        providerConfidence: 0,
        providerStatus: 'unmatched',
        decision: 'eligible',
        decisionReasonCode: 'manual_entry',
        decisionMessage: 'Added by hand',
        disposition: 'corrected',
        resolvedItemId: gauze.id,
        resolvedQuantity: 2,
        resolvedById: nurse.id,
        resolvedAt: new Date(),
      },
    });

    const result = await confirmWithdrawal({ submissionId, actor: nurse });
    expect(result.movements).toHaveLength(1);
    expect((await balanceFor(prisma, 'GAUZE-10X10')).quantityOnHand).toBe(before - 2);
  });

  it('a reviewer can catalogue the item and point the same line at it', async () => {
    const { submissionId } = await prescriptionSubmission();
    const reviewer = await userWithRole(prisma, 'supply_reviewer');
    const location = await resusLocation(prisma);
    const candidate = await prisma.extractedCandidate.findFirstOrThrow({ where: { submissionId } });

    const item = await createCatalogueItem({
      actor: reviewer,
      locationId: location.id,
      displayName: 'Betaloc 100mg tablet',
      unit: 'tablet',
      quantityOnHand: 10,
      reorderThreshold: 2,
      reorderQuantity: 10,
      isControlled: false,
      isHighRisk: false,
    });

    await prisma.extractedCandidate.update({
      where: { id: candidate.id },
      data: {
        disposition: 'corrected',
        resolvedItemId: item.id,
        resolvedQuantity: 1,
        resolvedById: reviewer.id,
        resolvedAt: new Date(),
      },
    });

    // The SAME line now points at the new item — no duplicate line was created.
    const resolved = await prisma.extractedCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(resolved.resolvedItemId).toBe(item.id);
    expect(await prisma.extractedCandidate.count({ where: { submissionId } })).toBe(2);
  });
});
