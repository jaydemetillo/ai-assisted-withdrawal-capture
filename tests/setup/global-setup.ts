import { execFileSync } from 'node:child_process';

/**
 * Prepare the integration-test database once per run.
 *
 * Runs migrations and the seed against TEST_DATABASE_URL — never the development
 * database. If no database is reachable, this prints a clear warning and lets the run
 * continue: the pure unit tests do not need one, and the integration tests skip
 * VISIBLY rather than silently passing. `npm run db:up` starts one.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('\n[tests] TEST_DATABASE_URL is not set — integration tests will be skipped.\n');
    return;
  }

  const env = { ...process.env, DATABASE_URL: url };
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'pipe' });
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env, stdio: 'pipe' });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`\n[tests] Could not prepare the test database (${detail}).`);
    console.warn('[tests] Integration tests will be skipped. Run `npm run db:up` to enable them.\n');
  }
}
