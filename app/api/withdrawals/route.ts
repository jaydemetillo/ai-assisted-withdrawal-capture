import { NextResponse } from 'next/server';
import * as z from 'zod';
import { requireRole } from '@/lib/auth/session';
import { createSubmission, maxImageBytes } from '@/lib/withdrawals/create';
import { expected, routeError } from '@/lib/http';
import { isMockScenario } from '@/lib/extraction/scenarios';
import { extractionProvider } from '@/lib/extraction';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const fieldsSchema = z.object({
  locationId: z.string().min(1, 'Choose a location.'),
  demoScenario: z.string().optional(),
});

/**
 * POST /api/withdrawals — one photo, one location.
 *
 * Responds as soon as the image is durably stored and the row exists. Extraction is not
 * awaited: the nurse is not kept waiting on a model, and the submission survives them
 * closing the phone a second later.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');

    // A nurse submitting more than 30 photos in five minutes is a stuck retry loop, not
    // a shift. Generous on purpose: never get in the way of the real workflow.
    const limit = rateLimit(`upload:${user.id}`, 30, 300);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many uploads just now. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) throw expected('That upload was not readable. Please try again.');

    const parsed = fieldsSchema.safeParse({
      locationId: form.get('locationId'),
      demoScenario: form.get('demoScenario') ?? undefined,
    });
    if (!parsed.success) {
      throw expected(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    }

    const file = form.get('photo');
    if (!(file instanceof File) || file.size === 0) {
      throw expected('Add a photo before submitting.');
    }
    if (file.size > maxImageBytes()) {
      throw expected('That photo is too large. Please take it again.');
    }

    // A demo scenario is only ever honoured by a mock provider. With a real provider it
    // is ignored outright, so a crafted request cannot stage a fake reading.
    const provider = extractionProvider();
    const demoScenario =
      provider.isMock && isMockScenario(parsed.data.demoScenario) ? parsed.data.demoScenario : null;

    const { id } = await createSubmission({
      user,
      locationId: parsed.data.locationId,
      image: { data: Buffer.from(await file.arrayBuffer()), mediaType: file.type },
      demoScenario,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return routeError(error, { route: 'POST /api/withdrawals' });
  }
}
