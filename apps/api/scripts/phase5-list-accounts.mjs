/** Read-only: list a few PlayerAccount Riot IDs (no PUUID). */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const rows = await prisma.playerAccount.findMany({
    select: {
      id: true,
      currentGameName: true,
      currentTagLine: true,
      platformRoute: true,
    },
    take: 5,
    orderBy: { updatedAt: 'desc' },
  });
  const trackedPlayerCount = await prisma.trackedPlayer.count();
  console.log(
    JSON.stringify(
      {
        trackedPlayerCount,
        accounts: rows.map((r) => ({
          id: r.id,
          riotId: `${r.currentGameName}#${r.currentTagLine}`,
          platform: r.platformRoute,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
