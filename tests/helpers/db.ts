import { PrismaClient } from '@prisma/client';
import { describe } from 'vitest';

/**
 * A Prisma client bound to TEST_DATABASE_URL, and a `describe` that skips visibly when
 * no database is reachable.
 *
 * Skipping is deliberate rather than failing the run: a contributor who has not started
 * Postgres still gets the pure unit tests. It is never silent — vitest prints the
 * skipped suites, and the global setup prints why.
 */
const url = process.env.TEST_DATABASE_URL;

export const testPrisma = new PrismaClient({
  datasources: { db: { url: url ?? 'postgresql://invalid' } },
});

let reachable: boolean | null = null;

export async function databaseIsReachable(): Promise<boolean> {
  if (reachable !== null) return reachable;
  if (!url) return (reachable = false);
  try {
    await testPrisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    reachable = false;
  }
  return reachable;
}

/** Use in place of `describe` for anything that touches the database. */
export const describeWithDb: typeof describe | typeof describe.skip = (await databaseIsReachable())
  ? describe
  : describe.skip;
