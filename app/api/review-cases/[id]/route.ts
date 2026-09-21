import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { loadDecisionConfig } from '@/lib/decision/config';
import { expected, routeError } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['claim', 'match', 'reject', 'request_physical_check', 'close']),
  itemId: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

/**
 * Reviewer actions on one case.
 *
 * Every branch writes an AuditEvent carrying the value before and the value after. A
 * reviewer changing "blue cannula" to the 22G and the quantity from 1 to 2 leaves a
 * record of both the original proposal and their correction — which is the question an
 * investigation actually asks.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const reviewer = await requireRole('supply_reviewer', 'admin');
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw expected('That action was not understood.');

    const reviewCase = await prisma.reviewCase.findUnique({
      where: { id },
      include: { candidate: true, submission: true },
    });
    if (!reviewCase) throw expected('That case no longer exists.');
    if (reviewCase.status === 'resolved' || reviewCase.status === 'rejected') {
      throw expected('That case is already closed.');
    }

    const before = {
      status: reviewCase.status,
      candidateDisposition: reviewCase.candidate?.disposition ?? null,
      candidateItemId: reviewCase.candidate?.resolvedItemId ?? null,
      candidateQuantity: reviewCase.candidate?.resolvedQuantity ?? null,
    };

    switch (parsed.data.action) {
      case 'claim': {
        await prisma.reviewCase.update({
          where: { id },
          data: { status: 'in_progress', assignedToId: reviewer.id },
        });
        break;
      }

      case 'request_physical_check': {
        await prisma.reviewCase.update({
          where: { id },
          data: {
            status: 'awaiting_physical_check',
            assignedToId: reviewer.id,
            resolutionNote: parsed.data.note ?? 'Someone needs to count this on the shelf.',
          },
        });
        break;
      }

      case 'match': {
        if (!reviewCase.candidate) throw expected('This case has no line to match.');
        const itemId = parsed.data.itemId ?? reviewCase.candidate.matchedItemId;
        const quantity = parsed.data.quantity ?? reviewCase.candidate.proposedQuantity;
        if (!itemId) throw expected('Choose which item this is.');
        if (!quantity || quantity <= 0) throw expected('Enter how many were taken.');

        const config = loadDecisionConfig();
        if (quantity > config.maxLineQuantity) {
          throw expected(`${quantity} is above the ${config.maxLineQuantity} limit for a single line.`);
        }

        const catalogue = await catalogueForLocation(reviewCase.locationId);
        if (!catalogue.items.some((item) => item.id === itemId && item.isActive)) {
          throw expected('That item is not stocked at this location.');
        }

        await prisma.extractedCandidate.update({
          where: { id: reviewCase.candidate.id },
          data: {
            disposition: 'corrected',
            resolvedItemId: itemId,
            resolvedQuantity: quantity,
            resolvedById: reviewer.id,
            resolvedAt: new Date(),
          },
        });
        await prisma.reviewCase.update({
          where: { id },
          data: {
            status: 'resolved',
            itemId,
            assignedToId: reviewer.id,
            resolvedById: reviewer.id,
            resolvedAt: new Date(),
            resolutionNote: parsed.data.note ?? 'Matched by supply review.',
          },
        });
        break;
      }

      case 'reject': {
        if (reviewCase.candidate) {
          await prisma.extractedCandidate.update({
            where: { id: reviewCase.candidate.id },
            data: {
              disposition: 'rejected',
              resolvedItemId: null,
              resolvedQuantity: null,
              resolvedById: reviewer.id,
              resolvedAt: new Date(),
            },
          });
        }
        await prisma.reviewCase.update({
          where: { id },
          data: {
            status: 'rejected',
            assignedToId: reviewer.id,
            resolvedById: reviewer.id,
            resolvedAt: new Date(),
            resolutionNote: parsed.data.note ?? 'Rejected by supply review.',
          },
        });
        break;
      }

      case 'close': {
        await prisma.reviewCase.update({
          where: { id },
          data: {
            status: 'resolved',
            assignedToId: reviewer.id,
            resolvedById: reviewer.id,
            resolvedAt: new Date(),
            resolutionNote: parsed.data.note ?? 'Closed by supply review.',
          },
        });
        break;
      }
    }

    const updated = await prisma.reviewCase.findUniqueOrThrow({
      where: { id },
      include: { candidate: true },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.reviewCaseAction,
      entityType: 'ReviewCase',
      entityId: id,
      actorId: reviewer.id,
      actorRole: reviewer.role,
      submissionId: reviewCase.submissionId,
      locationId: reviewCase.locationId,
      beforeValue: before,
      afterValue: {
        reviewerAction: parsed.data.action,
        status: updated.status,
        candidateDisposition: updated.candidate?.disposition ?? null,
        candidateItemId: updated.candidate?.resolvedItemId ?? null,
        candidateQuantity: updated.candidate?.resolvedQuantity ?? null,
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (error) {
    return routeError(error, { route: 'PATCH review case' });
  }
}
