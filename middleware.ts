import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cross-site request forgery: the second lock.
 *
 * The session cookie is already `SameSite=lax`, which stops a cross-site form POST
 * carrying it. This adds the check that does not depend on the browser getting that
 * right: a state-changing request must come from this origin, or it does not run.
 *
 * GET and HEAD are left alone — they change nothing, and the image route has its own
 * token check.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function middleware(request: NextRequest) {
  if (!MUTATING.has(request.method)) return NextResponse.next();

  const origin = request.headers.get('origin');
  // A same-origin fetch from a browser always sends Origin on a mutation. A missing one
  // means a non-browser client, which is fine for curl against a dev server but must not
  // be treated as proof of anything.
  if (!origin) return NextResponse.next();

  const expected = request.nextUrl.origin;
  const forwardedHost = request.headers.get('x-forwarded-host');
  const allowed = new Set([expected]);
  if (forwardedHost) {
    allowed.add(`https://${forwardedHost}`);
    allowed.add(`http://${forwardedHost}`);
  }

  if (!allowed.has(origin)) {
    return NextResponse.json({ error: 'Request blocked: unexpected origin.' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/login', '/logout', '/withdrawals/:path*', '/supply-review/:path*'],
};
