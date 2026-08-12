/**
 * Phase 6B.1 read-only Riot budget + cooldown + queue snapshot.
 * Refuses anything except league_helper_m12v2. Never prints secrets/PUUIDs.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b1-budget-snapshot.mjs
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b1-budget-snapshot.mjs --out path.json
 */
import { writeFileSync } from 'node:fs';
import { Queue } from 'bullmq';
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

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const dbName = dbNameFromUrl(process.env.DATABASE_URL);
if (dbName !== EXPECTED_DB) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB', database: dbName }));
  process.exit(2);
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

async function queueCounts(name) {
  const queue = new Queue(name, { connection });
  try {
    return await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
      'paused',
    );
  } finally {
    await queue.close();
  }
}

try {
  const now = Date.now();
  const cooldownRaw = await connection.get('riot:shared-429-cooldown');
  const cooldownUntil = cooldownRaw != null ? Number(cooldownRaw) : null;
  const cooldownActive =
    cooldownUntil != null && Number.isFinite(cooldownUntil) && cooldownUntil > now;

  const metrics = await connection.hgetall('riot:request-budget:metrics');
  const observed = await connection.hgetall('riot:request-budget:observed');
  const pressureRaw = await connection.get('riot:request-budget:pressure');
  const pressureUntil = pressureRaw != null ? Number(pressureRaw) : null;

  const shortCard = await connection.zcard('riot:request-budget:win:short');
  const longCard = await connection.zcard('riot:request-budget:win:long');
  const enrichCard = await connection.zcard('riot:request-budget:win:enrichment');

  const num = (field) => {
    const value = Number(metrics?.[field] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const report = {
    ok: true,
    capturedAt: new Date(now).toISOString(),
    database: dbName,
    sharedCooldown: {
      present: cooldownRaw != null,
      active: cooldownActive,
      cooldownUntilMs: Number.isFinite(cooldownUntil) ? cooldownUntil : null,
      remainingMs: cooldownActive ? cooldownUntil - now : 0,
    },
    requestBudget: {
      shortWindowMembers: shortCard,
      longWindowMembers: longCard,
      enrichmentWindowMembers: enrichCard,
      pressureActive:
        pressureUntil != null && Number.isFinite(pressureUntil) && pressureUntil > now,
      pressureRemainingMs:
        pressureUntil != null && Number.isFinite(pressureUntil) && pressureUntil > now
          ? pressureUntil - now
          : 0,
      observed,
      metrics: {
        admitted: num('admitted'),
        delayed: num('delayed'),
        deferred: num('deferred'),
        cooldownBlocked: num('cooldownBlocked'),
        headerPressure: num('headerPressure'),
        starvation: num('starvation'),
        delayedMsTotal: num('delayedMsTotal'),
        byWorkload: {
          match: num('admitted:match'),
          refresh: num('admitted:refresh'),
          enrichment: num('admitted:enrichment'),
          ladder: num('admitted:ladder'),
          identity: num('admitted:identity'),
          product: num('admitted:product'),
          unknown: num('admitted:unknown'),
        },
      },
    },
    queues: {
      matchIngestion: await queueCounts(process.env.MATCH_INGESTION_QUEUE_NAME ?? 'match-ingestion'),
      participantRankEnrichment: await queueCounts(
        process.env.PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME ?? 'participant-rank-enrichment',
      ),
      championAggregation: await queueCounts(
        process.env.CHAMPION_AGGREGATION_QUEUE_NAME ?? 'champion-aggregation',
      ),
    },
  };

  const outPath = argValue('--out');
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  connection.disconnect();
}
