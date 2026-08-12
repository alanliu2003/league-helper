/**
 * Stage A new-match stats for league_helper_m12v2 only.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('league_helper_m12v2') || url.includes('/league_helper?')) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB' }));
  process.exit(2);
}

const sinceRaw = process.argv[process.argv.indexOf('--since') + 1];
const since = new Date(sinceRaw);
const p = new PrismaClient();
try {
  const newMatches = await p.match.count({
    where: {
      queueId: 420,
      platformRoute: 'na1',
      createdAt: { gte: since },
      ingestionStatus: 'COMPLETED',
    },
  });
  const pendingNew = await p.matchParticipant.count({
    where: {
      rankResolutionStatus: 'PENDING',
      match: { queueId: 420, platformRoute: 'na1', createdAt: { gte: since } },
    },
  });
  const resolvedNew = await p.matchParticipant.count({
    where: {
      rankResolutionStatus: 'RESOLVED_RANKED',
      match: { queueId: 420, platformRoute: 'na1', createdAt: { gte: since } },
    },
  });
  const withStyles = await p.matchParticipant.count({
    where: {
      primaryPerkStyleId: { not: null },
      secondaryPerkStyleId: { not: null },
      match: { queueId: 420, platformRoute: 'na1', createdAt: { gte: since } },
    },
  });
  const participantsNew = await p.matchParticipant.count({
    where: { match: { queueId: 420, platformRoute: 'na1', createdAt: { gte: since } } },
  });
  const itemLen7 = await p.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM "MatchParticipant" mp
    JOIN "Match" m ON m.id = mp."matchId"
    WHERE m."queueId" = 420
      AND m."platformRoute" = 'na1'
      AND m."createdAt" >= ${since}
      AND cardinality(mp."itemIds") = 7
  `;
  const matchesWithEvents = await p.$queryRaw`
    SELECT COUNT(DISTINCT m.id)::int AS c
    FROM "Match" m
    INNER JOIN "MatchTimelineEvent" e ON e."matchId" = m.id
    WHERE m."queueId" = 420
      AND m."platformRoute" = 'na1'
      AND m."createdAt" >= ${since}
  `;
  console.log(
    JSON.stringify(
      {
        ok: true,
        since: since.toISOString(),
        newMatches,
        participantsNew,
        pendingNew,
        resolvedNew,
        withStyles,
        itemLen7: itemLen7[0].c,
        matchesWithEvents: matchesWithEvents[0].c,
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
