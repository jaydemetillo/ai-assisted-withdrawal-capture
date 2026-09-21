import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { loadDecisionConfig } from '@/lib/decision/config';
import { isRestricted } from '@/lib/domain/catalogue';
import { expected, routeError } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  note: z.string().max(200).optional(),
});

/**
 * POST /api/withdrawals/[id]/candidates — add a line by hand.
 *
 * For when the reader missed something, or the photo was unreadable and the nurse knows
 * perfectly well what they took. The line is marked `isManual`, so an audit can always
 * separate "the model read this" from "a person typed this".
 *
 * It still goes through the same gates: the item must be stocked at this location, the
 * quantity must be sane, and a controlled or high-risk item added this way is still
 * `restricted` and still cannot be self-confirmed by a nurse.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw expected('Choose an item and how many were taken.');

    const submission = await prisma.withdrawalSubmission.findUnique({
      where: { id },
      include: { candidates: { select: { sequence: true } } },
    });
    if (!submission) throw expected('That submission no longer exists.');
    if (submission.submitterId !== user.id && user.role === 'nurse') {
      throw expected('That submission belongs to someone else.');
    }
    if (submission.status === 'confirmed') {
      throw expected('This withdrawal has already been confirmed and cannot be changed.');
    }
    if (submission.status === 'cancelled') throw expected('This submission was cancelled.');

    const config = loadDecisionConfig();
    if (parsed.data.quantity > config.maxLineQuantity) {
      throw expected(`That is more than ${config.maxLineQuantity} units. Send it to supply review instead.`);
    }

    const catalogue = await catalogueForLocation(submission.locationId);
    const item = catalogue.items.find((i) => i.id === parsed.data.itemId && i.isActive);
    if (!item) throw expected('That item is not stocked at this location.');

    const restricted = isRestricted(item);
    const nextSequence = Math.max(-1, ...submission.candidates.map((c) => c.sequence)) + 1;

    const candidate = await prisma.extractedCandidate.create({
      data: {
        submissionId: submission.id,
        sequence: nextSequence,
        isManual: true,
        rawText: parsed.data.note?.trim() || `${item.displayName} (added by hand)`,
        proposedQuantity: parsed.data.quantity,
        // No model proposed this, so there is no provider claim to record. Saying the
        // confidence is 1 would be inventing agreement that never happened.
        proposedItemId: null,
        matchedItemId: item.id,
        providerConfidence: 0,
        providerStatus: 'unmatched',
        providerReason: 'Not read from the photo — entered by a person.',
        decision: restricted ? 'restricted' : 'eligible',
        decisionReasonCode: restricted ? 'rule_2_restricted_item' : 'manual_entry',
        decisionMessage: restricted
          ? `${item.displayName} is controlled or high-risk. Supply review must verify this before stock changes.`
          : `${item.displayName} × ${parsed.data.quantity}`,
        // A person chose it, so it is already resolved — but a restricted item still
        // cannot be confirmed by a nurse; evaluateSubmission enforces that separately.
        disposition: 'corrected',
        resolvedItemId: item.id,
        resolvedQuantity: parsed.data.quantity,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.candidateAdded,
      entityType: 'ExtractedCandidate',
      entityId: candidate.id,
      actorId: user.id,
      actorRole: user.role,
      submissionId: submission.id,
      locationId: submission.locationId,
      afterValue: { itemSku: item.sku, quantity: parsed.data.quantity, restricted },
    });

    return NextResponse.json({ ok: true, candidateId: candidate.id }, { status: 201 });
  } catch (error) {
    return routeError(error, { route: 'POST candidate by hand' });
  }
}
