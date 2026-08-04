import { Injectable } from '@nestjs/common';
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

@Injectable()
export class MasterySnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

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
}
