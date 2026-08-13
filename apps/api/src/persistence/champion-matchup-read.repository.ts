import { Inject, Injectable } from '@nestjs/common';
import type { MatchupAggregate } from '@prisma/client';
import type { ChampionRankingPosition, PlatformRoute } from '@league-helper/shared';
import { PrismaService } from '../prisma/prisma.service';

export type ChampionMatchupReadScope = {
  championId: number;
  patch: string;
  platformRoute: PlatformRoute;
  queueId: number;
  position: ChampionRankingPosition;
  rankTiers: string[];
  sourceNormalizationVersion: string;
  aggregationVersion: string;
};

@Injectable()
export class ChampionMatchupReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByChampion(input: ChampionMatchupReadScope): Promise<MatchupAggregate[]> {
    return this.prisma.matchupAggregate.findMany({
      where: {
        championId: input.championId,
        patch: input.patch,
        platformRoute: input.platformRoute,
        queueId: input.queueId,
        teamPosition: input.position,
        rankTier: { in: input.rankTiers },
        sourceNormalizationVersion: input.sourceNormalizationVersion,
        aggregationVersion: input.aggregationVersion,
      },
    });
  }
}
