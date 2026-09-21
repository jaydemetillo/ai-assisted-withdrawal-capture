import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { setStorage, storage } from '@/lib/storage';
import { runExtraction } from '@/lib/withdrawals/extract';
import { createSubmission } from '@/lib/withdrawals/create';
import { describeWithDb } from '../helpers/db';
import { MemoryStorage, resetWorkingData, resusLocation, userWithRole } from '../helpers/factory';

/**
 * The pipeline end to end, with the mock provider: photo → proposals → review cases.
 *
 * The assertion that matters most is the one about stock: after a full extraction of a
 * perfectly clear note, every balance is exactly where it started. Reading an image does
 * not move inventory, and this proves it against a real database rather than by reading
 * the code.
 */
describeWithDb('extraction', () => {
  beforeEach(async () => {
    await resetWorkingData(prisma);
    setStorage(new MemoryStorage());
  });

  afterAll(async () => {
    setStorage(null);
    await prisma.$disconnect();
  });

  async function submit(scenario: string) {
    const user = await userWithRole(prisma, 'nurse');
    const location = await resusLocation(prisma);
    return createSubmission({
      user,
      locationId: location.id,
      image: { data: Buffer.from('demo photo bytes'), mediaType: 'image/jpeg' },
      demoScenario: scenario,
    });
  }

  it('turns a clear note into two confirmable proposals', async () => {
    const { id } = await submit('high_confidence');
    await runExtraction(id);

    const submission = await prisma.withdrawalSubmission.findUniqueOrThrow({
      where: { id },
      include: { candidates: { orderBy: { sequence: 'asc' } } },
    });

    expect(submission.extractionStatus).toBe('succeeded');
    expect(submission.status).toBe('awaiting_review');
    expect(submission.candidates.map((c) => c.decision)).toEqual(['eligible', 'eligible']);
    expect(submission.candidates[0]?.matchedItemId).toBeTruthy();
    expect(submission.rawText).toContain('18G blue cannula');
  });

  it('changes no stock at all, however clear the reading was', async () => {
    const before = await prisma.inventoryBalance.findMany({ orderBy: { id: 'asc' } });
    const { id } = await submit('high_confidence');
    await runExtraction(id);
    const after = await prisma.inventoryBalance.findMany({ orderBy: { id: 'asc' } });

    expect(after.map((b) => [b.id, b.quantityOnHand, b.version])).toEqual(
      before.map((b) => [b.id, b.quantityOnHand, b.version]),
    );
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('opens a review case for an ambiguous line and leaves it unconfirmable', async () => {
    const { id } = await submit('ambiguous');
    await runExtraction(id);

    const candidates = await prisma.extractedCandidate.findMany({ where: { submissionId: id } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.decision).toBe('ambiguous');
    expect(candidates[0]?.matchedItemId).toBeNull();
    expect(candidates[0]?.suggestedItemIds).toHaveLength(2);

    const cases = await prisma.reviewCase.findMany({ where: { submissionId: id } });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.kind).toBe('ambiguous_candidate');
    expect(cases[0]?.status).toBe('open');
  });

  it('keeps the photo and the text for an unreadable note, and raises a case', async () => {
    const { id } = await submit('unreadable');
    await runExtraction(id);

    const submission = await prisma.withdrawalSubmission.findUniqueOrThrow({ where: { id } });
    expect(submission.rawText).toBe('? gauze maybe');
    // The evidence is still there to be reviewed.
    await expect(storage().get(submission.imageKey)).resolves.toBeTruthy();

    const cases = await prisma.reviewCase.findMany({ where: { submissionId: id } });
    expect(cases[0]?.kind).toBe('unreadable_candidate');
  });

  it('is idempotent — a second call does not read again or duplicate candidates', async () => {
    const { id } = await submit('high_confidence');

    const first = await runExtraction(id);
    const second = await runExtraction(id);

    expect(first.status).toBe('started');
    expect(second.status).toBe('already_done');
    expect(await prisma.extractedCandidate.count({ where: { submissionId: id } })).toBe(2);
  });

  it('does not open a second review case when extraction is retried', async () => {
    const { id } = await submit('ambiguous');
    await runExtraction(id);
    await runExtraction(id);

    expect(await prisma.reviewCase.count({ where: { submissionId: id } })).toBe(1);
  });

  it('keeps the submission and opens a case when the provider fails', async () => {
    const { id } = await submit('high_confidence');
    const { setExtractionProvider } = await import('@/lib/extraction');
    setExtractionProvider({
      name: 'broken',
      model: 'test',
      isMock: true,
      extract: vi.fn().mockRejectedValue(new Error('provider exploded')),
    });

    const outcome = await runExtraction(id);
    setExtractionProvider(null);

    expect(outcome.status).toBe('failed');
    const submission = await prisma.withdrawalSubmission.findUniqueOrThrow({ where: { id } });
    expect(submission.extractionStatus).toBe('failed');
    expect(submission.status).toBe('failed');
    // The photo is not lost — that is the whole reason it is stored before the row.
    await expect(storage().get(submission.imageKey)).resolves.toBeTruthy();

    const cases = await prisma.reviewCase.findMany({ where: { submissionId: id } });
    expect(cases[0]?.kind).toBe('extraction_failed');
  });

  it('records an audit trail with no extracted text in it', async () => {
    const { id } = await submit('high_confidence');
    await runExtraction(id);

    const events = await prisma.auditEvent.findMany({ where: { submissionId: id } });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('submission.created');
    expect(actions).toContain('image.stored');
    expect(actions).toContain('extraction.started');
    expect(actions).toContain('extraction.succeeded');
    expect(actions).toContain('candidate.decided');

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain('18G blue cannula');
    expect(serialised).not.toContain('saline flush');
  });
});
