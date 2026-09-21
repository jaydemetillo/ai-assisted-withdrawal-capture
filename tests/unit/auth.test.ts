import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, readSessionToken } from '@/lib/auth/session';
import { signImageToken, verifyImageToken } from '@/lib/storage/signing';

beforeAll(() => {
  process.env.SESSION_SECRET = 'a-test-secret-long-enough-to-pass';
});

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('demo1234');
    await expect(verifyPassword('demo1234', hash)).resolves.toBe(true);
    await expect(verifyPassword('demo12345', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    expect(await hashPassword('demo1234')).not.toBe(await hashPassword('demo1234'));
  });

  it('rejects a malformed or truncated stored hash rather than throwing', async () => {
    for (const stored of ['', 'nonsense', 'scrypt$abc', 'bcrypt$aa$bb']) {
      await expect(verifyPassword('demo1234', stored)).resolves.toBe(false);
    }
  });
});

describe('session tokens', () => {
  it('round-trips a user id', () => {
    expect(readSessionToken(createSessionToken('user-1'))).toBe('user-1');
  });

  it('rejects a tampered user id', () => {
    const token = createSessionToken('user-1');
    expect(readSessionToken(token.replace('user-1', 'user-2'))).toBeNull();
  });

  it('rejects a tampered expiry', () => {
    const [userId, expiry, mac] = createSessionToken('user-1').split('.');
    expect(readSessionToken(`${userId}.${Number(expiry) + 99999}.${mac}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createSessionToken('user-1', Date.now() - 13 * 60 * 60 * 1000);
    expect(readSessionToken(token)).toBeNull();
  });

  it.each(['', 'a.b', 'a.b.c.d', 'garbage'])('rejects malformed token %s', (token) => {
    expect(readSessionToken(token)).toBeNull();
  });

  it('returns null instead of throwing when no secret is configured', () => {
    // The sign-in page calls this on every render. If it threw, a deployment missing
    // SESSION_SECRET would serve a 500 on the one page that could explain the problem.
    const token = createSessionToken('user-1');
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    expect(() => readSessionToken(token)).not.toThrow();
    expect(readSessionToken(token)).toBeNull();
    process.env.SESSION_SECRET = saved;
  });

  it('treats a too-short secret as unconfigured rather than signing with it', () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'tooshort';
    expect(readSessionToken('anything.123.abc')).toBeNull();
    process.env.SESSION_SECRET = saved;
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken('user-1');
    process.env.SESSION_SECRET = 'a-completely-different-secret-value';
    expect(readSessionToken(token)).toBeNull();
    process.env.SESSION_SECRET = 'a-test-secret-long-enough-to-pass';
  });
});

describe('image access tokens', () => {
  const key = 'abc.jpg';

  it('opens for the user it was issued to', () => {
    expect(verifyImageToken(signImageToken(key, 'nurse-1'), key, 'nurse-1')).toBe(true);
  });

  it('does not open for anybody else', () => {
    // A link copied out of one nurse's browser is useless to another.
    expect(verifyImageToken(signImageToken(key, 'nurse-1'), key, 'nurse-2')).toBe(false);
  });

  it('does not open a different image', () => {
    expect(verifyImageToken(signImageToken(key, 'nurse-1'), 'other.jpg', 'nurse-1')).toBe(false);
  });

  it('expires', () => {
    const token = signImageToken(key, 'nurse-1', Date.now() - 10 * 60 * 1000);
    expect(verifyImageToken(token, key, 'nurse-1')).toBe(false);
  });

  it('rejects a missing or malformed token', () => {
    expect(verifyImageToken(null, key, 'nurse-1')).toBe(false);
    expect(verifyImageToken('nonsense', key, 'nurse-1')).toBe(false);
  });
});
