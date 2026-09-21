import type { Prisma, PrismaClient, ReferencePhotoSource, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { expected } from '@/lib/http';
import { log } from '@/lib/log';
import { storage } from '@/lib/storage';
import { loadVisionConfig, type VisionConfig } from '@/lib/vision/config';
import { embeddingProvider, visualRecognitionEnabled } from '@/lib/vision/embedding';
import { isMisleading, mostRedundant, type ReferenceVector } from '@/lib/vision/similarity';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The reference-photo index: the only thing in this application that learns.
 *
 * Every read here is scoped by BOTH location and embedding model, and neither is
 * optional. Location, because ED Resus and the store room stock different things and an
 * example from one is evidence about the other only by coincidence. Model, because two
 * vectors from two different providers are unrelated coordinates whose cosine is noise
 * that looks exactly like a score.
 *
 * Nothing in this file can move stock, and nothing in it can make a line confirmable. It
 * writes to one table which the decision rules consult as a suggestion and nothing more.
 */

export type ReferencePhotoRow = {
  id: string;
  itemId: string;
  imageKey: string;
  mediaType: string;
  source: ReferencePhotoSource;
  labelledByName: string | null;
  timesAgreed: number;
  timesOverruled: number;
  createdAt: Date;
};

/**
 * The vectors for one location, ready for `recognise()`.
 *
 * Quarantined and retired rows never leave this function, so no caller has to remember
 * to filter them — the one place that could forget is the one place that is tested.
 */
export async function loadIndex(locationId: string, db: Db = prisma): Promise<ReferenceVector[]> {
  const provider = embeddingProvider();
  const rows = await db.itemReferencePhoto.findMany({
    where: { locationId, isActive: true, embeddingModel: provider.model },
    select: {
      id: true,
      itemId: true,
      embedding: true,
      timesAgreed: true,
      timesOverruled: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    vector: row.embedding,
    timesAgreed: row.timesAgreed,
    timesOverruled: row.timesOverruled,
    createdAt: row.createdAt,
  }));
}

/** Active example counts per item, for the "seen before" badge and the health screen. */
export async function exampleCounts(
  locationId: string,
  db: Db = prisma,
): Promise<Map<string, { examples: number; timesAgreed: number }>> {
  const provider = embeddingProvider();
  const rows = await db.itemReferencePhoto.groupBy({
    by: ['itemId'],
    where: { locationId, isActive: true, embeddingModel: provider.model },
    _count: { _all: true },
    _sum: { timesAgreed: true },
  });

  return new Map(
    rows.map((row) => [row.itemId, { examples: row._count._all, timesAgreed: row._sum.timesAgreed ?? 0 }]),
  );
}

export type AddReferencePhotoInput = {
  itemId: string;
  locationId: string;
  image: { data: Buffer; mediaType: string };
  source: ReferencePhotoSource;
  labelledBy: Pick<User, 'id' | 'role'> | null;
  submissionId?: string | null;
  sourceCandidateId?: string | null;
  config?: VisionConfig;
};

/**
 * Teach the index one photograph of one item.
 *
 * The item must be stocked at the location, checked against the same balance row that
 * makes it withdrawable there. Teaching the index about something the bay does not stock
 * would put an item into the recogniser that the decision rules would then refuse — a
 * suggestion nobody can accept, which is worse than no suggestion.
 */
export async function addReferencePhoto(input: AddReferencePhotoInput): Promise<{ id: string } | null> {
  if (!visualRecognitionEnabled()) return null;

  const config = input.config ?? loadVisionConfig();
  const provider = embeddingProvider();

  const balance = await prisma.inventoryBalance.findUnique({
    where: { itemId_locationId: { itemId: input.itemId, locationId: input.locationId } },
    include: { item: true },
  });
  if (!balance || !balance.item.isActive) {
    throw expected('That item is not stocked at this location.');
  }

  // A confirmed line teaches at most one lesson. The unique index on sourceCandidateId
  // is the hard guarantee; this check just turns a replayed confirmation into a quiet
  // no-op instead of a caught constraint violation.
  if (input.sourceCandidateId) {
    const existing = await prisma.itemReferencePhoto.findUnique({
      where: { sourceCandidateId: input.sourceCandidateId },
    });
    if (existing) return null;
  }

  const embedding = await provider.embed(input.image.data, input.image.mediaType);
  const thumbnail = await shrinkForStorage(input.image.data, input.image.mediaType);
  const stored = await storage().put(thumbnail.data, thumbnail.mediaType);

  const created = await prisma.itemReferencePhoto.create({
    data: {
      itemId: input.itemId,
      locationId: input.locationId,
      imageKey: stored.key,
      mediaType: stored.mediaType,
      bytes: stored.bytes,
      embedding: embedding.vector,
      embeddingModel: embedding.model,
      dimensions: embedding.vector.length,
      source: input.source,
      labelledById: input.labelledBy?.id ?? null,
      submissionId: input.submissionId ?? null,
      sourceCandidateId: input.sourceCandidateId ?? null,
    },
  });

  await enforceExampleCap(input.itemId, input.locationId, config);

  await recordAudit({
    action: AUDIT_ACTIONS.referencePhotoAdded,
    entityType: 'ItemReferencePhoto',
    entityId: created.id,
    actorId: input.labelledBy?.id ?? null,
    actorRole: input.labelledBy?.role ?? null,
    submissionId: input.submissionId ?? null,
    locationId: input.locationId,
    afterValue: {
      itemSku: balance.item.sku,
      source: input.source,
      embeddingModel: embedding.model,
      dimensions: embedding.vector.length,
    },
  });

  return { id: created.id };
}

/**
 * Hold an item at its example cap by retiring the most REDUNDANT example, not the oldest.
 *
 * See mostRedundant() for why. In short: twelve photos from the same angle are worth one
 * photo, and the eleven-month-old shot of the pack on its side is the only thing that
 * recognises it on its side. Evicting by age would throw away the diversity that makes
 * the set work and keep the copies that make it look busy.
 */
async function enforceExampleCap(itemId: string, locationId: string, config: VisionConfig): Promise<void> {
  const provider = embeddingProvider();
  const rows = await prisma.itemReferencePhoto.findMany({
    where: { itemId, locationId, isActive: true, embeddingModel: provider.model },
    select: { id: true, itemId: true, embedding: true, timesAgreed: true, timesOverruled: true, createdAt: true },
  });
  if (rows.length <= config.maxExamplesPerItem) return;

  const vectors: ReferenceVector[] = rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    vector: row.embedding,
    timesAgreed: row.timesAgreed,
    timesOverruled: row.timesOverruled,
    createdAt: row.createdAt,
  }));

  let remaining = vectors;
  while (remaining.length > config.maxExamplesPerItem) {
    const drop = mostRedundant(remaining);
    if (!drop) break;
    await prisma.itemReferencePhoto.update({
      where: { id: drop.id },
      data: {
        isActive: false,
        retiredAt: new Date(),
        retiredReason: `At the ${config.maxExamplesPerItem}-example cap; this one was the closest to the others.`,
      },
    });
    remaining = remaining.filter((v) => v.id !== drop.id);
  }
}

