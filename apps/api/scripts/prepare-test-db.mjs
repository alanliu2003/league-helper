import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');

// M12-v2: keep integration tests off abandoned `league_helper` public data.
// Dedicated schema on the working DB (parallel-safe vs worker_test schema).
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_test';

execSync('npx prisma migrate deploy', {
  cwd: apiRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  },
});

console.log(`Test schema ready: ${testDatabaseUrl}`);
