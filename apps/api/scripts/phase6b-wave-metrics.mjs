/**
 * Phase 6B read-only wave metrics. Refuses anything except league_helper_m12v2.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b-wave-metrics.mjs
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b-wave-metrics.mjs --out path.json
 */
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('league_helper_m12v2') || url.includes('/league_helper?')) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'REFUSE_DB',
      databaseUrlHostDb: url.replace(/:[^:@/]+@/, ':***@').replace(/\/\/[^@]+@/, '//***@'),
    }),
  );
  process.exit(2);
}

const outIdx = process.argv.indexOf('--out');
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const p = new PrismaClient();
try {
  const [
    trackedBySource,
    ladderRoots,
    snapshotsByTier,
    participantResolved,
    aggregatesByRankTier,
    matchCount,
    participantCount,
    championPosGte1,
    championPosGte30,
    championPosGte100,
  ] = await Promise.all([
    p.trackedPlayer.groupBy({ by: ['enrollmentSource'], _count: true }),
    p.$queryRaw`
      SELECT COALESCE(rs.tier, 'MISSING_SNAPSHOT') AS tier, COUNT(*)::int AS count
      FROM "TrackedPlayer" tp
      INNER JOIN "PlayerAccount" pa ON pa.id = tp."playerAccountId"
      LEFT JOIN LATERAL (
        SELECT r.tier
        FROM "RankSnapshot" r
        WHERE r."playerAccountId" = pa.id
          AND r."queueType" = 'RANKED_SOLO_5x5'
        ORDER BY r."capturedAt" DESC
        LIMIT 1
      ) rs ON true
      WHERE tp."enrollmentSource" = 'LADDER'
        AND tp."discoveryDepth" = 0
      GROUP BY 1
      ORDER BY 1
    `,
    p.rankSnapshot.groupBy({ by: ['tier'], _count: true }),
    p.matchParticipant.groupBy({
      by: ['rankTierAtIngestion'],
      _count: true,
      where: {
        rankResolutionStatus: 'RESOLVED_RANKED',
        match: { queueId: 420, platformRoute: 'na1' },
      },
    }),
    p.championAggregate.groupBy({
      by: ['rankTier'],
      _count: true,
      where: { queueId: 420, platformRoute: 'na1' },
    }),
    p.match.count({ where: { queueId: 420, platformRoute: 'na1' } }),
    p.matchParticipant.count({
      where: { match: { queueId: 420, platformRoute: 'na1' } },
    }),
    p.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT 1
        FROM "ChampionAggregate"
        WHERE "queueId" = 420
          AND "platformRoute" = 'na1'
          AND "rankTier" = 'ALL'
          AND "sampleSize" >= 1
        GROUP BY "championId", "teamPosition"
      ) t
    `,
    p.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT 1
        FROM "ChampionAggregate"
        WHERE "queueId" = 420
          AND "platformRoute" = 'na1'
          AND "rankTier" = 'ALL'
          AND "sampleSize" >= 30
        GROUP BY "championId", "teamPosition"
      ) t
    `,
    p.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT 1
        FROM "ChampionAggregate"
        WHERE "queueId" = 420
          AND "platformRoute" = 'na1'
          AND "rankTier" = 'ALL'
          AND "sampleSize" >= 100
        GROUP BY "championId", "teamPosition"
      ) t
    `,
  ]);

  const ladderCreatedAt = await p.trackedPlayer.findMany({
    where: { enrollmentSource: 'LADDER', discoveryDepth: 0 },
    select: {
      id: true,
      createdAt: true,
      lastSuccessfulRefreshAt: true,
      consecutiveZeroNewMatchRuns: true,
      playerAccount: {
        select: {
          currentGameName: true,
          platformRoute: true,
          rankSnapshots: {
            where: { queueType: 'RANKED_SOLO_5x5' },
            orderBy: { capturedAt: 'desc' },
            take: 1,
            select: { tier: true, capturedAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const report = {
    ok: true,
    db: 'league_helper_m12v2',
    generatedAt: new Date().toISOString(),
    trackedBySource: Object.fromEntries(trackedBySource.map((r) => [r.enrollmentSource, r._count])),
    ladderRootsByLatestSoloTier: Object.fromEntries(
      ladderRoots.map((r) => [r.tier, r.count]),
    ),
    ladderRootCount: ladderCreatedAt.length,
    ladderRootsRefreshed: ladderCreatedAt.filter((r) => r.lastSuccessfulRefreshAt != null).length,
    ladderRootsDetail: ladderCreatedAt.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lastSuccessfulRefreshAt: r.lastSuccessfulRefreshAt?.toISOString() ?? null,
      consecutiveZeroNewMatchRuns: r.consecutiveZeroNewMatchRuns,
      platformRoute: r.playerAccount.platformRoute,
      hasRiotName: Boolean(r.playerAccount.currentGameName),
      latestSoloTier: r.playerAccount.rankSnapshots[0]?.tier ?? null,
    })),
    snapshotsByTier: Object.fromEntries(snapshotsByTier.map((r) => [r.tier, r._count])),
    participantsResolvedByTier: Object.fromEntries(
      participantResolved.map((r) => [r.rankTierAtIngestion ?? 'null', r._count]),
    ),
    aggregatesByRankTier: Object.fromEntries(aggregatesByRankTier.map((r) => [r.rankTier, r._count])),
    matchesQueue420Na1: matchCount,
    participantsQueue420Na1: participantCount,
    championPositionCoverageAll: {
      gte1: championPosGte1[0]?.count ?? 0,
      gte30: championPosGte30[0]?.count ?? 0,
      gte100: championPosGte100[0]?.count ?? 0,
    },
  };

  const text = JSON.stringify(report, null, 2);
  if (outPath) {
    writeFileSync(outPath, `${text}\n`, 'utf8');
  }
  console.log(text);
} finally {
  await p.$disconnect();
}
