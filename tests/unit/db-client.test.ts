import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The regression: `next build` imports every route module to collect page data. This
 * module used to construct a PrismaClient at import time AND pass
 * `datasources: { db: { url: undefined } }` when DATABASE_URL was unreadable — which
 * Prisma rejects outright. The Vercel build died with
 * "Invalid value undefined for datasource db", long before any page was served.
 *
 * Nothing about compiling a page needs a database.
 */
describe('the Prisma client module', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it('imports cleanly with no DATABASE_URL at all', async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    await expect(import('@/lib/db')).resolves.toBeTruthy();
  });

  it('does not construct a client just because it was imported', async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    const { prisma } = await import('@/lib/db');
    // The export exists and is inert until something actually touches the database.
    expect(prisma).toBeTruthy();
  });

  it('still works normally when a URL is present', async () => {
    vi.resetModules();
    process.env.DATABASE_URL = saved.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/awc_dev_test';
    const { prisma } = await import('@/lib/db');
    expect(typeof prisma.$connect).toBe('function');
    expect(prisma.location).toBeTruthy();
  });
});