/** Remove an example. Soft, so it is instantly reversible and the audit has a subject. */
export async function retireReferencePhoto(input: {
  id: string;
  actor: Pick<User, 'id' | 'role'>;
  reason: string;
}): Promise<void> {
  const photo = await prisma.itemReferencePhoto.findUnique({
    where: { id: input.id },
    include: { item: true },
  });
  if (!photo) throw expected('That reference photo no longer exists.');

  await prisma.itemReferencePhoto.update({
    where: { id: input.id },
    data: { isActive: false, retiredAt: new Date(), retiredReason: input.reason.slice(0, 200) },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.referencePhotoRetired,
    entityType: 'ItemReferencePhoto',
    entityId: photo.id,
    actorId: input.actor.id,
    actorRole: input.actor.role,
    locationId: photo.locationId,
    beforeValue: { isActive: true, timesAgreed: photo.timesAgreed, timesOverruled: photo.timesOverruled },
    afterValue: { isActive: false, itemSku: photo.item.sku },
  });
}

/**
 * Record what a human did about a match the index proposed.
 *
 * Credit and blame land on the NEAREST example — the one whose distance produced the
 * score — not on every example of the item. Spreading blame across all twelve would
 * mean a single bad photo never accumulates enough overrules to quarantine itself,
 * which is the whole point of counting.
 *
 * This is deliberately the only place `timesOverruled` is written. An example that keeps
 * being overruled is the one detectable form of "the system learned something wrong",
 * and it is detectable only because a human's disagreement is recorded against a row
 * rather than against a vibe.
 */
