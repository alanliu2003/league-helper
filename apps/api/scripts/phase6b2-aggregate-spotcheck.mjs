/**
 * Phase 6B.2 aggregate correctness spot-check (420/na1).
 * Refuses anything except league_helper_m12v2.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('league_helper_m12v2') || url.includes('/league_helper?')) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB' }));
  process.exit(2);
}

const p = new PrismaClient();
try {
  const [eligibleAll, resolvedRanked, resolvedUnranked, pending, agg] = await Promise.all([
    p.matchParticipant.count({
      where: {
        match: { queueId: 420, platformRoute: 'na1', ingestionStatus: 'COMPLETED' },
        NOT: { teamPosition: '' },
      },
    }),
    p.matchParticipant.count({
      where: {
        match: { queueId: 420, platformRoute: 'na1' },
        rankResolutionStatus: 'RESOLVED_RANKED',
      },
    }),
    p.matchParticipant.count({
      where: {
        match: { queueId: 420, platformRoute: 'na1' },
        rankResolutionStatus: 'RESOLVED_UNRANKED',
      },
    }),
    p.matchParticipant.count({
      where: {
        match: { queueId: 420, platformRoute: 'na1' },
        rankResolutionStatus: 'PENDING',
      },
    }),
    p.championAggregate.groupBy({
      by: ['rankTier'],
      _count: true,
      _sum: { sampleSize: true },
      where: { queueId: 420, platformRoute: 'na1' },
    }),
  ]);

  const byTier = Object.fromEntries(
    agg.map((row) => [
      row.rankTier,
      { rows: row._count, sampleSizeSum: row._sum.sampleSize ?? 0 },
    ]),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: 'league_helper_m12v2',
        source: {
          eligibleParticipantsWithPosition: eligibleAll,
          resolvedRanked,
          resolvedUnranked,
          pending,
        },
        aggregatesByRankTier: byTier,
        notes: {
          ALL: 'track ALL rows/sampleSizeSum directionally; do not decrease',
          exact: 'RESOLVED_RANKED only should feed exact tiers',
          UNKNOWN: 'RESOLVED_UNRANKED only; do not dump PENDING into UNKNOWN',
        },
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
