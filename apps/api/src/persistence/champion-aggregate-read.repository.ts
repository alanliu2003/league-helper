import { Inject, Injectable } from '@nestjs/common';
import type { ChampionAggregate, Prisma } from '@prisma/client';
import { ChampionAggregationProcessingStatus, Prisma as PrismaNamespace } from '@prisma/client';
import type {
  ChampionRankingPosition,
  ChampionStatsSortBy,
  ChampionStatsSortDirection,
  ChampionStatsTierFilter,
  PlatformRoute,
  RegionalRoute,
} from '@league-helper/shared';
import { parsePatchVersion } from '@league-helper/shared';
import { PrismaService } from '../prisma/prisma.service';

export type AggregateVersionFilter = {
  sourceNormalizationVersion: string;
  aggregationVersion: string;
};

export type AggregateScopeFilter = AggregateVersionFilter & {
  platform: PlatformRoute;
  regionalRoute: RegionalRoute;
  queueId: number;
  patch: string;
  tier: ChampionStatsTierFilter;
  position: ChampionRankingPosition;
  minimumSample: number;
};

export type TableSort = {
  sortBy: ChampionStatsSortBy;
  sortDirection: ChampionStatsSortDirection;
};

export type ChampionAggregateReadRow = ChampionAggregate;

@Injectable()
export class ChampionAggregateReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Distinct patches with aggregates for platform+queue+versions.
   * Caller sorts semantically via parsePatchVersion.
   */
  async listDistinctPatches(input: {
    platform: PlatformRoute;
    queueId: number;
    versions: AggregateVersionFilter;
  }): Promise<string[]> {
    const rows = await this.prisma.championAggregate.findMany({
      where: {
        platformRoute: input.platform,
        queueId: input.queueId,
        sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
        aggregationVersion: input.versions.aggregationVersion,
      },
      distinct: ['patch'],
      select: { patch: true },
    });
    return rows.map((row) => row.patch);
  }

  async resolveLatestSemanticPatch(input: {
    platform: PlatformRoute;
    queueId: number;
    versions: AggregateVersionFilter;
  }): Promise<string | null> {
    const patches = await this.listDistinctPatches(input);
    return pickLatestSemanticPatch(patches);
  }

  async listAvailablePlatforms(versions: AggregateVersionFilter): Promise<string[]> {
    const rows = await this.prisma.championAggregate.findMany({
      where: {
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
        NOT: { platformRoute: '' },
      },
      distinct: ['platformRoute'],
      select: { platformRoute: true },
    });
    return rows.map((row) => row.platformRoute);
  }

  async listAvailableQueueIds(input: {
    platform: PlatformRoute;
    versions: AggregateVersionFilter;
  }): Promise<number[]> {
    const rows = await this.prisma.championAggregate.findMany({
      where: {
        platformRoute: input.platform,
        sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
        aggregationVersion: input.versions.aggregationVersion,
        queueId: { gte: 0 },
      },
      distinct: ['queueId'],
      select: { queueId: true },
    });
    return rows.map((row) => row.queueId);
  }

  async findExactAggregate(input: {
    championId: number;
    scope: AggregateScopeFilter;
  }): Promise<ChampionAggregateReadRow | null> {
    return this.prisma.championAggregate.findFirst({
      where: baseWhere(input.scope, input.championId),
    });
  }

  async findPositionBreakdown(input: {
    championId: number;
    scope: Omit<AggregateScopeFilter, 'position'>;
    positions: ChampionRankingPosition[];
  }): Promise<ChampionAggregateReadRow[]> {
    return this.prisma.championAggregate.findMany({
      where: {
        ...baseWhereWithoutPosition(input.scope, input.championId),
        teamPosition: { in: input.positions },
      },
    });
  }

  /**
   * Ranking table rows. Sample filter applied in SQL before sort/pagination.
   */
  async findTableRows(input: {
    scope: AggregateScopeFilter;
    sort: TableSort;
    limit: number;
    offset: number;
  }): Promise<{ rows: ChampionAggregateReadRow[]; totalCount: number }> {
    const where = baseWhere(input.scope);
    const totalCount = await this.prisma.championAggregate.count({ where });
    if (totalCount === 0) {
      return { rows: [], totalCount: 0 };
    }

    const orderSql = buildOrderSql(input.sort);
    const rows = await this.prisma.$queryRaw<ChampionAggregateReadRow[]>`
      SELECT *
      FROM "ChampionAggregate"
      WHERE
        "patch" = ${input.scope.patch}
        AND "platformRoute" = ${input.scope.platform}
        AND "regionalRoute" = ${input.scope.regionalRoute}
        AND "queueId" = ${input.scope.queueId}
        AND "rankTier" = ${input.scope.tier}
        AND "teamPosition" = ${input.scope.position}
        AND "sourceNormalizationVersion" = ${input.scope.sourceNormalizationVersion}
        AND "aggregationVersion" = ${input.scope.aggregationVersion}
        AND "sampleSize" >= ${input.scope.minimumSample}
      ORDER BY ${PrismaNamespace.raw(orderSql)}
      LIMIT ${input.limit}
      OFFSET ${input.offset}
    `;

    return { rows, totalCount };
  }

  /**
   * Freshness from processing + recalc-scope markers (not timestamp comparisons).
   */
  async resolveFreshness(input: {
    versions: AggregateVersionFilter;
    platform: PlatformRoute;
    queueId: number;
    patch: string;
  }): Promise<'CURRENT' | 'RECALCULATION_PENDING' | 'UNKNOWN'> {
    const { sourceNormalizationVersion, aggregationVersion } = input.versions;

    const pendingScope = await this.prisma.championAggregationRecalcScope.findFirst({
      where: { sourceNormalizationVersion, aggregationVersion },
      select: { id: true },
    });
    if (pendingScope) {
      return 'RECALCULATION_PENDING';
    }

    const failed = await this.prisma.championAggregationProcessing.findFirst({
      where: {
        sourceNormalizationVersion,
        aggregationVersion,
        status: ChampionAggregationProcessingStatus.FAILED,
      },
      select: { id: true },
    });
    if (failed) {
      return 'RECALCULATION_PENDING';
    }

    const completed = await this.prisma.championAggregationProcessing.findFirst({
      where: {
        sourceNormalizationVersion,
        aggregationVersion,
        status: ChampionAggregationProcessingStatus.COMPLETED,
      },
      select: { id: true },
    });

    const hasAggregates = await this.prisma.championAggregate.findFirst({
      where: {
        platformRoute: input.platform,
        queueId: input.queueId,
        patch: input.patch,
        sourceNormalizationVersion,
        aggregationVersion,
      },
      select: { id: true },
    });

    if (completed && hasAggregates) {
      return 'CURRENT';
    }

    return 'UNKNOWN';
  }
}

