/**
 * Prisma pins the datasource provider inside schema.prisma, but this prototype needs to
 * run on SQLite locally (zero setup) and Postgres on Vercel (no persistent disk).
 *
 * This rewrites the provider to match DATABASE_URL before generate/build, so the same
 * repository deploys either way without a manual edit. Runs automatically from
 * `npm run build` and `npm run setup`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SCHEMA = 'prisma/schema.prisma';
const url = process.env.DATABASE_URL ?? 'file:./dev.db';
const provider = url.startsWith('postgres') ? 'postgresql' : url.startsWith('mysql') ? 'mysql' : 'sqlite';

const before = readFileSync(SCHEMA, 'utf8');
const after = before.replace(/(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"/s, `$1"${provider}"`);

if (before !== after) {
  writeFileSync(SCHEMA, after);
  console.log(`[db] provider -> ${provider} (from DATABASE_URL)`);
} else {
  console.log(`[db] provider already ${provider}`);
}
