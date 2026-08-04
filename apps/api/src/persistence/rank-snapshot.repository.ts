import { Injectable } from '@nestjs/common';
import { QueueTypeSchema, RankDivisionSchema, RankTierSchema } from '@league-helper/shared';
import type { RankSnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasRankSnapshotChanged } from './rank-snapshot.utils';

export type InsertRankSnapshotInput = {
  playerAccountId: string;
  queueType: string;
  tier: string;
  division: string | null;
  leaguePoints: number;
  wins: number;
  losses: number;
  veteran?: boolean;
  inactive?: boolean;
  freshBlood?: boolean;
  hotStreak?: boolean;
  capturedAt?: Date;
};

@Injectable()
export class RankSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getLatest(playerAccountId: string, queueType: string): Promise<RankSnapshot | null> {
    return this.prisma.rankSnapshot.findFirst({
      where: { playerAccountId, queueType },
      orderBy: { capturedAt: 'desc' },
    });
  }

  /**
   * Inserts a snapshot only when values changed (or none exist yet).
   * Returns null when skipped as unchanged.
   */
  async insertIfChanged(input: InsertRankSnapshotInput): Promise<RankSnapshot | null> {
    const queueType = QueueTypeSchema.parse(input.queueType);
    const tier = RankTierSchema.parse(input.tier);
    const division =
      input.division === null || input.division === undefined
        ? null
        : RankDivisionSchema.parse(input.division);

    const next = {
      queueType,
      tier,
      division,
      leaguePoints: input.leaguePoints,
      wins: input.wins,
      losses: input.losses,
      veteran: input.veteran ?? false,
      inactive: input.inactive ?? false,
      freshBlood: input.freshBlood ?? false,
      hotStreak: input.hotStreak ?? false,
    };

    const latest = await this.getLatest(input.playerAccountId, queueType);
    if (!hasRankSnapshotChanged(latest, next)) {
      return null;
    }

    return this.prisma.rankSnapshot.create({
      data: {
        playerAccountId: input.playerAccountId,
        ...next,
        capturedAt: input.capturedAt ?? new Date(),
      },
    });
  }

  insert(input: InsertRankSnapshotInput): Promise<RankSnapshot> {
    const queueType = QueueTypeSchema.parse(input.queueType);
    const tier = RankTierSchema.parse(input.tier);
    const division =
      input.division === null || input.division === undefined
        ? null
        : RankDivisionSchema.parse(input.division);

    return this.prisma.rankSnapshot.create({
      data: {
        playerAccountId: input.playerAccountId,
        queueType,
        tier,
        division,
        leaguePoints: input.leaguePoints,
        wins: input.wins,
        losses: input.losses,
        veteran: input.veteran ?? false,
        inactive: input.inactive ?? false,
        freshBlood: input.freshBlood ?? false,
        hotStreak: input.hotStreak ?? false,
        capturedAt: input.capturedAt ?? new Date(),
      },
    });
  }
}
