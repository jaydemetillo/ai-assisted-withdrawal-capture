import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests talk to TEST_DATABASE_URL, never the development database.
 *
 * It is written back onto process.env because `test.env` only reaches the test workers,
 * and the global setup — which runs migrations and the seed — runs in this process.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/awc_dev_test?schema=public';
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    // DATABASE_URL is pointed at the TEST database for the whole run, so a service that
    // imports the shared Prisma client can never reach the development one from a test.
    env: {
      TEST_DATABASE_URL,
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: 'test-session-secret-not-used-in-production',
      NODE_ENV: 'test',
    },
    // Integration tests share one database and would otherwise race each other; the
    // unit tests are pure and do not care either way.
    fileParallelism: false,
  },
});
