import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { loadDecisionConfig } from '@/lib/decision/config';
import { expected, routeError } from '@/lib/http';

export const runtime = 'nodejs';

const patchSchema = z.object({
  action: z.enum(['resolve', 'reject', 'reset']),
  itemId: z.string().nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
});

/**
 * PATCH one proposed line: choose an item, fix a quantity, or drop the line.
 *
 * Every edit is audited with the value before and the value after, because "the nurse
 * changed this to that" is exactly the question an investigation asks. The decision the
 * rules made is never overwritten — a corrected line keeps its original `decision` and
 * gains a `disposition`, so the record still shows what the system thought before a human
 * disagreed with it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; candidateId: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { id, candidateId } = await params;

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw expected('That change was not understood.');

    const candidate = await prisma.extractedCandidate.findUnique({
      where: { id: candidateId },
      include: { submission: true },
    });
    if (!candidate || candidate.submissionId !== id) throw expected('That line no longer exists.');
    if (candidate.submission.submitterId !== user.id && user.role === 'nurse') {
      throw expected('That submission belongs to someone else.');
    }
    if (candidate.submission.status === 'confirmed') {
      throw expected('This withdrawal has already been confirmed and cannot be changed.');
    }

    const before = {
      disposition: candidate.disposition,
      resolvedItemId: candidate.resolvedItemId,
      resolvedQuantity: candidate.resolvedQuantity,
    };

    let data: {
      disposition: 'pending' | 'corrected' | 'rejected';
      resolvedItemId: string | null;
      resolvedQuantity: number | null;
      resolvedById: string | null;
      resolvedAt: Date | null;
    };

    if (parsed.data.action === 'reset') {
      data = {
        disposition: 'pending',
        resolvedItemId: null,
        resolvedQuantity: null,
        resolvedById: null,
        resolvedAt: null,
      };
    } else if (parsed.data.action === 'reject') {
      data = {
        disposition: 'rejected',
        resolvedItemId: null,
        resolvedQuantity: null,
        resolvedById: user.id,
        resolvedAt: new Date(),
      };
    } else {
      const itemId = parsed.data.itemId ?? candidate.matchedItemId;
      const quantity = parsed.data.quantity ?? candidate.proposedQuantity;
      if (!itemId) throw expected('Choose which item this is.');
      if (!quantity || quantity <= 0) throw expected('Enter how many were taken.');

      const config = loadDecisionConfig();
      if (quantity > config.maxLineQuantity) {
        throw expected(`That is more than ${config.maxLineQuantity} units. Send it to supply review instead.`);
      }

      // The chosen item must be in THIS location's catalogue. A nurse cannot correct a
      // line into an item the bay does not stock, however the request was constructed.
      const catalogue = await catalogueForLocation(candidate.submission.locationId);
      if (!catalogue.items.some((item) => item.id === itemId && item.isActive)) {
        throw expected('That item is not stocked at this location.');
      }

      data = {
        disposition: 'corrected',
        resolvedItemId: itemId,
        resolvedQuantity: quantity,
        resolvedById: user.id,
        resolvedAt: new Date(),
      };
    }

    await prisma.extractedCandidate.update({ where: { id: candidate.id }, data });

    await recordAudit({
      action: AUDIT_ACTIONS.candidateEdited,
      entityType: 'ExtractedCandidate',
      entityId: candidate.id,
      actorId: user.id,
      actorRole: user.role,
      submissionId: candidate.submissionId,
      locationId: candidate.submission.locationId,
      beforeValue: before,
      afterValue: {
        disposition: data.disposition,
        resolvedItemId: data.resolvedItemId,
        resolvedQuantity: data.resolvedQuantity,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error, { route: 'PATCH candidate' });
  }
}
