import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { confirmWithdrawal } from '@/lib/inventory/confirm';
import { routeError } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const bodySchema = z.object({ idempotencyKey: z.string().min(8).max(200).optional() }).optional();

/**
 * POST /api/withdrawals/[id]/confirm — the only endpoint that changes stock.
 *
 * Everything in the request body is a proposal to check, never a source of truth: the
 * submission, its candidates and the catalogue are all re-read server-side and the
 * decision rules run again before anything is written.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { id } = await params;

    // The endpoint is idempotent, so repeats are harmless — this only stops a runaway
    // client burning database transactions.
    const limit = rateLimit(`confirm:${actor.id}`, 60, 60);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many attempts just now. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
    const idempotencyKey = parsed.success ? parsed.data?.idempotencyKey : undefined;

    const result = await confirmWithdrawal({ submissionId: id, actor, idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    return routeError(error, { route: 'POST confirm' });
  }
}
