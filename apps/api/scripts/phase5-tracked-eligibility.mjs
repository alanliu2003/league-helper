/** Read-only TrackedPlayer eligibility (no PUUID). */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const now = new Date();
  const rows = await prisma.trackedPlayer.findMany({
    select: {
      status: true,
      priority: true,
      consecutiveZeroNewMatchRuns: true,
      nextEligibleAt: true,
      lastSuccessfulRefreshAt: true,
      enrollmentSource: true,
    },
  });
  console.log(
    JSON.stringify(
      {
        now: now.toISOString(),
        players: rows.map((r) => ({
          ...r,
          nextEligibleAt: r.nextEligibleAt.toISOString(),
          lastSuccessfulRefreshAt: r.lastSuccessfulRefreshAt?.toISOString() ?? null,
          eligibleNow: r.status === 'ACTIVE' && r.nextEligibleAt.getTime() <= now.getTime(),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
