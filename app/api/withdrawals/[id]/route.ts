import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { expected, routeError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * GET /api/withdrawals/[id] — status for the processing screen to poll.
 *
 * Deliberately thin: statuses and counts, never the extracted text. The review screen
 * renders that server-side, where it does not pass through a client-visible log.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { id } = await params;

    const submission = await prisma.withdrawalSubmission.findUnique({
      where: { id },
      include: { candidates: { select: { decision: true } } },
    });
    if (!submission) throw expected('That submission no longer exists.');
    if (submission.submitterId !== user.id && user.role === 'nurse') {
      throw expected('That submission belongs to someone else.');
    }

    return NextResponse.json({
      id: submission.id,
      status: submission.status,
      extractionStatus: submission.extractionStatus,
      candidateCount: submission.candidates.length,
      blockingCount: submission.candidates.filter((c) => c.decision !== 'eligible').length,
      error: submission.extractionError,
    });
  } catch (error) {
    return routeError(error, { route: 'GET /api/withdrawals/[id]' });
  }
}
