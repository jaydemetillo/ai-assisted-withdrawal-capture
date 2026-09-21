/**
 * Gets a deployed database ready without anyone running commands locally.
 *
 * Runs during `npm run build` on Vercel, where the Neon integration has already set the
 * connection strings:
 *   1. applies the checked-in migrations, so the tables exist;
 *   2. seeds the catalogue and demo accounts, but ONLY if the database is empty — a
 *      redeploy must never wipe stock somebody moved during a demo.
 *
 * Skipped entirely when not on a deployment host: locally, `npm run setup` covers it.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const onDeployHost = Boolean(process.env.VERCEL);
const url = process.env.DATABASE_URL ?? '';

if (!onDeployHost) {
  console.log('[db] not a deployment build — skipping remote prepare (use `npm run setup`)');
  process.exit(0);
}
if (!url.startsWith('postgres')) {
  // Deliberately NOT a build failure. A failed build leaves you with no URL at all and
  // nothing to read; a successful one gives you a running app whose first screen says,
  // in words, that it needs a database and where to add it. The second is far easier to
  // act on, and nothing can be damaged by deploying without a database.
  console.warn(
    '\n[db] No DATABASE_URL — building anyway.\n' +
      '     The app will start and tell you to add one. In Vercel:\n' +
      '     Storage → Create Database → Neon (Postgres), then redeploy.\n',
  );
  process.exit(0);
}

/**
 * Migrations need a DIRECT connection. Neon's integration points DATABASE_URL at the
 * pooled endpoint — right for the running app, wrong for DDL through a transaction-mode
 * pooler. It also provides the direct endpoint under one of these names.
 */
function directUrl(): string {
  const candidates = [
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DIRECT_DATABASE_URL,
  ];
  return candidates.find((v) => v && v.startsWith('postgres')) ?? url;
}

function run(args: string[], env: Record<string, string>) {
  execFileSync('npx', args, { stdio: 'inherit', env: { ...process.env, ...env } });
}

async function main() {
  const direct = directUrl();
  console.log(`[db] applying migrations over the ${direct === url ? 'configured' : 'direct, unpooled'} connection`);
  try {
    run(['prisma', 'migrate', 'deploy'], { DATABASE_URL: direct });
  } catch (error) {
    // Migrations failing IS a build failure: shipping an app against a schema it does
    // not match produces confusing runtime errors far from the cause.
    console.error(
      '\n[db] Could not apply migrations.\n' +
        '     Most often DATABASE_URL points at a POOLED connection, which cannot run\n' +
        '     schema changes. Neon also exposes a direct one as DATABASE_URL_UNPOOLED;\n' +
        '     this script prefers it automatically when present. Check that variable\n' +
        '     exists on the deployment and that the database is reachable.\n',
    );
    throw error;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: direct } } });
  try {
    const locations = await prisma.location.count();
    if (locations > 0) {
      console.log(`[db] already seeded (${locations} locations) — leaving existing data alone`);
      return;
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  console.log('[db] empty database — seeding the catalogue and demo accounts');
  run(['tsx', 'prisma/seed.ts'], { DATABASE_URL: direct });
}

main().catch((error) => {
  console.error('[db] prepare failed:', error);
  process.exit(1);
});
