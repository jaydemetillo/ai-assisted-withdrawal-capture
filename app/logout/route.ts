import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { clearSessionCookie, currentUser } from '@/lib/auth/session';

export const runtime = 'nodejs';

/** POST /logout — clear the session and go back to sign-in. */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await currentUser();
  if (user) {
    await recordAudit({
      action: AUDIT_ACTIONS.authLogout,
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role,
    });
  }
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
