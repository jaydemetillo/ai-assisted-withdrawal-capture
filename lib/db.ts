import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client per process, constructed LAZILY.
 *
 * Two things made this worth more than the obvious three lines:
 *
 * 1. `next build` imports every route module to collect page data. If this file
 *    constructed a client at import time, the build would depend on the database
 *    connection string being readable at build time — and it failed exactly that way on
 *    Vercel. Nothing about compiling a page needs a database, so the client is now built
 *    on first use instead.
 * 2. Next hot-reloads modules in development, which would otherwise open a new
 *    connection pool on every edit until Postgres refuses. The client is cached on
 *    globalThis to survive that, and to be reused across serverless invocations.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon's pooled endpoint is PgBouncer in transaction mode. Prisma needs `pgbouncer=true`
 * on such a URL so it stops relying on named prepared statements that a pooler will not
 * keep between requests.
 *
 * Returns undefined when there is nothing to override — including when DATABASE_URL is
 * absent. Passing `{ db: { url: undefined } }` is NOT the same as omitting `datasources`:
 * Prisma rejects the explicit undefined outright, which is what broke the build.
 */
function datasourceOverride(): { db: { url: string } } | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (!url.includes('-pooler') || /[?&]pgbouncer=/.test(url)) return undefined;
  return { db: { url: `${url}${url.includes('?') ? '&' : '?'}pgbouncer=true&connect_timeout=15` } };
}

function createClient(): PrismaClient {
  const datasources = datasourceOverride();
  return new PrismaClient({
    ...(datasources ? { datasources } : {}),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function client(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

/**
 * Behaves exactly like a PrismaClient to every caller; the real one is created on the
 * first property access. Importing this module does nothing.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in client();
  },
});
