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

function run(args: string[]) {
  execFileSync('npx', args, { stdio: 'inherit' });
}

async function main() {
  console.log('[db] pushing schema to the deployed database');
  run(['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss']);

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
  // Seeding opens its own client, so disconnect before handing over.
  run(['tsx', 'prisma/seed.ts']);
}

main().catch((error) => {
  console.error('[db] prepare failed:', error);
  process.exit(1);
});
