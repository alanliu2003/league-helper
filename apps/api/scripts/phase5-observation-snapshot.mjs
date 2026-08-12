/**
 * M12-v2 Phase 5 read-only observation ops snapshot.
 * Guards against abandoned DB `league_helper`. Never prints secrets/PUUIDs.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase5-observation-snapshot.mjs
 *   node --env-file=apps/api/.env apps/api/scripts/phase5-observation-snapshot.mjs --since <ISO>
 *   node --env-file=apps/api/.env apps/api/scripts/phase5-observation-snapshot.mjs --baseline <path.json>
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const EXPECTED_DB = 'league_helper_m12v2';
const FORBIDDEN_DB = 'league_helper';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

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

function countsBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const k = row[key] ?? 'null';
    out[k] = (out[k] ?? 0) + row._count._all;
  }
  return out;
}

async function queueCounts(redisUrl, queueName) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  try {
    const queue = new Queue(queueName, { connection });
    try {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
        'paused',
      );
      return counts;
    } finally {
      await queue.close();
    }
  } finally {
    connection.disconnect();
  }
}

async function sharedCooldownActive(redisUrl) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  try {
    // Canonical value: epoch-ms decimal string (see @league-helper/server-riot).
    const raw = await connection.get('riot:shared-429-cooldown');
    if (!raw) {
      return { present: false, active: false, cooldownUntilMs: null, remainingMs: 0 };
    }
    const until = Number(String(raw).trim());
    if (!Number.isFinite(until)) {
      return {
        present: true,
        active: false,
        cooldownUntilMs: null,
        remainingMs: 0,
        parseError: true,
      };
    }
    const now = Date.now();
    const active = until > now;
    return {
      present: true,
      active,
      cooldownUntilMs: until,
      remainingMs: active ? until - now : 0,
    };
  } finally {
    connection.disconnect();
  }
}

const dbName = dbNameFromUrl(process.env.DATABASE_URL);
if (dbName !== EXPECTED_DB) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'DB_GUARD_FAILED',
      expected: EXPECTED_DB,
      actual: dbName,
      forbidden: FORBIDDEN_DB,
    }),
  );
  process.exit(1);
}

const sinceRaw = argValue('--since');
const since = sinceRaw ? new Date(sinceRaw) : null;
if (sinceRaw && Number.isNaN(since.getTime())) {
  console.error(JSON.stringify({ ok: false, error: 'INVALID_SINCE', received: sinceRaw }));
  process.exit(1);
}

const outPath = argValue('--out');
const baselinePath = argValue('--baseline');

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ingestQueueName = process.env.MATCH_INGESTION_QUEUE_NAME ?? 'match-ingestion';
const rankQueueName =
  process.env.PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME ?? 'participant-rank-enrichment';
const aggQueueName = process.env.CHAMPION_AGGREGATION_QUEUE_NAME ?? 'champion-aggregation';

try {
  const now = new Date();

  const coldAfterZeroNewRuns = Number(
    process.env.COLLECTOR_COLD_AFTER_ZERO_NEW_RUNS ?? '3',
  );

  const [
    trackedBySource,
    trackedByStatus,
    trackedPlayers,
    playerAccountCount,
    matchCount,
    matchCompletedCount,
    rankedEligible,
    rankStatusGroups,
    ingestionByStatus,
    schedulerState,
    recentRuns,
    championPositionAggCount,
    rankResolvedSampleCount,
  ] = await Promise.all([
    prisma.trackedPlayer.groupBy({
      by: ['enrollmentSource'],
      _count: { _all: true },
    }),
    prisma.trackedPlayer.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.trackedPlayer.findMany({
      select: {
        status: true,
        priority: true,
        consecutiveZeroNewMatchRuns: true,
        lastSuccessfulRefreshAt: true,
        nextEligibleAt: true,
      },
    }),
    prisma.playerAccount.count(),
    prisma.match.count(),
    prisma.match.count({ where: { ingestionStatus: 'COMPLETED' } }),
    prisma.matchParticipant.count({
      where: {
        rankResolutionStatus: { not: 'NOT_APPLICABLE' },
        match: { ingestionStatus: 'COMPLETED', remake: false, queueId: { in: [420, 440] } },
      },
    }),
    prisma.matchParticipant.groupBy({
      by: ['rankResolutionStatus'],
      where: {
        rankResolutionStatus: { not: 'NOT_APPLICABLE' },
        match: { ingestionStatus: 'COMPLETED', remake: false, queueId: { in: [420, 440] } },
      },
      _count: { _all: true },
    }),
    prisma.ingestionJobRecord.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.collectorSchedulerState.findUnique({ where: { id: 'singleton' } }),
    prisma.collectorRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        playersClaimed: true,
        playersAttempted: true,
        playersSucceeded: true,
        playersFailed: true,
        matchIdsDiscovered: true,
        matchesEnqueued: true,
        matchesSkippedComplete: true,
        rateLimitStops: true,
        failureCode: true,
      },
    }),
    prisma.championAggregate.count(),
    prisma.matchParticipant.count({
      where: {
        rankResolutionStatus: { in: ['RESOLVED_RANKED', 'RESOLVED_UNRANKED'] },
        match: { ingestionStatus: 'COMPLETED', remake: false, queueId: { in: [420, 440] } },
      },
    }),
  ]);

  // Activity tier is not a DB column; infer from success-path streak (HOT requires last run enqueued >=1).
  const inferredActivity = { HOT: 0, WARM: 0, COLD: 0, NEVER_REFRESHED: 0 };
  for (const player of trackedPlayers) {
    if (player.lastSuccessfulRefreshAt == null) {
      inferredActivity.NEVER_REFRESHED += 1;
      continue;
    }
    if (player.consecutiveZeroNewMatchRuns >= coldAfterZeroNewRuns) {
      inferredActivity.COLD += 1;
    } else if (player.consecutiveZeroNewMatchRuns === 0) {
      inferredActivity.HOT += 1;
    } else {
      inferredActivity.WARM += 1;
    }
  }

  const windowFilter = since ? { gte: since } : undefined;

  const [
    matchesCreatedInWindow,
    uniqueMatchesInWindow,
    rankResolvedInWindow,
    observationsInWindow,
    runsInWindow,
    avgEnrichmentLag,
  ] = await Promise.all([
    prisma.match.count({
      where: windowFilter ? { createdAt: windowFilter } : undefined,
    }),
    prisma.match.count({
      where: {
        ingestionStatus: 'COMPLETED',
        ...(windowFilter ? { updatedAt: windowFilter } : {}),
      },
    }),
    prisma.matchParticipant.count({
      where: {
        rankResolutionStatus: { in: ['RESOLVED_RANKED', 'RESOLVED_UNRANKED'] },
        ...(windowFilter ? { rankResolvedAt: windowFilter } : {}),
        match: { ingestionStatus: 'COMPLETED', remake: false, queueId: { in: [420, 440] } },
      },
    }),
    prisma.participantRankObservation.count({
      where: windowFilter ? { observedAt: windowFilter } : undefined,
    }),
    prisma.collectorRun.findMany({
      where: windowFilter ? { startedAt: windowFilter } : undefined,
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        playersClaimed: true,
        playersAttempted: true,
        playersSucceeded: true,
        playersFailed: true,
        matchIdsDiscovered: true,
        matchesEnqueued: true,
        matchesSkippedComplete: true,
        rateLimitStops: true,
        failureCode: true,
      },
    }),
    since
      ? prisma.$queryRaw`
          SELECT
            COUNT(*)::int AS "sampleCount",
            AVG(EXTRACT(EPOCH FROM (mp."rankResolvedAt" - m."updatedAt")) * 1000)::float AS "avgLagMs",
            PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (mp."rankResolvedAt" - m."updatedAt")) * 1000
            )::float AS "p50LagMs"
          FROM "MatchParticipant" mp
          JOIN "Match" m ON m.id = mp."matchId"
          WHERE mp."rankResolvedAt" IS NOT NULL
            AND mp."rankResolvedAt" >= ${since}
            AND m."ingestionStatus" = 'COMPLETED'
            AND m.remake = false
            AND m."queueId" IN (420, 440)
        `
      : Promise.resolve([{ sampleCount: 0, avgLagMs: null, p50LagMs: null }]),
  ]);

  const stateCounts = Object.fromEntries(
    rankStatusGroups.map((g) => [g.rankResolutionStatus, g._count._all]),
  );
  const eligible = rankedEligible;
  const resolvedRanked = stateCounts.RESOLVED_RANKED ?? 0;
  const resolvedUnranked = stateCounts.RESOLVED_UNRANKED ?? 0;
  const pending = stateCounts.PENDING ?? 0;
  const retryable = stateCounts.FAILED_RETRYABLE ?? 0;
  const permanent = stateCounts.FAILED_PERMANENT ?? 0;
  const resolved = resolvedRanked + resolvedUnranked;
  const exactRankCoverage = eligible > 0 ? resolvedRanked / eligible : null;
  const rankResolutionCoverage = eligible > 0 ? resolved / eligible : null;

  let bullmq = null;
  let cooldown = null;
  try {
    const [ingest, rank, agg, cd] = await Promise.all([
      queueCounts(redisUrl, ingestQueueName),
      queueCounts(redisUrl, rankQueueName),
      queueCounts(redisUrl, aggQueueName),
      sharedCooldownActive(redisUrl),
    ]);
    bullmq = {
      matchIngestion: ingest,
      participantRankEnrichment: rank,
      championAggregation: agg,
    };
    cooldown = cd;
  } catch (error) {
    bullmq = {
      error: error instanceof Error ? error.message : 'queue probe failed',
    };
  }

  const runTotals = runsInWindow.reduce(
    (acc, run) => {
      acc.playersClaimed += run.playersClaimed;
      acc.playersAttempted += run.playersAttempted;
      acc.playersSucceeded += run.playersSucceeded;
      acc.playersFailed += run.playersFailed;
      acc.matchIdsDiscovered += run.matchIdsDiscovered;
      acc.matchesEnqueued += run.matchesEnqueued;
      acc.matchesSkippedComplete += run.matchesSkippedComplete;
      acc.rateLimitStops += run.rateLimitStops;
      return acc;
    },
    {
      playersClaimed: 0,
      playersAttempted: 0,
      playersSucceeded: 0,
      playersFailed: 0,
      matchIdsDiscovered: 0,
      matchesEnqueued: 0,
      matchesSkippedComplete: 0,
      rateLimitStops: 0,
    },
  );

  const refreshedPlayers = runTotals.playersSucceeded;
  const uniqueMatchYield =
    refreshedPlayers > 0 ? runTotals.matchesEnqueued / refreshedPlayers : null;

  const lagRow = Array.isArray(avgEnrichmentLag) ? avgEnrichmentLag[0] : null;

  const snapshot = {
    ok: true,
    capturedAt: now.toISOString(),
    database: dbName,
    since: since ? since.toISOString() : null,
    population: {
      trackedPlayersBySource: countsBy(trackedBySource, 'enrollmentSource'),
      trackedPlayersByStatus: countsBy(trackedByStatus, 'status'),
      inferredActivityTier: inferredActivity,
      inferredActivityTierNote:
        'HOT≈streak0 after success; WARM≈1..coldAfter-1; COLD≥COLLECTOR_COLD_AFTER_ZERO_NEW_RUNS; not a persisted column',
      coldAfterZeroNewRuns,
      eligibleNowCount: trackedPlayers.filter(
        (p) => p.status === 'ACTIVE' && p.nextEligibleAt.getTime() <= now.getTime(),
      ).length,
      playerAccountCount,
    },
    matches: {
      total: matchCount,
      completed: matchCompletedCount,
      createdInWindow: matchesCreatedInWindow,
      completedTouchedInWindow: uniqueMatchesInWindow,
    },
    rankHealth: {
      eligibleRankedParticipants: eligible,
      stateCounts,
      pending,
      retryable,
      permanent,
      exactRankCoverage,
      rankResolutionCoverage,
      rankResolvedSamples: rankResolvedSampleCount,
      rankResolvedInWindow,
      observationsInWindow,
    },
    enrichmentLag: {
      sampleCount: lagRow?.sampleCount ?? 0,
      avgLagMs: lagRow?.avgLagMs ?? null,
      p50LagMs: lagRow?.p50LagMs ?? null,
      note: 'lag = rankResolvedAt - match.updatedAt (ingestion completion proxy)',
    },
    aggregates: {
      championAggregateCount: championPositionAggCount,
    },
    ingestionJobsByStatus: countsBy(ingestionByStatus, 'status'),
    scheduler: {
      leaseOwnerPresent: Boolean(schedulerState?.leaseOwner),
      leaseExpiresAt: schedulerState?.leaseExpiresAt?.toISOString() ?? null,
      lastTriggerAt: schedulerState?.lastTriggerAt?.toISOString() ?? null,
      lastOutcome: schedulerState?.lastOutcome ?? null,
      cooldownUntil: schedulerState?.cooldownUntil?.toISOString() ?? null,
      cooldownActive: Boolean(
        schedulerState?.cooldownUntil && schedulerState.cooldownUntil.getTime() > now.getTime(),
      ),
    },
    collectorRuns: {
      recent: recentRuns.map((r) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      inWindow: runsInWindow.map((r) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      windowTotals: runTotals,
      uniqueMatchYieldPerRefreshedPlayer: uniqueMatchYield,
      refreshSuccessRate:
        runTotals.playersAttempted > 0
          ? runTotals.playersSucceeded / runTotals.playersAttempted
          : null,
    },
    bullmq,
    sharedRiotCooldown: cooldown,
  };

  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    snapshot.deltaFromBaseline = {
      baselineCapturedAt: baseline.capturedAt ?? null,
      matchesTotal: matchCount - (baseline.matches?.total ?? 0),
      matchesCompleted: matchCompletedCount - (baseline.matches?.completed ?? 0),
      championAggregates:
        championPositionAggCount -
        (baseline.aggregates?.championAggregateCount ??
          baseline.aggregates?.championPositionAggregateCount ??
          0),
      rankResolvedSamples:
        rankResolvedSampleCount - (baseline.rankHealth?.rankResolvedSamples ?? 0),
      trackedPlayers:
        Object.values(countsBy(trackedBySource, 'enrollmentSource')).reduce((a, b) => a + b, 0) -
        Object.values(baseline.population?.trackedPlayersBySource ?? {}).reduce(
          (a, b) => a + b,
          0,
        ),
    };
  }

  const text = JSON.stringify(snapshot, null, 2);
  if (outPath) {
    writeFileSync(outPath, `${text}\n`, 'utf8');
  }
  console.log(text);
} finally {
  await prisma.$disconnect();
}