function baseWhereWithoutPosition(
  scope: Omit<AggregateScopeFilter, 'position'>,
  championId?: number,
): Prisma.ChampionAggregateWhereInput {
  return {
    patch: scope.patch,
    platformRoute: scope.platform,
    regionalRoute: scope.regionalRoute,
    queueId: scope.queueId,
    rankTier: scope.tier,
    sourceNormalizationVersion: scope.sourceNormalizationVersion,
    aggregationVersion: scope.aggregationVersion,
    sampleSize: { gte: scope.minimumSample },
    ...(championId !== undefined ? { championId } : {}),
  };
}

function baseWhere(
  scope: AggregateScopeFilter,
  championId?: number,
): Prisma.ChampionAggregateWhereInput {
  return {
    ...baseWhereWithoutPosition(scope, championId),
    teamPosition: scope.position,
  };
}

/** Whitelisted ORDER BY fragments only — never interpolate user input. */
function buildOrderSql(sort: TableSort): string {
  const dir = sort.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const nulls = sort.sortDirection === 'asc' ? 'NULLS FIRST' : 'NULLS LAST';

  switch (sort.sortBy) {
    case 'sampleSize':
      return `"sampleSize" ${dir}, "championId" ASC`;
    case 'championName':
      return `"championId" ${dir}`;
    case 'winRate':
      return `(CASE WHEN "sampleSize" = 0 THEN NULL ELSE "wins"::float8 / "sampleSize" END) ${dir} ${nulls}, "championId" ASC`;
    case 'aggregateKdaRatio':
      return `(CASE
        WHEN "sampleSize" = 0 THEN NULL
        WHEN "totalDeaths" > 0 THEN ("totalKills" + "totalAssists")::float8 / "totalDeaths"
        WHEN ("totalKills" + "totalAssists") = 0 THEN 0
        ELSE ("totalKills" + "totalAssists")::float8
      END) ${dir} ${nulls}, "championId" ASC`;
    case 'averageCsPerMinute':
      return `(CASE WHEN "totalGameSeconds" = 0 THEN NULL ELSE "totalCs"::float8 / ("totalGameSeconds"::float8 / 60.0) END) ${dir} ${nulls}, "championId" ASC`;
    case 'averageDamagePerMinute':
      return `(CASE WHEN "totalGameSeconds" = 0 THEN NULL ELSE "totalDamageToChampions"::float8 / ("totalGameSeconds"::float8 / 60.0) END) ${dir} ${nulls}, "championId" ASC`;
    case 'averageGoldDifferenceAt10':
      return `(CASE WHEN "goldDifferenceAt10Samples" = 0 OR "totalGoldDifferenceAt10" IS NULL THEN NULL ELSE "totalGoldDifferenceAt10"::float8 / "goldDifferenceAt10Samples" END) ${dir} ${nulls}, "championId" ASC`;
    case 'averageCsDifferenceAt10':
      return `(CASE WHEN "csDifferenceAt10Samples" = 0 OR "totalCsDifferenceAt10" IS NULL THEN NULL ELSE "totalCsDifferenceAt10"::float8 / "csDifferenceAt10Samples" END) ${dir} ${nulls}, "championId" ASC`;
    default:
      return `"wins" ${dir}, "championId" ASC`;
  }
}

export function pickLatestSemanticPatch(patches: string[]): string | null {
  if (patches.length === 0) {
    return null;
  }

  const scored = patches
    .map((patch) => {
      const parsed = parsePatchVersion(patch);
      return parsed
        ? { patch, major: parsed.major, minor: parsed.minor }
        : { patch, major: -1, minor: -1 };
    })
    .sort((a, b) => {
      if (a.major !== b.major) {
        return b.major - a.major;
      }
      if (a.minor !== b.minor) {
        return b.minor - a.minor;
      }
      return a.patch.localeCompare(b.patch);
    });

  return scored[0]?.patch ?? null;
}
