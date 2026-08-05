import { Inject, Injectable } from '@nestjs/common';
import type { ChampionMasterySnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type InsertMasterySnapshotInput = {
  playerAccountId: string;
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime?: Date | null;
  championPointsSinceLastLevel?: number | null;
  championPointsUntilNextLevel?: number | null;
  chestGranted?: boolean | null;
  tokensEarned?: number | null;
  capturedAt?: Date;
};

function hasMasteryChanged(
  previous: ChampionMasterySnapshot | null,
  next: InsertMasterySnapshotInput,
): boolean {
  if (!previous) {
    return true;
  }

  return (
    previous.championLevel !== next.championLevel ||
    previous.championPoints !== next.championPoints ||
    (previous.chestGranted ?? null) !== (next.chestGranted ?? null) ||
    (previous.tokensEarned ?? null) !== (next.tokensEarned ?? null) ||
    (previous.lastPlayTime?.getTime() ?? null) !== (next.lastPlayTime?.getTime() ?? null)
  );
}

@Injectable()
export class MasterySnapshotRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  insert(input: InsertMasterySnapshotInput): Promise<ChampionMasterySnapshot> {
    return this.prisma.championMasterySnapshot.create({
      data: {
        playerAccountId: input.playerAccountId,
        championId: input.championId,
        championLevel: input.championLevel,
        championPoints: input.championPoints,
        lastPlayTime: input.lastPlayTime ?? null,
        championPointsSinceLastLevel: input.championPointsSinceLastLevel ?? null,
        championPointsUntilNextLevel: input.championPointsUntilNextLevel ?? null,
        chestGranted: input.chestGranted ?? null,
        tokensEarned: input.tokensEarned ?? null,
        capturedAt: input.capturedAt ?? new Date(),
      },
    });
  }

  getLatestForChampion(
    playerAccountId: string,
    championId: number,
  ): Promise<ChampionMasterySnapshot | null> {
    return this.prisma.championMasterySnapshot.findFirst({
      where: { playerAccountId, championId },
      orderBy: { capturedAt: 'desc' },
    });
  }

  /**
   * Inserts when mastery values changed.
   * Skips identical snapshots while still inside the freshness window.
   * Returns null when skipped.
   */
  async insertIfChanged(
    input: InsertMasterySnapshotInput,
    minAgeSeconds: number,
  ): Promise<ChampionMasterySnapshot | null> {
    const latest = await this.getLatestForChampion(input.playerAccountId, input.championId);
    const now = input.capturedAt ?? new Date();

    if (latest) {
      const ageMs = now.getTime() - latest.capturedAt.getTime();
      const withinFreshnessWindow = ageMs < minAgeSeconds * 1000;
      if (!hasMasteryChanged(latest, input) && withinFreshnessWindow) {
        return null;
      }
      if (!hasMasteryChanged(latest, input)) {
        // Identical outside the window — still avoid writing a duplicate identical row.
        return null;
      }
    }

    return this.insert({ ...input, capturedAt: now });
  }

  getLatestMasteryForPlayer(playerAccountId: string): Promise<ChampionMasterySnapshot[]> {
    return this.prisma.$queryRaw<ChampionMasterySnapshot[]>`
      SELECT DISTINCT ON ("championId") *
      FROM "ChampionMasterySnapshot"
      WHERE "playerAccountId" = ${playerAccountId}
      ORDER BY "championId", "capturedAt" DESC
    `;
  }

  async getTopCurrentMasteryForPlayer(
    playerAccountId: string,
    limit: number,
  ): Promise<ChampionMasterySnapshot[]> {
    const latest = await this.getLatestMasteryForPlayer(playerAccountId);
    return latest
      .slice()
      .sort((a, b) => b.championPoints - a.championPoints || b.championLevel - a.championLevel)
      .slice(0, limit);
  }

  async listHistory(input: {
    playerAccountId: string;
    championId?: number;
    limit: number;
    cursorCapturedAt?: Date;
    cursorId?: string;
  }): Promise<ChampionMasterySnapshot[]> {
    return this.prisma.championMasterySnapshot.findMany({
      where: {
        playerAccountId: input.playerAccountId,
        ...(input.championId !== undefined ? { championId: input.championId } : {}),
        ...(input.cursorCapturedAt && input.cursorId
          ? {
              OR: [
                { capturedAt: { lt: input.cursorCapturedAt } },
                { capturedAt: input.cursorCapturedAt, id: { lt: input.cursorId } },
              ],
            }
          : {}),
      },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    });
  }
}
