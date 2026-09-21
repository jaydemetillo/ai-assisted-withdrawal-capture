import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { routeError, expected } from '@/lib/http';
import { runExtraction } from '@/lib/withdrawals/extract';

export const runtime = 'nodejs';
// A vision read of a large photo can take longer than a serverless default allows.
export const maxDuration = 60;

/**
 * POST /api/withdrawals/[id]/extract
 *
 * Idempotent by compare-and-set: the first caller claims the extraction, everyone else
 * gets the current state. The processing screen calls this on mount, and again if the
 * user retries — neither can start a second read.
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

    const outcome = await runExtraction(id);
    return NextResponse.json(outcome);
  } catch (error) {
    return routeError(error, { route: 'POST /api/withdrawals/[id]/extract' });
  }
}
