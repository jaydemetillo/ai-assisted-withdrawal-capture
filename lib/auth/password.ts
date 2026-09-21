import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/**
 * Password hashing with scrypt from the standard library — no dependency, memory-hard,
 * and entirely adequate for a prototype whose auth module is expected to be replaced by
 * the hospital's identity provider. See the README before deploying anything.
 *
 * Stored as `scrypt$<salt-hex>$<hash-hex>` so the format can be recognised and migrated.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;

  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return timingSafeEqual(derived, expected);
}
