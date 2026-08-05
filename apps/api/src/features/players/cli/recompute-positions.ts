import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { PlayerCacheService } from '../player-cache.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { analyzePositionRecompute, type RecomputePositionRow } from '../recompute-positions';

const BATCH_SIZE = 200;

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readIntFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  const raw = process.argv[index + 1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const dryRun = !hasFlag('--apply');
  const limit = readIntFlag('--limit', Number.MAX_SAFE_INTEGER);

  if (!dryRun && process.env.RECOMPUTE_POSITIONS_CONFIRM !== 'YES') {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'Refusing apply mode without RECOMPUTE_POSITIONS_CONFIRM=YES (development guard).',
      }),
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const cache = app.get(PlayerCacheService);

    let cursor: string | undefined;
    let examinedTotal = 0;
    const allAffected = new Set<string>();
    const totals = {
      examined: 0,
      displayWouldChange: 0,
      unchanged: 0,
      convertedToUnknown: 0,
      failed: 0,
      cachesInvalidated: 0,
    };

    while (examinedTotal < limit) {
      const take = Math.min(BATCH_SIZE, limit - examinedTotal);
      const batch = await prisma.matchParticipant.findMany({
        take,
        ...(cursor
          ? {
              skip: 1,
              cursor: { id: cursor },
            }
          : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          teamPosition: true,
          individualPosition: true,
          lane: true,
          role: true,
          playerAccount: {
            select: { playerId: true },
          },
          match: {
            select: {
              queueId: true,
              mapId: true,
              gameMode: true,
              remake: true,
            },
          },
        },
      });

      if (batch.length === 0) {
        break;
      }

      const rows: RecomputePositionRow[] = batch.map((row) => ({
        participantId: row.id,
        playerId: row.playerAccount?.playerId ?? null,
        queueId: row.match.queueId,
        mapId: row.match.mapId,
        gameMode: row.match.gameMode,
        remake: row.match.remake,
        teamPosition: row.teamPosition,
        individualPosition: row.individualPosition,
        lane: row.lane,
        role: row.role,
      }));

      const analyzed = analyzePositionRecompute(rows);
      totals.examined += analyzed.counts.examined;
      totals.displayWouldChange += analyzed.counts.displayWouldChange;
      totals.unchanged += analyzed.counts.unchanged;
      totals.convertedToUnknown += analyzed.counts.convertedToUnknown;
      totals.failed += analyzed.counts.failed;
      for (const playerId of analyzed.affectedPlayerIds) {
        allAffected.add(playerId);
      }

      examinedTotal += batch.length;
      cursor = batch.at(-1)?.id;
      if (batch.length < take) {
        break;
      }
    }

    if (!dryRun) {
      for (const playerId of allAffected) {
        await cache.invalidate(playerId);
        totals.cachesInvalidated += 1;
      }
    }

    console.log(
      JSON.stringify({
        ok: true,
        mode: dryRun ? 'dry-run' : 'apply',
        note: 'Raw MatchParticipant fields are unchanged; public role is normalized at the API boundary.',
        counts: totals,
        affectedPlayerCount: allAffected.size,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'unknown',
    }),
  );
  process.exitCode = 1;
});
