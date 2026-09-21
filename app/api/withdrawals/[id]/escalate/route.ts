import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { expected, routeError } from '@/lib/http';
import { openCasesForUnresolved } from '@/lib/withdrawals/extract';

export const runtime = 'nodejs';

/**
 * POST /api/withdrawals/[id]/escalate — hand the whole submission to supply review.
 *
 * Always available, and never destructive: the photo, the extracted text and every
 * proposal stay exactly as they were. This is the escape hatch that makes it safe for the
 * Confirm button to be strict — a nurse is never stuck.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { id } = await params;

    const submission = await prisma.withdrawalSubmission.findUnique({
      where: { id },
      include: { candidates: true },
    });
    if (!submission) throw expected('That submission no longer exists.');
    if (submission.submitterId !== user.id && user.role === 'nurse') {
      throw expected('That submission belongs to someone else.');
    }
    if (submission.status === 'confirmed') throw expected('This withdrawal has already been confirmed.');
    if (submission.status === 'cancelled') throw expected('This submission was cancelled.');

    await prisma.withdrawalSubmission.update({
      where: { id },
      data: { status: 'in_supply_review' },
    });
    await prisma.extractedCandidate.updateMany({
      where: { submissionId: id, disposition: 'pending' },
      data: { disposition: 'escalated' },
    });

    // Anything the rules could not resolve already has a case; make sure the rest of the
    // submission is represented too, so the queue shows the whole note.
    if (submission.candidates.every((c) => c.decision === 'eligible')) {
      await prisma.reviewCase.create({
        data: {
          submissionId: submission.id,
          locationId: submission.locationId,
          kind: 'unmatched_candidate',
          summary: 'Sent to supply review by the submitter.',
        },
      });
    } else {
      await openCasesForUnresolved(submission.id);
    }

    await recordAudit({
      action: AUDIT_ACTIONS.submissionEscalated,
      entityType: 'WithdrawalSubmission',
      entityId: submission.id,
      actorId: user.id,
      actorRole: user.role,
      submissionId: submission.id,
      locationId: submission.locationId,
      beforeValue: { status: submission.status },
      afterValue: { status: 'in_supply_review' },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error, { route: 'POST escalate' });
  }
}
