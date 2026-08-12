/**
 * Phase 6A read-only DB audit. Refuses anything except league_helper_m12v2.
 */
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

const p = new PrismaClient();
try {
  const [snapshots, participants, aggregates, tracked] = await Promise.all([
    p.rankSnapshot.groupBy({ by: ['tier'], _count: true }),
    p.matchParticipant.groupBy({
      by: ['rankTierAtIngestion', 'rankResolutionStatus'],
      _count: true,
      where: { match: { queueId: 420, platformRoute: 'na1' } },
    }),
    p.championAggregate.groupBy({
      by: ['rankTier'],
      _count: true,
      where: { queueId: 420, platformRoute: 'na1' },
    }),
    p.trackedPlayer.groupBy({ by: ['enrollmentSource'], _count: true }),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        db: 'league_helper_m12v2',
        snapshotsByTier: Object.fromEntries(snapshots.map((r) => [r.tier, r._count])),
        participants: participants.map((r) => ({
          tier: r.rankTierAtIngestion,
          status: r.rankResolutionStatus,
          count: r._count,
        })),
        aggregatesByRankTier: Object.fromEntries(aggregates.map((r) => [r.rankTier, r._count])),
        trackedBySource: Object.fromEntries(tracked.map((r) => [r.enrollmentSource, r._count])),
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
