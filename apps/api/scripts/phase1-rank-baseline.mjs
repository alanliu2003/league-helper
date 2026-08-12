/**
 * Read-only M12-v2 Phase 1 rankTierAtIngestion baseline for clean M11 DB.
 * Null is reported as unresolved ambiguity — NOT finalized UNKNOWN.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PLATFORM = 'na1';
const QUEUE = 420;

try {
  const eligible = await prisma.matchParticipant.count({
    where: {
      match: {
        platformRoute: PLATFORM,
        queueId: QUEUE,
      },
    },
  });

  const known = await prisma.matchParticipant.count({
    where: {
      match: {
        platformRoute: PLATFORM,
        queueId: QUEUE,
      },
      rankTierAtIngestion: { not: null },
    },
  });

  const nullCount = await prisma.matchParticipant.count({
    where: {
      match: {
        platformRoute: PLATFORM,
        queueId: QUEUE,
      },
      rankTierAtIngestion: null,
    },
  });

  const knownPct = eligible === 0 ? null : Number(((known / eligible) * 100).toFixed(2));
  const nullPct = eligible === 0 ? null : Number(((nullCount / eligible) * 100).toFixed(2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        platform: PLATFORM,
        queueId: QUEUE,
        eligibleParticipantCount: eligible,
        rankTierAtIngestionKnown: known,
        rankTierAtIngestionNull: nullCount,
        knownPercent: knownPct,
        nullPercent: nullPct,
        note: 'null_means_unresolved_m11_ambiguity_not_finalized_UNKNOWN',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify({ ok: false, error: error?.message ?? String(error) }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
