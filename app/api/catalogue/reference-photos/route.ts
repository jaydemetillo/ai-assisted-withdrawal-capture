import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { expected, routeError } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { isSupportedMediaType } from '@/lib/storage';
import { maxImageBytes } from '@/lib/withdrawals/create';
import { visualRecognitionEnabled } from '@/lib/vision/embedding';
import { addReferencePhoto } from '@/lib/vision/reference-photos';

export const runtime = 'nodejs';
export const maxDuration = 30;

const fieldsSchema = z.object({
  itemId: z.string().min(1, 'Choose which item this is.'),
  locationId: z.string().min(1, 'Choose a location.'),
});

/**
 * POST /api/catalogue/reference-photos — teach the recogniser one item.
 *
 * Open to nurses as well as reviewers, and that is a deliberate trade. Teaching gated
 * behind a reviewer means the index only grows when somebody with a queue finds an
 * afternoon, which is another way of saying it never grows. The counterweight is that
 * every example records who labelled it, every example is visible on the recognition
 * screen, and an example that keeps producing corrections quarantines itself — so one
 * person's mistake is detectable and one click from being gone.
 *
 * This endpoint cannot move stock. It writes one row to ItemReferencePhoto and nothing
 * else; a mislabelled photo makes a suggestion worse, and a suggestion is all it can
 * ever be, because a visually identified line can never reach `eligible`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');

    if (!visualRecognitionEnabled()) {
      throw expected('Visual recognition is switched off on this deployment.');
    }

    const limit = rateLimit(`teach:${user.id}`, 60, 300);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'That is a lot of photos at once. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) throw expected('That upload was not readable. Please try again.');

    const parsed = fieldsSchema.safeParse({
      itemId: form.get('itemId'),
      locationId: form.get('locationId'),
    });
    if (!parsed.success) throw expected(parsed.error.issues[0]?.message ?? 'Check the form and try again.');

    const file = form.get('photo');
    if (!(file instanceof File) || file.size === 0) throw expected('Add a photo first.');
    if (file.size > maxImageBytes()) throw expected('That photo is too large. Please take it again.');
    if (!isSupportedMediaType(file.type)) {
      throw expected('That image type is not supported. Use a JPEG, PNG or WebP photo.');
    }

    const created = await addReferencePhoto({
      itemId: parsed.data.itemId,
      locationId: parsed.data.locationId,
      image: { data: Buffer.from(await file.arrayBuffer()), mediaType: file.type },
      source: 'taught',
      labelledBy: user,
    });

    if (!created) throw expected('That photo could not be added.');
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    return routeError(error, { route: 'POST reference photo' });
  }
}
