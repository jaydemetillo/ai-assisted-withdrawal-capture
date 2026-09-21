import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, user-bound tokens for image access.
 *
 * An image URL is not a capability anyone can pass around: the token is bound to the
 * image key AND the user it was issued to AND an expiry, so a link copied out of one
 * nurse's browser does not open for anybody else, and stops working within minutes.
 *
 * The route that serves images checks the session as well. This is defence in depth, not
 * the only lock on the door.
 */
function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error('SESSION_SECRET must be set to at least 16 characters. See .env.example.');
  }
  return value;
}

export function imageTokenTtlSeconds(): number {
  const raw = Number(process.env.IMAGE_URL_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300;
}

export function signImageToken(key: string, userId: string, now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + imageTokenTtlSeconds();
  const mac = createHmac('sha256', secret()).update(`${key}.${userId}.${expiry}`).digest('hex');
  return `${expiry}.${mac}`;
}

export function verifyImageToken(
  token: string | null,
  key: string,
  userId: string,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiryText, mac] = parts as [string, string];

  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry * 1000 < now) return false;

  const expected = Buffer.from(
    createHmac('sha256', secret()).update(`${key}.${userId}.${expiry}`).digest('hex'),
    'utf8',
  );
  const actual = Buffer.from(mac, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
