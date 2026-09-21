import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Role, User } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Session handling for the prototype.
 *
 * A signed cookie carrying `userId.expiry.hmac` — no server-side session store, no
 * dependency. Everything else in the application goes through `requireUser()` and
 * `requireRole()`, so replacing this file with an OIDC integration touches nothing else.
 * See the README before deploying: this is not a hospital-grade identity system.
 */
const COOKIE = 'awc_session';
const TTL_SECONDS = 60 * 60 * 12;

export function sessionSecretConfigured(): boolean {
  const value = process.env.SESSION_SECRET;
  return Boolean(value && value.length >= 16);
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      'SESSION_SECRET must be set to at least 16 characters. On Vercel: Settings → Environment Variables, and tick every environment. Generate one with: openssl rand -hex 32',
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function createSessionToken(userId: string, now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = `${userId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the user id, or null for anything malformed, tampered with, or expired. */
export function readSessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  // Without a configured secret nobody can be signed in — but READING must not throw, or
  // the sign-in page itself crashes and the person is left staring at a 500 instead of
  // being told which variable to set.
  if (!sessionSecretConfigured()) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiryText, mac] = parts as [string, string, string];

  const expected = Buffer.from(sign(`${userId}.${expiryText}`), 'utf8');
  const actual = Buffer.from(mac, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry * 1000 < now) return null;
  return userId;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** The signed-in user, or null. Never throws — use `requireUser` when one is required. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const userId = readSessionToken(store.get(COOKIE)?.value);
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user && user.isActive ? user : null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError('You need to sign in.', 401);
  return user;
}

/**
 * Require one of the given roles.
 *
 * Called at the top of every route handler and every page that shows anything beyond the
 * sign-in screen. Authorisation is never inferred from which page the user reached.
 */
export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new AuthError('Your role does not allow this.', 403);
  }
  return user;
}

export function canReview(role: Role): boolean {
  return role === 'supply_reviewer' || role === 'admin';
}
