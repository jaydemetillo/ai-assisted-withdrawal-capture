/**
 * Gets a deployed database ready without anyone running commands locally.
 *
 * Runs during `npm run build`, where DATABASE_URL is already set by the host:
 *   1. pushes the schema, so the tables exist;
 *   2. seeds the catalogue, but ONLY if the database is empty.
 *
 * The emptiness check is what makes a redeploy safe - `prisma/seed.ts` clears every
 * table before writing, so seeding on every build would silently wipe whatever was
 * captured during a demo.
 *
 * Skipped entirely for a local SQLite file, where `npm run setup` already covers it.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
const isRemote = url.startsWith('postgres') || url.startsWith('mysql');

if (!isRemote) {
  console.log('[db] local database — skipping remote prepare (use `npm run setup`)');
  process.exit(0);
}

/**
 * Schema changes need a DIRECT connection, not a pooled one.
 *
 * Neon's Vercel integration points DATABASE_URL at the pooled endpoint, which is right
 * for a serverless app - many short-lived connections - but wrong for DDL: `prisma db
 * push` through a transaction-mode pooler fails. The integration also provides the
 * direct endpoint alongside it, under one of these names depending on which integration
 * added it, so prefer that for the push and leave the app on the pooled URL.
 */
function directUrl(): string {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DIRECT_DATABASE_URL,
  ];
  return candidates.find((value) => value && value.startsWith('postgres')) ?? url;
}

function run(args: string[], env?: Record<string, string>) {
  execFileSync('npx', args, { stdio: 'inherit', env: { ...process.env, ...env } });
}

async function main() {
  const direct = directUrl();
  console.log(
    `[db] pushing schema (using the ${direct === url ? 'configured' : 'direct, unpooled'} connection)`,
  );
  try {
    run(['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { DATABASE_URL: direct });
  } catch (error) {
    console.error(
      '\n[db] Could not apply the schema.\n' +
        '     Most often this is DATABASE_URL pointing at a POOLED connection, which\n' +
        '     cannot run schema changes. Neon and Vercel Postgres also expose a direct\n' +
        '     one - DATABASE_URL_UNPOOLED or POSTGRES_URL_NON_POOLING - and this script\n' +
        '     uses it automatically when present. Check that variable exists on the\n' +
        '     deployment, and that the database is reachable from the build.\n',
    );
    throw error;
  }

  const prisma = new PrismaClient();
  try {
    const storerooms = await prisma.storeroom.count();
    if (storerooms > 0) {
      console.log(`[db] already seeded (${storerooms} storerooms) - leaving existing data alone`);
      return;
    }
    console.log('[db] empty database - seeding the catalogue');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
  // Seeding opens its own client, so disconnect before handing over. It writes rows
  // rather than DDL, so the pooled connection is fine - but the direct one is fine too
  // and keeps this consistent with the push above.
  run(['tsx', 'prisma/seed.ts'], { DATABASE_URL: direct });
}

main().catch((error) => {
  console.error('[db] prepare failed:', error);
  process.exit(1);
});
