/**
 * Phase 6B.2 ops helper: reset Riot request-budget cumulative metrics for clean stage deltas.
 * Refuses anything except league_helper_m12v2. Does not clear active windows/cooldown.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b2-reset-budget-metrics.mjs
 */
import IORedis from 'ioredis';

const EXPECTED_DB = 'league_helper_m12v2';

function dbNameFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, '') || null;
  } catch {
    const m = String(url).match(/\/\/(?:[^@]+@)?[^/]+\/([^?]+)/);
    return m?.[1] ?? null;
  }
}

const dbName = dbNameFromUrl(process.env.DATABASE_URL);
if (dbName !== EXPECTED_DB) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB', database: dbName }));
  process.exit(2);
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

try {
  const key = 'riot:request-budget:metrics';
  const before = await connection.hgetall(key);
  const deleted = await connection.del(key);
  console.log(
    JSON.stringify(
      {
        ok: true,
        database: dbName,
        key,
        deleted,
        beforeAdmitted: Number(before.admitted ?? 0),
        note: 'Cumulative metrics cleared. Active short/long windows and shared cooldown untouched.',
      },
      null,
      2,
    ),
  );
} finally {
  connection.disconnect();
}