export async function recordMatchOutcome(input: {
  visualMatchItemId: string | null;
  visualMatchPhotoIds: string[];
  chosenItemId: string | null;
  config?: VisionConfig;
}): Promise<void> {
  const { visualMatchItemId, visualMatchPhotoIds, chosenItemId } = input;
  if (!visualMatchItemId || visualMatchPhotoIds.length === 0 || !chosenItemId) return;

  const nearest = visualMatchPhotoIds[0] as string;
  const agreed = chosenItemId === visualMatchItemId;

  const updated = await prisma.itemReferencePhoto.update({
    where: { id: nearest },
    data: agreed ? { timesAgreed: { increment: 1 } } : { timesOverruled: { increment: 1 } },
  });

  if (agreed) return;

  // Quarantine, not delete. A photo that has misled people repeatedly stops being used
  // immediately and stays visible on the health screen, where somebody can see WHY the
  // recogniser was wrong. Deleting it would remove the evidence along with the problem.
  const config = input.config ?? loadVisionConfig();
  if (isMisleading(updated, config)) {
    await prisma.itemReferencePhoto.update({
      where: { id: updated.id },
      data: {
        isActive: false,
        retiredAt: new Date(),
        retiredReason: `Overruled ${updated.timesOverruled} times — quarantined automatically.`,
      },
    });
    await recordAudit({
      action: AUDIT_ACTIONS.referencePhotoQuarantined,
      entityType: 'ItemReferencePhoto',
      entityId: updated.id,
      locationId: updated.locationId,
      afterValue: { timesOverruled: updated.timesOverruled, timesAgreed: updated.timesAgreed },
    });
    log.warn('reference photo quarantined after repeated overrules', {
      referencePhotoId: updated.id,
      timesOverruled: updated.timesOverruled,
    });
  }
}

/** Every example at a location, retired ones included, for the health screen. */
export async function referencePhotosForLocation(
  locationId: string,
  options: { includeRetired?: boolean } = {},
): Promise<ReferencePhotoRow[]> {
  const provider = embeddingProvider();
  const rows = await prisma.itemReferencePhoto.findMany({
    where: {
      locationId,
      embeddingModel: provider.model,
      ...(options.includeRetired ? {} : { isActive: true }),
    },
    include: { labelledBy: { select: { name: true } } },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    imageKey: row.imageKey,
    mediaType: row.mediaType,
    source: row.source,
    labelledByName: row.labelledBy?.name ?? null,
    timesAgreed: row.timesAgreed,
    timesOverruled: row.timesOverruled,
    createdAt: row.createdAt,
  }));
}

/**
 * Shrink a reference photo before storing it.
 *
 * The vector is computed from the bytes that were uploaded; this only affects what gets
 * kept for people to look at. 512 px is plenty for a gallery thumbnail and turns a
 * twelve-example item from several megabytes into a few hundred kilobytes — which
 * matters when the default storage adapter is a Postgres table.
 *
 * Falls back to the original bytes, correctly labelled, when sharp is unavailable. It
 * must never return bytes of one type labelled as another.
 */
async function shrinkForStorage(
  data: Buffer,
  mediaType: string,
): Promise<{ data: Buffer; mediaType: string }> {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(data, { failOn: 'none' })
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { data: out, mediaType: 'image/jpeg' };
  } catch {
    return { data, mediaType };
  }
}
