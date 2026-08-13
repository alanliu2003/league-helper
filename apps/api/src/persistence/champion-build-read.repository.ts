import { Inject, Injectable } from '@nestjs/common';
import type { ChampionBuildAggregate } from '@prisma/client';
import type { ChampionBuildCategory } from '@league-helper/match-analytics';
import type { ChampionRankingPosition, PlatformRoute } from '@league-helper/shared';
import { PrismaService } from '../prisma/prisma.service';

export type ChampionBuildReadScope = {
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
export class ChampionBuildReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByCategories(input: ChampionBuildReadScope): Promise<ChampionBuildAggregate[]> {
    return this.prisma.championBuildAggregate.findMany({
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

export function mergeBuildRowsBySignature(
  rows: ChampionBuildAggregate[],
  category: ChampionBuildCategory,
): ChampionBuildAggregate[] {
  const grouped = new Map<string, ChampionBuildAggregate>();
  const eligibleByTier = new Map<string, number>();
  for (const row of rows) {
    if (row.category !== category) {
      continue;
    }
    eligibleByTier.set(
      row.rankTier,
      Math.max(eligibleByTier.get(row.rankTier) ?? 0, row.eligibleGames),
    );
    const existing = grouped.get(row.signature);
    if (!existing) {
      grouped.set(row.signature, { ...row });
      continue;
    }
    existing.sampleSize += row.sampleSize;
    existing.wins += row.wins;
    if (
      row.latestEligibleMatchAt &&
      (!existing.latestEligibleMatchAt ||
        row.latestEligibleMatchAt > existing.latestEligibleMatchAt)
    ) {
      existing.latestEligibleMatchAt = row.latestEligibleMatchAt;
    }
  }
  let eligibleGames = 0;
  for (const count of eligibleByTier.values()) {
    eligibleGames += count;
  }
  const merged = [...grouped.values()];
  for (const row of merged) {
    row.eligibleGames = eligibleGames;
  }
  return merged.sort((left, right) => right.sampleSize - left.sampleSize);
}
