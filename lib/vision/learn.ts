import { prisma } from '@/lib/db';
import { log } from '@/lib/log';
import { storage } from '@/lib/storage';
import { boxFromRow } from '@/lib/vision/boxes';
import { visualRecognitionEnabled } from '@/lib/vision/embedding';
import { cropToBox } from '@/lib/vision/recognize';
import { addReferencePhoto, recordMatchOutcome } from '@/lib/vision/reference-photos';

/**
 * The self-improving part: a confirmed withdrawal teaches the recogniser.
 *
 * Nobody does any training. A nurse photographs an item, the system guesses or does not,
 * the nurse picks the right one and confirms — and that is a labelled example, verified
 * by the act of somebody being willing to change stock over it.
 *
 * ## The four guards, and why each one is there
 *
 * 1. **Only a CONFIRMED withdrawal teaches.** An abandoned or cancelled submission is
 *    somebody who was not sure. Learning from it would mean the index fills up with the
 *    cases that went wrong.
 * 2. **Only an explicit human choice.** `resolvedItemId` is set by a person tapping an
 *    item, never by the rules. A visual line is always `needs_review`, so it cannot
 *    reach a confirmation without one — meaning every label here was chosen by a human,
 *    not accepted by default. That is enforced in evaluateSubmission, not here, and
 *    re-checked here anyway.
 * 3. **Only an image region that IS the item.** An embedding describes whatever it is
 *    given. A tray holding four things embeds to "a tray holding four things", and
 *    filing that under whichever line happened to be first would teach the recogniser
 *    something false about all four. So a line teaches from its own CROP when it has a
 *    box, and from the whole photo only when it is the only thing in the photo. A boxed
 *    line whose crop fails teaches nothing — it never falls back to the whole image,
 *    because that is precisely the misattribution the box exists to prevent.
 * 4. **A line teaches at most once.** `sourceCandidateId` is unique, so a replayed
 *    confirmation adds nothing.
 *
 * Guard 3 is why bounding boxes were worth building. Before them a tray of four confirmed
 * items taught NOTHING, which is most of what a cart actually sees; with them the same
 * photograph teaches four examples, each one a crop of the thing it is labelled as.
 *
 * ## What never happens here
 *
 * This function cannot fail a confirmation. Stock has already moved by the time it runs,
 * and refusing to record that because a vision model would not load would be the wrong
 * trade by a wide margin. Everything is inside a try/catch that logs and returns.
 */
export async function learnFromConfirmation(submissionId: string): Promise<void> {
  if (!visualRecognitionEnabled()) return;

  try {
    const submission = await prisma.withdrawalSubmission.findUnique({
      where: { id: submissionId },
      include: { candidates: { orderBy: { sequence: 'asc' } } },
    });
    if (!submission || submission.status !== 'confirmed') return;

    // ── Agreement and overrules, on EVERY line the index had an opinion about. This runs
    // even for multi-item photos: the index was consulted or it was not, and what the
    // human then did is worth counting either way.
    for (const candidate of submission.candidates) {
      await recordMatchOutcome({
        visualMatchItemId: candidate.visualMatchItemId,
        visualMatchPhotoIds: candidate.visualMatchPhotoIds,
        chosenItemId: candidate.resolvedItemId ?? candidate.matchedItemId,
      });
    }

    // ── New examples: one per visual line that can be cut out of the photograph.
    const teachable = submission.candidates.filter(
      (candidate) =>
        candidate.evidence === 'visible_item' &&
        candidate.disposition === 'applied' &&
        // The explicit-choice test. `matchedItemId` is deliberately NOT accepted as a
        // fallback: that is what the system thought, and learning from our own proposal
        // is how a system teaches itself its own mistakes.
        candidate.resolvedItemId !== null,
    );
    if (teachable.length === 0) return;

    // Fetched once, after the guards, so a submission that teaches nothing does not pay
    // for a storage read.
    const image = await storage().get(submission.imageKey);

    for (const line of teachable) {
      const box = boxFromRow(line);
      let bytes = image.data;

      if (box) {
        const cropped = await cropToBox(image.data, box);
        if (!cropped) continue;
        bytes = cropped;
      } else if (submission.candidates.length !== 1) {
        // No box and not alone in the frame: there is no honest way to say which part of
        // this photograph is the item.
        continue;
      }

      const created = await addReferencePhoto({
        itemId: line.resolvedItemId as string,
        locationId: submission.locationId,
        image: { data: bytes, mediaType: box ? 'image/jpeg' : image.mediaType },
        source: 'learned_from_correction',
        labelledBy: submission.confirmedById ? { id: submission.confirmedById, role: 'nurse' } : null,
        submissionId: submission.id,
        sourceCandidateId: line.id,
      });

      if (created) {
        log.info('learned a reference photo from a confirmed withdrawal', {
          submissionId: submission.id,
          referencePhotoId: created.id,
          fromCrop: Boolean(box),
        });
      }
    }
  } catch (error) {
    log.warn('could not learn from this confirmation', {
      submissionId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * What the system actually learned from this confirmation, for the receipt to say.
 *
 * Only ever what genuinely happened. "I'll recognise that next time" said after a photo
 * that taught nothing is a promise the next tray will visibly break, and a nurse who has
 * been told that twice stops believing anything the screen says. So this reads the rows
 * that were written rather than inferring from the workflow — and now returns a list,
 * because one boxed photograph of a tray can teach several items at once.
 */
export async function learnedFrom(submissionId: string): Promise<{ itemName: string }[]> {
  if (!visualRecognitionEnabled()) return [];
  const photos = await prisma.itemReferencePhoto.findMany({
    where: { submissionId, source: 'learned_from_correction', isActive: true },
    include: { item: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  // De-duplicated by name: two crops of the same item on one tray is one thing to say.
  const names = [...new Set(photos.map((photo) => photo.item.displayName))];
  return names.map((itemName) => ({ itemName }));
}
