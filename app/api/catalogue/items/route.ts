import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole, requireUser } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { createCatalogueItem } from '@/lib/catalogue/create-item';
import { prisma } from '@/lib/db';
import { expected, routeError } from '@/lib/http';

export const runtime = 'nodejs';

const createSchema = z.object({
  locationId: z.string().min(1),
  displayName: z.string().min(2).max(120),
  unit: z.string().max(30).optional(),
  quantityOnHand: z.number().int().min(0).max(100_000).optional(),
  reorderThreshold: z.number().int().min(0).max(100_000).optional(),
  reorderQuantity: z.number().int().min(0).max(100_000).optional(),
  isControlled: z.boolean().optional(),
  isHighRisk: z.boolean().optional(),
  alias: z.string().max(120).optional(),
});

/**
 * POST /api/catalogue/items — add an item the catalogue does not have.
 *
 * Supply reviewers and admins only. The decision rules work by refusing anything the
 * location does not stock; that refusal means nothing if any user can invent a row in
 * the middle of a withdrawal. A nurse uses the request endpoint below instead.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireRole('supply_reviewer', 'admin');

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw expected(parsed.error.issues[0]?.message ?? 'Check the item details and try again.');
    }

    const item = await createCatalogueItem({
      actor,
      locationId: parsed.data.locationId,
      displayName: parsed.data.displayName,
      unit: parsed.data.unit ?? 'each',
      quantityOnHand: parsed.data.quantityOnHand ?? 0,
      reorderThreshold: parsed.data.reorderThreshold ?? 0,
      reorderQuantity: parsed.data.reorderQuantity ?? 0,
      isControlled: parsed.data.isControlled ?? false,
      isHighRisk: parsed.data.isHighRisk ?? false,
      alias: parsed.data.alias ?? null,
    });

    return NextResponse.json(
      { ok: true, item: { id: item.id, sku: item.sku, displayName: item.displayName, unit: item.unit } },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, { route: 'POST catalogue item' });
  }
}

const requestSchema = z.object({
  submissionId: z.string().min(1),
  description: z.string().min(2).max(200),
  quantity: z.number().int().positive().optional(),
  /** The line this is about, so asking to add an item also settles it. */
  candidateId: z.string().min(1).optional(),
});

/**
 * PUT /api/catalogue/items — "this isn't on the list, please add it".
 *
 * Open to anyone signed in, because being unable to report a missing item is how a
 * catalogue rots. It records a request against the submission, with the photo attached,
 * and moves no stock whatsoever.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw expected('Describe the item you need added.');

    const submission = await prisma.withdrawalSubmission.findUnique({
      where: { id: parsed.data.submissionId },
    });
    if (!submission) throw expected('That submission no longer exists.');
    if (submission.submitterId !== user.id && user.role === 'nurse') {
      throw expected('That submission belongs to someone else.');
    }

    // If this is about a specific line, settle that line too. An item that is not in the
    // catalogue cannot move stock — there is nothing to deduct from — so the line is
    // rejected for stock purposes while the request preserves what was actually taken.
    // Without this the nurse is stuck: the line blocks confirmation and the only other
    // way past it is to delete the evidence.
    let candidateId: string | null = null;
    if (parsed.data.candidateId) {
      const candidate = await prisma.extractedCandidate.findUnique({
        where: { id: parsed.data.candidateId },
      });
      if (!candidate || candidate.submissionId !== submission.id) {
        throw expected('That line no longer exists.');
      }
      candidateId = candidate.id;
    }

    const quantity = parsed.data.quantity ? ` (${parsed.data.quantity} taken)` : '';
    const reviewCase = await prisma.reviewCase.create({
      data: {
        submissionId: submission.id,
        candidateId,
        locationId: submission.locationId,
        kind: 'catalogue_request',
        priority: 'normal',
        summary: `Not in the catalogue: "${parsed.data.description.trim()}"${quantity}`,
        openedById: user.id,
      },
    });

    if (candidateId) {
      await prisma.extractedCandidate.update({
        where: { id: candidateId },
        data: {
          disposition: 'rejected',
          resolvedById: user.id,
          resolvedAt: new Date(),
          decisionMessage: `Asked supply review to add "${parsed.data.description.trim()}". This line will not change stock.`,
        },
      });
    }

    await recordAudit({
      action: AUDIT_ACTIONS.catalogueRequested,
      entityType: 'ReviewCase',
      entityId: reviewCase.id,
      actorId: user.id,
      actorRole: user.role,
      submissionId: submission.id,
      locationId: submission.locationId,
      afterValue: { quantity: parsed.data.quantity ?? null, candidateId },
    });

    return NextResponse.json({ ok: true, reviewCaseId: reviewCase.id }, { status: 201 });
  } catch (error) {
    return routeError(error, { route: 'PUT catalogue request' });
  }
}
