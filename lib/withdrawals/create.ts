import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { isSupportedMediaType, storage } from '@/lib/storage';
import { log } from '@/lib/log';

/**
 * Create a submission from one photo and one location.
 *
 * This is the ten-second path, and the shape of it is the product: the image is stored,
 * a row is written, and the nurse is done. No extraction happens here — it is kicked off
 * afterwards by the processing screen, so a slow read never holds anybody in a corridor.
 *
 * Nothing in this function can touch InventoryBalance. That is not a convention; there is
 * no import of it anywhere in this file or anything it calls.
 */
export function maxImageBytes(): number {
  const raw = Number(process.env.MAX_IMAGE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12 * 1024 * 1024;
}

export type CreateSubmissionInput = {
  user: User;
  locationId: string;
  image: { data: Buffer; mediaType: string };
  demoScenario?: string | null;
};

export async function createSubmission(input: CreateSubmissionInput): Promise<{ id: string }> {
  const { user, locationId, image } = input;

  if (!isSupportedMediaType(image.mediaType)) {
    throw new Error('That image type is not supported. Use a JPEG, PNG or WebP photo.');
  }
  if (image.data.byteLength === 0) {
    throw new Error('The photo was empty. Please take it again.');
  }
  if (image.data.byteLength > maxImageBytes()) {
    throw new Error('That photo is too large. Please take it again.');
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location || !location.isActive) {
    throw new Error('That location is not available.');
  }

  // Store the image FIRST. A submission row pointing at an image that was never written
  // would be a submission whose evidence is missing — worse than no submission at all.
  const stored = await storage().put(image.data, image.mediaType);

  const submission = await prisma.withdrawalSubmission.create({
    data: {
      submitterId: user.id,
      locationId: location.id,
      imageKey: stored.key,
      imageMediaType: stored.mediaType,
      imageBytes: stored.bytes,
      status: 'received',
      extractionStatus: 'pending',
      demoScenario: input.demoScenario ?? null,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.submissionCreated,
    entityType: 'WithdrawalSubmission',
    entityId: submission.id,
    actorId: user.id,
    actorRole: user.role,
    submissionId: submission.id,
    locationId: location.id,
    afterValue: { status: 'received', locationCode: location.code, imageBytes: stored.bytes },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.imageStored,
    entityType: 'WithdrawalSubmission',
    entityId: submission.id,
    actorId: user.id,
    actorRole: user.role,
    submissionId: submission.id,
    locationId: location.id,
    // The key and the size, never the bytes.
    afterValue: { imageKey: stored.key, bytes: stored.bytes, adapter: storage().name },
  });

  log.info('submission created', {
    submissionId: submission.id,
    locationCode: location.code,
    imageBytes: stored.bytes,
  });

  return { id: submission.id };
}
