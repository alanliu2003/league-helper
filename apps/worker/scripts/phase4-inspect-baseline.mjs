/**
 * M12-v2 Phase 4 read-only baseline inspection (league_helper_m12v2 only).
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../.env') });

function dbNameFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return null;
  }
}

async function main() {
  const db = dbNameFromUrl(process.env.DATABASE_URL ?? '');
  if (db !== 'league_helper_m12v2') {
    console.error(JSON.stringify({ ok: false, reason: 'WRONG_DB', db }));
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const matches = await prisma.match.groupBy({
      by: ['normalizedPatch', 'platformRoute', 'queueId', 'ingestionStatus'],
      where: { remake: false },
      _count: { _all: true },
    });

    const allStatuses = await prisma.matchParticipant.groupBy({
      by: ['rankResolutionStatus'],
      _count: { _all: true },
    });

    const ranked = await prisma.$queryRaw`
      SELECT m."normalizedPatch", m."platformRoute", m."queueId",
             p."rankResolutionStatus", COUNT(*)::int AS c
      FROM "MatchParticipant" p
      JOIN "Match" m ON m.id = p."matchId"
      WHERE m."ingestionStatus" = 'COMPLETED'
        AND m.remake = false
        AND m."queueId" IN (420, 440)
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3, 4`;

    const unresolved = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS participants,
             COUNT(DISTINCT p."externalAccountId")::int AS unique_puuids
      FROM "MatchParticipant" p
      JOIN "Match" m ON m.id = p."matchId"
      WHERE m."ingestionStatus" = 'COMPLETED'
        AND m.remake = false
        AND m."queueId" IN (420, 440)
        AND p."rankResolutionStatus" IN ('PENDING', 'FAILED_RETRYABLE')`;

    const [trackedPlayers, playerAccounts, observations, matchCount, participantCount] =
      await Promise.all([
        prisma.trackedPlayer.count(),
        prisma.playerAccount.count(),
        prisma.participantRankObservation.count(),
        prisma.match.count(),
        prisma.matchParticipant.count(),
      ]);

    console.log(
      JSON.stringify(
        {
          database: db,
          matches,
          allParticipantStatuses: allStatuses,
          rankedBreakdown: ranked,
          unresolvedRanked: unresolved[0],
          trackedPlayers,
          playerAccounts,
          observations,
          matchCount,
          participantCount,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
