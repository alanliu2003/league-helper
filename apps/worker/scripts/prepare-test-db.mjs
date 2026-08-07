/**
 * Apply migrations to the worker integration-test schema.
 * Uses a dedicated schema so parallel `pnpm test` (api + worker) cannot
 * TRUNCATE each other's fixtures in league_helper_test.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '../../api');

// Do not fall back to TEST_DATABASE_URL (API schema) — parallel pnpm test would race.
const testDatabaseUrl =
  process.env.WORKER_TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_worker_test';

execSync('npx prisma migrate deploy', {
  cwd: apiRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  },
});

console.log(`Worker test schema ready: ${testDatabaseUrl}`);
