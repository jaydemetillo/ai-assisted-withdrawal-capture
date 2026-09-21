import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { expected, routeError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * POST /api/withdrawals/[id]/cancel
 *
 * Cancelling marks the submission and stops it being confirmable. It does NOT delete the
 * image, the extracted text or the proposals: a cancelled submission is still a record
 * that a photo was taken and then withdrawn, which is exactly the kind of thing an audit
 * needs to be able to see.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { id } = await params;

    const submission = await prisma.withdrawalSubmission.findUnique({ where: { id } });
    if (!submission) throw expected('That submission no longer exists.');
    if (submission.submitterId !== user.id && user.role === 'nurse') {
      throw expected('That submission belongs to someone else.');
    }
    if (submission.status === 'confirmed') {
      throw expected('This withdrawal has already been confirmed and cannot be cancelled.');
    }

    await prisma.withdrawalSubmission.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await prisma.reviewCase.updateMany({
      where: { submissionId: id, status: { in: ['open', 'in_progress'] } },
      data: { status: 'rejected', resolutionNote: 'Submission cancelled by the submitter.' },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.submissionCancelled,
      entityType: 'WithdrawalSubmission',
      entityId: id,
      actorId: user.id,
      actorRole: user.role,
      submissionId: id,
      locationId: submission.locationId,
      beforeValue: { status: submission.status },
      afterValue: { status: 'cancelled' },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error, { route: 'POST cancel' });
  }
}
