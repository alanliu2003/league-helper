import { Inject, Injectable } from '@nestjs/common';
import {
  PLATFORM_ROUTES,
  getRegionalRouteForPlatform,
  type ChampionRankingPosition,
  type PlatformRoute,
} from '@league-helper/shared';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { FIVE_RANKING_POSITIONS } from '../champions/champion-stats.mapper';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CollectorCoveragePlatformSummary,
  CollectorCoveragePositionSummary,
  CollectorCoverageSnapshot,
  CollectorCoverageSnapshotInput,
  CoverageSnapshotStatus,
} from './collector.types';

/** Design default near-floor diagnostic band lower bound (reporting only). */
export const COLLECTOR_COVERAGE_NEAR_FLOOR_MIN = 20;

export const COLLECTOR_EXACT_POSITIONS: ChampionRankingPosition[] = FIVE_RANKING_POSITIONS;

export function buildNearFloorBand(minimumSample: number): { min: number; max: number } {
  return {
    min: COLLECTOR_COVERAGE_NEAR_FLOOR_MIN,
    max: minimumSample - 1,
  };
}

@Injectable()
export class CollectorCoverageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChampionAggregateReadRepository)
    private readonly aggregates: ChampionAggregateReadRepository,
    @Inject(CHAMPION_STATS_CONFIG) private readonly statsConfig: ChampionStatsConfig,
  ) {}

  async snapshotSafe(input: CollectorCoverageSnapshotInput): Promise<CollectorCoverageSnapshot> {
    try {
      return await this.snapshot(input);
    } catch (error: unknown) {
      return this.unavailableSnapshot(input, error);
    }
  }

  async snapshot(input: CollectorCoverageSnapshotInput): Promise<CollectorCoverageSnapshot> {
    const versions = {
      sourceNormalizationVersion: this.statsConfig.sourceNormalizationVersion,
      aggregationVersion: this.statsConfig.aggregationVersion,
    };
    const minimumSample = this.statsConfig.minimumSample;
    const nearFloorBand = buildNearFloorBand(minimumSample);

    const platforms: CollectorCoveragePlatformSummary[] = [];
    const warnings: string[] = [];

    for (const platform of input.effectivePlatforms) {
      const platformSummary = await this.snapshotPlatform({
        platform,
        queueId: input.queueId,
        versions,
        minimumSample,
        nearFloorBand,
      });
      platforms.push(platformSummary);
      if (platformSummary.patch === null) {
        warnings.push(`No aggregate patch resolved for platform ${platform} queue ${input.queueId}.`);
      }
    }

    const status = this.resolveStatus(platforms, warnings);

    return {
      status,
      label: 'db_snapshot',
      queueId: input.queueId,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      minimumSample,
      nearFloorBand,
      platforms,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    };
  }

  private async snapshotPlatform(input: {
    platform: string;
    queueId: number;
    versions: { sourceNormalizationVersion: string; aggregationVersion: string };
    minimumSample: number;
    nearFloorBand: { min: number; max: number };
  }): Promise<CollectorCoveragePlatformSummary> {
    const platformRoute = this.parsePlatformRoute(input.platform);
    const patch =
      platformRoute === null
        ? null
        : await this.aggregates.resolveLatestSemanticPatch({
            platform: platformRoute,
            queueId: input.queueId,
            versions: input.versions,
          });

    const positions: CollectorCoveragePositionSummary[] =
      patch === null || platformRoute === null
        ? COLLECTOR_EXACT_POSITIONS.map((position) => this.emptyPositionSummary(position))
        : await Promise.all(
            COLLECTOR_EXACT_POSITIONS.map((position) =>
              this.summarizePosition({
                platform: platformRoute,
                queueId: input.queueId,
                patch,
                position,
                versions: input.versions,
                minimumSample: input.minimumSample,
                nearFloorBand: input.nearFloorBand,
              }),
            ),
          );

    const matchCountsByNormalizedPatch = await this.loadMatchCountsByPatch(
      input.platform,
      input.queueId,
    );

    return {
      platform: input.platform,
      patch,
      positions,
      matchCountsByNormalizedPatch,
    };
  }

  private async summarizePosition(input: {
    platform: PlatformRoute;
    queueId: number;
    patch: string;
    position: ChampionRankingPosition;
    versions: { sourceNormalizationVersion: string; aggregationVersion: string };
    minimumSample: number;
    nearFloorBand: { min: number; max: number };
  }): Promise<CollectorCoveragePositionSummary> {
    const regionalRoute = getRegionalRouteForPlatform(input.platform);
    const baseWhere = {
      platformRoute: input.platform,
      regionalRoute,
      queueId: input.queueId,
      patch: input.patch,
      rankTier: 'ALL',
      teamPosition: input.position,
      sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
      aggregationVersion: input.versions.aggregationVersion,
    };

    const [maxAgg, keysWithSampleGtZero, keysAtOrAboveFloor, keysInNearFloorBand] =
      await Promise.all([
        this.prisma.championAggregate.aggregate({
          where: baseWhere,
          _max: { sampleSize: true },
        }),
        this.prisma.championAggregate.count({
          where: { ...baseWhere, sampleSize: { gt: 0 } },
        }),
        this.prisma.championAggregate.count({
          where: { ...baseWhere, sampleSize: { gte: input.minimumSample } },
        }),
        this.nearFloorCount(baseWhere, input.nearFloorBand),
      ]);

    return {
      position: input.position,
      maxSampleSize: maxAgg._max.sampleSize ?? 0,
      keysWithSampleGtZero,
      keysAtOrAboveFloor,
      keysInNearFloorBand,
    };
  }

  private async nearFloorCount(
    baseWhere: Record<string, unknown>,
    nearFloorBand: { min: number; max: number },
  ): Promise<number> {
    if (nearFloorBand.max < nearFloorBand.min) {
      return 0;
    }
    return this.prisma.championAggregate.count({
      where: {
        ...baseWhere,
        sampleSize: { gte: nearFloorBand.min, lte: nearFloorBand.max },
      },
    });
  }

  private async loadMatchCountsByPatch(
    platform: string,
    queueId: number,
  ): Promise<Array<{ patch: string | null; count: number }>> {
    const rows = await this.prisma.match.groupBy({
      by: ['normalizedPatch'],
      where: { queueId, platformRoute: platform },
      _count: { _all: true },
    });

    return rows.map((row) => ({
      patch: row.normalizedPatch,
      count: row._count._all,
    }));
  }

  private emptyPositionSummary(position: ChampionRankingPosition): CollectorCoveragePositionSummary {
    return {
      position,
      maxSampleSize: 0,
      keysWithSampleGtZero: 0,
      keysAtOrAboveFloor: 0,
      keysInNearFloorBand: 0,
    };
  }

  private parsePlatformRoute(platform: string): PlatformRoute | null {
    if (!(PLATFORM_ROUTES as readonly string[]).includes(platform)) {
      return null;
    }
    return platform as PlatformRoute;
  }

  private resolveStatus(
    platforms: CollectorCoveragePlatformSummary[],
    warnings: string[],
  ): CoverageSnapshotStatus {
    if (platforms.some((platform) => platform.patch === null)) {
      return 'partial';
    }
    if (warnings.length > 0) {
      return 'partial';
    }
    return 'available';
  }

  private unavailableSnapshot(
    input: CollectorCoverageSnapshotInput,
    error: unknown,
  ): CollectorCoverageSnapshot {
    const minimumSample = this.statsConfig.minimumSample;
    return {
      status: 'unavailable',
      label: 'db_snapshot',
      queueId: input.queueId,
      sourceNormalizationVersion: this.statsConfig.sourceNormalizationVersion,
      aggregationVersion: this.statsConfig.aggregationVersion,
      minimumSample,
      nearFloorBand: buildNearFloorBand(minimumSample),
      platforms: [],
      warning: error instanceof Error ? error.message : 'Coverage snapshot failed',
    };
  }
}
