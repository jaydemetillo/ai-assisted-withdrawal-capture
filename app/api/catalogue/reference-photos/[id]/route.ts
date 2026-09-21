import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { routeError } from '@/lib/http';
import { retireReferencePhoto } from '@/lib/vision/reference-photos';

export const runtime = 'nodejs';

const bodySchema = z.object({ reason: z.string().max(200).optional() });

/**
 * DELETE /api/catalogue/reference-photos/[id] — remove one example.
 *
 * Reviewers and admins only. Teaching is open because an index nobody adds to is no
 * index; un-teaching is not, because removing the example that makes an item recognisable
 * is a quieter change than adding a wrong one and nobody would notice it happening.
 *
 * The removal is a soft delete. It takes effect on the very next photograph — there is
 * no model holding a memory of it — and it stays visible on the recognition screen, so
 * "why did it stop recognising this?" has an answer.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireRole('supply_reviewer', 'admin');
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const reason = parsed.success ? parsed.data.reason : undefined;

    await retireReferencePhoto({ id, actor, reason: reason?.trim() || 'Removed by a reviewer.' });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error, { route: 'DELETE reference photo' });
  }
}
