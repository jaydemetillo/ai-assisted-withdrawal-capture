import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { routeError } from '@/lib/http';
import { storage } from '@/lib/storage';
import { verifyImageToken } from '@/lib/storage/signing';

export const runtime = 'nodejs';

/**
 * GET /api/images/[key]?t=<token> — the only way to read a capture photo.
 *
 * Three locks, all of which must open:
 *   1. a valid session;
 *   2. a token bound to this key, this user, and an expiry minutes away;
 *   3. a submission row that this user is allowed to see.
 *
 * A link copied out of one nurse's browser therefore opens for nobody else, and stops
 * working shortly afterwards. Every access is audited: who looked at which photo, when.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireRole('nurse', 'supply_reviewer', 'admin');
    const { key } = await params;
    const token = new URL(request.url).searchParams.get('t');

    if (!verifyImageToken(token, key, user.id)) {
      return NextResponse.json({ error: 'That image link has expired.' }, { status: 403 });
    }

    const submission = await prisma.withdrawalSubmission.findFirst({ where: { imageKey: key } });

    // A reference photo is the other thing that lives in storage. It is a picture of a
    // catalogue item rather than a piece of evidence, so any signed-in user with a valid
    // token may see one — but it still needs a row, so an arbitrary key is still a 404.
    if (!submission) {
      const reference = await prisma.itemReferencePhoto.findFirst({ where: { imageKey: key } });
      if (!reference) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

      const photo = await storage().get(key);
      return new NextResponse(new Uint8Array(photo.data), {
        headers: {
          'Content-Type': photo.mediaType,
          'Cache-Control': 'private, max-age=300',
          'Content-Disposition': 'inline',
        },
      });
    }

    if (submission.submitterId !== user.id && user.role === 'nurse') {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const image = await storage().get(key);

    await recordAudit({
      action: AUDIT_ACTIONS.imageAccessed,
      entityType: 'WithdrawalSubmission',
      entityId: submission.id,
      actorId: user.id,
      actorRole: user.role,
      submissionId: submission.id,
      locationId: submission.locationId,
      afterValue: { imageKey: key },
    });

    return new NextResponse(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.mediaType,
        // Private and short-lived: this is evidence, not a static asset.
        'Cache-Control': 'private, max-age=60, no-store',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    return routeError(error, { route: 'GET image' });
  }
}
