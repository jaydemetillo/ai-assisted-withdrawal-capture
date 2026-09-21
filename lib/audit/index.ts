import type { Prisma, PrismaClient, Role } from '@prisma/client';
import { prisma } from '@/lib/db';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The only way anything writes an AuditEvent.
 *
 * Append-only: there is no update and no delete here, and there must never be one. A
 * corrected mistake is a NEW event describing the correction.
 *
 * What may go into beforeValue/afterValue: ids, quantities, statuses, decisions. What may
 * NOT: image bytes, raw extracted text, anything a patient could be identified from. The
 * audit trail records WHAT changed and WHO changed it; the evidence itself lives on the
 * submission, behind an authorised route.
 */
export const AUDIT_ACTIONS = {
  submissionCreated: 'submission.created',
  imageStored: 'image.stored',
  imageAccessed: 'image.accessed',
  extractionStarted: 'extraction.started',
  extractionSucceeded: 'extraction.succeeded',
  extractionFailed: 'extraction.failed',
  candidateDecided: 'candidate.decided',
  candidateEdited: 'candidate.edited',
  submissionEscalated: 'submission.escalated',
  submissionCancelled: 'submission.cancelled',
  submissionConfirmed: 'submission.confirmed',
  transactionCreated: 'transaction.created',
  balanceChanged: 'balance.changed',
  reviewCaseOpened: 'review_case.opened',
  reviewCaseAction: 'review_case.action',
  reviewCaseClosed: 'review_case.closed',
  replenishmentCreated: 'replenishment.created',
  candidateAdded: 'candidate.added_by_hand',
  catalogueItemCreated: 'catalogue.item_created',
  catalogueItemStocked: 'catalogue.item_stocked',
  catalogueRequested: 'catalogue.item_requested',
  referencePhotoAdded: 'reference_photo.added',
  referencePhotoRetired: 'reference_photo.retired',
  referencePhotoQuarantined: 'reference_photo.quarantined',
  authLogin: 'auth.login',
  authLogout: 'auth.logout',
  authDenied: 'auth.denied',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditInput = {
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  actorRole?: Role | null;
  submissionId?: string | null;
  locationId?: string | null;
  beforeValue?: Prisma.InputJsonValue | null;
  afterValue?: Prisma.InputJsonValue | null;
  correlationId?: string;
};

export async function recordAudit(input: AuditInput, db: Db = prisma): Promise<void> {
  await db.auditEvent.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      submissionId: input.submissionId ?? null,
      locationId: input.locationId ?? null,
      beforeValue: input.beforeValue ?? undefined,
      afterValue: input.afterValue ?? undefined,
      correlationId: input.correlationId ?? '',
    },
  });
}

/** Write several events in one round trip — used inside the confirm transaction. */
export async function recordAuditMany(inputs: AuditInput[], db: Db = prisma): Promise<void> {
  if (inputs.length === 0) return;
  await db.auditEvent.createMany({
    data: inputs.map((input) => ({
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      submissionId: input.submissionId ?? null,
      locationId: input.locationId ?? null,
      beforeValue: input.beforeValue ?? undefined,
      afterValue: input.afterValue ?? undefined,
      correlationId: input.correlationId ?? '',
    })),
  });
}
