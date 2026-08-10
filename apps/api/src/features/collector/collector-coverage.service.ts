import { Inject, Injectable, Optional } from '@nestjs/common';
import { StaticDataStatus, type TrackedPlayerEnrollmentSource } from '@prisma/client';
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
import {
  CLASSIC_CHAMPION_ID_MIN,
  isPublicChampionEntry,
  publicChampionStaticWhere,
} from '../../persistence/champion-public-visibility';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { FIVE_RANKING_POSITIONS } from '../champions/champion-stats.mapper';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { COLLECTOR_CONFIG } from './collector.tokens';
import type {
  CollectorCoverageActivitySignals,
  CollectorCoverageCapUsage,
  CollectorCoverageChampionSection,
  CollectorCoverageClassicZero,
  CollectorCoverageDensityBuckets,
  CollectorCoverageDensityThresholds,
  CollectorCoverageLadderRepresentation,
  CollectorCoveragePlatformDetail,
  CollectorCoveragePlatformSummary,
  CollectorCoveragePositionDensity,
  CollectorCoveragePositionSummary,
  CollectorCoverageReport,
  CollectorCoverageReportInput,
  CollectorCoverageSnapshot,
  CollectorCoverageSnapshotInput,
  CollectorCoverageTrackedPlayers,
  CoverageSnapshotStatus,
} from './collector.types';

/** Design default near-floor diagnostic band lower bound (reporting only). */
export const COLLECTOR_COVERAGE_NEAR_FLOOR_MIN = 20;

export const COLLECTOR_EXACT_POSITIONS: ChampionRankingPosition[] = FIVE_RANKING_POSITIONS;

/** Density observability thresholds (not a second ranking floor). */
export const COVERAGE_DENSITY_THRESHOLDS: CollectorCoverageDensityThresholds = {
  gte1: 1,
  gte30: 30,
  gte100: 100,
};

const ENROLLMENT_SOURCES: TrackedPlayerEnrollmentSource[] = [
  'ADMIN_SEED',
  'PRODUCT_SEARCH',
  'BOOTSTRAP',
  'LADDER',
  'MATCH_PARTICIPANT',
];

const APEX_TIERS = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
const REPRESENTATIVE_TIERS = new Set(['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD']);

const SAMPLE_HISTOGRAM_BUCKETS = [
  { key: '1-2', min: 1, max: 2 },
  { key: '3-9', min: 3, max: 9 },
  { key: '10-29', min: 10, max: 29 },
  { key: '30-99', min: 30, max: 99 },
  { key: '100+', min: 100, max: Number.POSITIVE_INFINITY },
] as const;

const CLASSIC_ZERO_ROSTER_NOTE =
  'Roster is public ChampionStaticData (Summoner\'s Rift). Jade Classic / non-public variants (championId >= 60000 or underscore keys) are excluded from the denominator.';

const MATCHES_BY_TIER_UNAVAILABLE_REASON =
  'Match-level tier counts are ambiguous because participants in one match may have different rankTierAtIngestion values. Use participant observations by tier instead.';

export function buildNearFloorBand(minimumSample: number): { min: number; max: number } {
  return {
    min: COLLECTOR_COVERAGE_NEAR_FLOOR_MIN,
    max: minimumSample - 1,
  };
}

function countsByKey(rows: Array<{ key: string | null; count: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.key == null) {
      continue;
    }
    out[row.key] = row.count;
  }
  return out;
}

function emptyEnrollmentSourceCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const source of ENROLLMENT_SOURCES) {
    out[source] = 0;
  }
  return out;
}

function emptyDensityBuckets(): CollectorCoverageDensityBuckets {
  return {
    championPositionKeysGte1: 0,
    championPositionKeysGte30: 0,
    championPositionKeysGte100: 0,
  };
}

function emptyPositionDensity(position: ChampionRankingPosition): CollectorCoveragePositionDensity {
  return {
    position,
    gte1: 0,
    gte30: 0,
    gte100: 0,
    maxSampleSize: 0,
  };
}

function emptyHistogram(): Array<{ bucket: string; count: number }> {
  return SAMPLE_HISTOGRAM_BUCKETS.map((bucket) => ({ bucket: bucket.key, count: 0 }));
}

function capSlot(used: number, cap: number): { used: number; cap: number; remaining: number } {
  return {
    used,
    cap,
    remaining: Math.max(0, cap - used),
  };
}

@Injectable()
export class CollectorCoverageService {
  private readonly collectorConfig: CollectorConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChampionAggregateReadRepository)
    private readonly aggregates: ChampionAggregateReadRepository,
    @Inject(CHAMPION_STATS_CONFIG) private readonly statsConfig: ChampionStatsConfig,
    @Optional() @Inject(COLLECTOR_CONFIG) collectorConfig?: CollectorConfig,
  ) {
    this.collectorConfig = collectorConfig ?? loadCollectorConfig(process.env);
  }

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

  /**
   * Read-only Phase 4 coverage report.
   * Never mutates DB/Redis, never calls Riot, never creates CollectorRun / leases.
   */
  async reportSafe(input: CollectorCoverageReportInput): Promise<CollectorCoverageReport> {
    try {
      return await this.report(input);
    } catch (error: unknown) {
      return this.unavailableReport(input, error);
    }
  }

  async report(input: CollectorCoverageReportInput): Promise<CollectorCoverageReport> {
    const now = new Date();
    const versions = {
      sourceNormalizationVersion: this.statsConfig.sourceNormalizationVersion,
      aggregationVersion: this.statsConfig.aggregationVersion,
    };
    const minimumSample = this.statsConfig.minimumSample;
    const nearFloorBand = buildNearFloorBand(minimumSample);
    const warnings: string[] = [];
    const reviewFlags: string[] = [];

    const [trackedPlayers, capUsage, activitySignals, densitySnapshot] = await Promise.all([
      this.loadTrackedPlayers(),
      this.loadCapUsage(),
      this.loadActivitySignals(),
      this.snapshot(input),
    ]);

    if (densitySnapshot.status !== 'available' && densitySnapshot.warning) {
      warnings.push(densitySnapshot.warning);
    }

    const platforms: CollectorCoveragePlatformDetail[] = [];
    for (const platform of input.effectivePlatforms) {
      const detail = await this.reportPlatform({
        platform,
        queueId: input.queueId,
        versions,
      });
      platforms.push(detail);
      for (const flag of detail.ladderRepresentation.reviewFlags) {
        if (!reviewFlags.includes(flag)) {
          reviewFlags.push(flag);
        }
      }
      if (detail.classicZero.status === 'unavailable' && detail.classicZero.warning) {
        warnings.push(detail.classicZero.warning);
      }
      if (detail.ladderRepresentation.warning) {
        warnings.push(detail.ladderRepresentation.warning);
      }
      if (detail.semanticPatch === null) {
        warnings.push(`No aggregate patch resolved for platform ${platform} queue ${input.queueId}.`);
      }
    }

    const championCoverage: CollectorCoverageChampionSection = {
      densityThresholds: { ...COVERAGE_DENSITY_THRESHOLDS },
      minimumSampleRankingFloor: minimumSample,
      nearFloorBand,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      positions: [...COLLECTOR_EXACT_POSITIONS],
      platforms,
    };

    return {
      ok: true,
      mode: 'coverage',
      generatedAt: now.toISOString(),
      label: 'population_coverage_observability',
      queueId: input.queueId,
      effectivePlatforms: [...input.effectivePlatforms],
      trackedPlayers,
      capUsage,
      activitySignals,
      championCoverage,
      densitySnapshot,
      reviewFlags,
      warnings,
    };
  }

  private async loadTrackedPlayers(): Promise<CollectorCoverageTrackedPlayers> {
    const [byStatusRows, byPlatformRows, bySourceRows, byDepthRows, total] = await Promise.all([
      this.prisma.trackedPlayer.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['platformRoute'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['enrollmentSource'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['discoveryDepth'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.count(),
    ]);

    const byEnrollmentSource = emptyEnrollmentSourceCounts();
    for (const row of bySourceRows) {
      byEnrollmentSource[row.enrollmentSource] = row._count._all;
    }

    return {
      total,
      byEnrollmentSource,
      byPlatformRoute: countsByKey(
        byPlatformRows.map((row) => ({ key: row.platformRoute, count: row._count._all })),
      ),
      byDiscoveryDepth: countsByKey(
        byDepthRows.map((row) => ({ key: String(row.discoveryDepth), count: row._count._all })),
      ),
      byStatus: countsByKey(
        byStatusRows.map((row) => ({ key: row.status, count: row._count._all })),
      ),
    };
  }

  private async loadCapUsage(): Promise<CollectorCoverageCapUsage> {
    // Live TrackedPlayer counts only — singleton budget drift is an audit concern.
    const [matchParticipantLive, ladderLive, totalLive] = await Promise.all([
      this.prisma.trackedPlayer.count({ where: { enrollmentSource: 'MATCH_PARTICIPANT' } }),
      this.prisma.trackedPlayer.count({ where: { enrollmentSource: 'LADDER' } }),
      this.prisma.trackedPlayer.count(),
    ]);

    return {
      matchParticipant: capSlot(
        matchParticipantLive,
        this.collectorConfig.expansionMaxTrackedPlayers,
      ),
      ladder: capSlot(ladderLive, this.collectorConfig.ladderMaxTotal),
      totalTracked: capSlot(totalLive, this.collectorConfig.totalTrackedPlayersHardCap),
    };
  }

  private async loadActivitySignals(): Promise<CollectorCoverageActivitySignals> {
    const coldAfter = this.collectorConfig.coldAfterZeroNewRuns;
    const [activePlayers, neverSuccessfulRefresh, zeroNewStreakAtOrAboveCold, streakRows] =
      await Promise.all([
        this.prisma.trackedPlayer.count({ where: { status: 'ACTIVE' } }),
        this.prisma.trackedPlayer.count({
          where: { status: 'ACTIVE', lastSuccessfulRefreshAt: null },
        }),
        this.prisma.trackedPlayer.count({
          where: {
            status: 'ACTIVE',
            consecutiveZeroNewMatchRuns: { gte: coldAfter },
          },
        }),
        this.prisma.trackedPlayer.groupBy({
          by: ['consecutiveZeroNewMatchRuns'],
          where: { status: 'ACTIVE' },
          _count: { _all: true },
        }),
      ]);

    return {
      status: 'partial',
      note:
        'HOT/WARM/COLD at refresh finalization also depends on enqueuedNewCount, which is not persisted on TrackedPlayer. Reporting consecutiveZeroNewMatchRuns signals only.',
      coldAfterZeroNewRuns: coldAfter,
      activePlayers,
      neverSuccessfulRefresh,
      zeroNewStreakAtOrAboveCold,
      byConsecutiveZeroNewMatchRuns: countsByKey(
        streakRows.map((row) => ({
          key: String(row.consecutiveZeroNewMatchRuns),
          count: row._count._all,
        })),
      ),
    };
  }

  private async reportPlatform(input: {
    platform: string;
    queueId: number;
    versions: { sourceNormalizationVersion: string; aggregationVersion: string };
  }): Promise<CollectorCoveragePlatformDetail> {
    const platformRoute = this.parsePlatformRoute(input.platform);
    const patch =
      platformRoute === null
        ? null
        : await this.aggregates.resolveLatestSemanticPatch({
            platform: platformRoute,
            queueId: input.queueId,
            versions: input.versions,
          });

    const matchCountsByNormalizedPatch = await this.loadMatchCountsByPatch(
      input.platform,
      input.queueId,
    );
    const queueTotal = matchCountsByNormalizedPatch.reduce((sum, row) => sum + row.count, 0);
    const currentPatchNormalized =
      patch === null
        ? null
        : (matchCountsByNormalizedPatch.find((row) => row.patch === patch)?.count ?? 0);

    if (patch === null || platformRoute === null) {
      return {
        platform: input.platform,
        semanticPatch: null,
        matchCounts: { queueTotal, currentPatchNormalized },
        density: emptyDensityBuckets(),
        byPosition: COLLECTOR_EXACT_POSITIONS.map(emptyPositionDensity),
        sampleSizeHistogram: emptyHistogram(),
        classicZero: {
          rosterSource: 'ChampionStaticData_public',
          rosterNote: CLASSIC_ZERO_ROSTER_NOTE,
          status: 'unavailable',
          staticDataPatchVersion: null,
          totalRosterChampions: null,
          championsWithZeroQualifyingCoverage: null,
          warning: `Classic-zero unavailable: no semantic patch for platform ${input.platform}.`,
        },
        ladderRepresentation: this.emptyLadderRepresentation(
          'Ladder representation partial: no semantic patch for champion/match tier slices.',
        ),
      };
    }

    const regionalRoute = getRegionalRouteForPlatform(platformRoute);
    const baseWhere = {
      platformRoute,
      regionalRoute,
      queueId: input.queueId,
      patch,
      rankTier: 'ALL',
      teamPosition: { in: [...COLLECTOR_EXACT_POSITIONS] },
      sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
      aggregationVersion: input.versions.aggregationVersion,
    };

    const [density, byPosition, sampleSizeHistogram, classicZero, ladderRepresentation] =
      await Promise.all([
        this.loadDensityBuckets(baseWhere),
        this.loadPositionDensity({
          platform: platformRoute,
          regionalRoute,
          queueId: input.queueId,
          patch,
          versions: input.versions,
        }),
        this.loadSampleSizeHistogram(baseWhere),
        this.loadClassicZero({
          platform: platformRoute,
          regionalRoute,
          queueId: input.queueId,
          patch,
          versions: input.versions,
        }),
        this.loadLadderRepresentation({
          platform: input.platform,
          queueId: input.queueId,
          patch,
          versions: input.versions,
          regionalRoute,
        }),
      ]);

    return {
      platform: input.platform,
      semanticPatch: patch,
      matchCounts: { queueTotal, currentPatchNormalized },
      density,
      byPosition,
      sampleSizeHistogram,
      classicZero,
      ladderRepresentation,
    };
  }

  private async loadDensityBuckets(
    baseWhere: Record<string, unknown>,
  ): Promise<CollectorCoverageDensityBuckets> {
    const [gte1, gte30, gte100] = await Promise.all([
      this.prisma.championAggregate.count({
        where: { ...baseWhere, sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte1 } },
      }),
      this.prisma.championAggregate.count({
        where: { ...baseWhere, sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte30 } },
      }),
      this.prisma.championAggregate.count({
        where: { ...baseWhere, sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte100 } },
      }),
    ]);
    return {
      championPositionKeysGte1: gte1,
      championPositionKeysGte30: gte30,
      championPositionKeysGte100: gte100,
    };
  }

  private async loadPositionDensity(input: {
    platform: PlatformRoute;
    regionalRoute: string;
    queueId: number;
    patch: string;
    versions: { sourceNormalizationVersion: string; aggregationVersion: string };
  }): Promise<CollectorCoveragePositionDensity[]> {
    return Promise.all(
      COLLECTOR_EXACT_POSITIONS.map(async (position) => {
        const baseWhere = {
          platformRoute: input.platform,
          regionalRoute: input.regionalRoute,
          queueId: input.queueId,
          patch: input.patch,
          rankTier: 'ALL',
          teamPosition: position,
          sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
          aggregationVersion: input.versions.aggregationVersion,
        };
        const [maxAgg, gte1, gte30, gte100] = await Promise.all([
          this.prisma.championAggregate.aggregate({
            where: baseWhere,
            _max: { sampleSize: true },
          }),
          this.prisma.championAggregate.count({
            where: { ...baseWhere, sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte1 } },
          }),
          this.prisma.championAggregate.count({
            where: { ...baseWhere, sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte30 } },
          }),
          this.prisma.championAggregate.count({
            where: { ...baseWhere, sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte100 } },
          }),
        ]);
        return {
          position,
          gte1,
          gte30,
          gte100,
          maxSampleSize: maxAgg._max.sampleSize ?? 0,
        };
      }),
    );
  }

  private async loadSampleSizeHistogram(
    baseWhere: Record<string, unknown>,
  ): Promise<Array<{ bucket: string; count: number }>> {
    const rows = await this.prisma.championAggregate.groupBy({
      by: ['sampleSize'],
      where: {
        ...baseWhere,
        sampleSize: { gte: 1 },
      },
      _count: { _all: true },
    });

    const histogram = emptyHistogram();
    const byKey = new Map(histogram.map((row) => [row.bucket, row]));

    for (const row of rows) {
      const size = row.sampleSize;
      const bucket = SAMPLE_HISTOGRAM_BUCKETS.find((entry) => size >= entry.min && size <= entry.max);
      if (!bucket) {
        continue;
      }
      const target = byKey.get(bucket.key);
      if (target) {
        target.count += row._count._all;
      }
    }

    return histogram;
  }

  private async loadClassicZero(input: {
    platform: PlatformRoute;
    regionalRoute: string;
    queueId: number;
    patch: string;
    versions: { sourceNormalizationVersion: string; aggregationVersion: string };
  }): Promise<CollectorCoverageClassicZero> {
    const staticPatch = await this.prisma.patch.findFirst({
      where: { isActive: true, staticDataStatus: StaticDataStatus.READY },
      orderBy: { updatedAt: 'desc' },
    });
    const resolvedPatch =
      staticPatch ??
      (await this.prisma.patch.findFirst({
        where: { staticDataStatus: StaticDataStatus.READY },
        orderBy: [{ normalizedMajorMinor: 'desc' }, { version: 'desc' }],
      }));

    if (!resolvedPatch) {
      return {
        rosterSource: 'ChampionStaticData_public',
        rosterNote: CLASSIC_ZERO_ROSTER_NOTE,
        status: 'unavailable',
        staticDataPatchVersion: null,
        totalRosterChampions: null,
        championsWithZeroQualifyingCoverage: null,
        warning: 'Classic-zero unavailable: no READY ChampionStaticData patch.',
      };
    }

    const [staticRows, coveredRows] = await Promise.all([
      this.prisma.championStaticData.findMany({
        where: {
          patchId: resolvedPatch.id,
          ...publicChampionStaticWhere(),
        },
        select: { championId: true, championKey: true },
      }),
      this.prisma.championAggregate.findMany({
        where: {
          platformRoute: input.platform,
          regionalRoute: input.regionalRoute,
          queueId: input.queueId,
          patch: input.patch,
          rankTier: 'ALL',
          teamPosition: { in: [...COLLECTOR_EXACT_POSITIONS] },
          sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
          aggregationVersion: input.versions.aggregationVersion,
          sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte1 },
          championId: { lt: CLASSIC_CHAMPION_ID_MIN },
        },
        distinct: ['championId'],
        select: { championId: true },
      }),
    ]);

    const rosterIds = new Set(
      staticRows.filter((row) => isPublicChampionEntry(row)).map((row) => row.championId),
    );
    const coveredIds = new Set(coveredRows.map((row) => row.championId));
    let zeroCount = 0;
    for (const championId of rosterIds) {
      if (!coveredIds.has(championId)) {
        zeroCount += 1;
      }
    }

    return {
      rosterSource: 'ChampionStaticData_public',
      rosterNote: CLASSIC_ZERO_ROSTER_NOTE,
      status: 'available',
      staticDataPatchVersion: resolvedPatch.version,
      totalRosterChampions: rosterIds.size,
      championsWithZeroQualifyingCoverage: zeroCount,
    };
  }

  private async loadLadderRepresentation(input: {
    platform: string;
    queueId: number;
    patch: string;
    regionalRoute: string;
    versions: { sourceNormalizationVersion: string; aggregationVersion: string };
  }): Promise<CollectorCoverageLadderRepresentation> {
    const reviewFlags: string[] = [];
    const warnings: string[] = [];

    const [ladderTierRows, missingSnapshotRows, observationRows, exactTierRows] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ tier: string; count: number }>>`
          SELECT latest.tier AS tier, COUNT(*)::int AS count
          FROM "TrackedPlayer" tp
          INNER JOIN LATERAL (
            SELECT rs.tier
            FROM "RankSnapshot" rs
            WHERE rs."playerAccountId" = tp."playerAccountId"
              AND rs."queueType" = 'RANKED_SOLO_5x5'
            ORDER BY rs."capturedAt" DESC
            LIMIT 1
          ) latest ON true
          WHERE tp."enrollmentSource" = 'LADDER'
            AND tp."platformRoute" = ${input.platform}
          GROUP BY latest.tier
        `,
        this.prisma.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
          FROM "TrackedPlayer" tp
          WHERE tp."enrollmentSource" = 'LADDER'
            AND tp."platformRoute" = ${input.platform}
            AND NOT EXISTS (
              SELECT 1
              FROM "RankSnapshot" rs
              WHERE rs."playerAccountId" = tp."playerAccountId"
                AND rs."queueType" = 'RANKED_SOLO_5x5'
            )
        `,
        this.prisma.$queryRaw<Array<{ tier: string; count: number }>>`
          SELECT mp."rankTierAtIngestion" AS tier, COUNT(*)::int AS count
          FROM "MatchParticipant" mp
          INNER JOIN "Match" m ON m.id = mp."matchId"
          WHERE m."queueId" = ${input.queueId}
            AND m."platformRoute" = ${input.platform}
            AND m."normalizedPatch" = ${input.patch}
            AND mp."rankTierAtIngestion" IS NOT NULL
          GROUP BY mp."rankTierAtIngestion"
        `,
        this.prisma.championAggregate.groupBy({
          by: ['rankTier'],
          where: {
            platformRoute: input.platform,
            regionalRoute: input.regionalRoute,
            queueId: input.queueId,
            patch: input.patch,
            rankTier: { not: 'ALL' },
            teamPosition: { in: [...COLLECTOR_EXACT_POSITIONS] },
            sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
            aggregationVersion: input.versions.aggregationVersion,
            sampleSize: { gte: COVERAGE_DENSITY_THRESHOLDS.gte1 },
          },
          _count: { _all: true },
        }),
      ]);

    const ladderPlayersByTier = countsByKey(
      ladderTierRows.map((row) => ({ key: row.tier, count: row.count })),
    );
    const ladderPlayersMissingRankSnapshot = missingSnapshotRows[0]?.count ?? 0;
    const hasLadderPlayers =
      Object.values(ladderPlayersByTier).some((count) => count > 0) ||
      ladderPlayersMissingRankSnapshot > 0;

    const observationsByTier = countsByKey(
      observationRows.map((row) => ({ key: row.tier, count: row.count })),
    );
    const hasObservations = Object.keys(observationsByTier).length > 0;

    const championPositionKeysByExactTierGte1 = countsByKey(
      exactTierRows.map((row) => ({ key: row.rankTier, count: row._count._all })),
    );
    const hasExactTierAggregates = Object.keys(championPositionKeysByExactTierGte1).length > 0;

    if (hasLadderPlayers) {
      const knownTiers = Object.keys(ladderPlayersByTier);
      const hasRepresentative = knownTiers.some((tier) => REPRESENTATIVE_TIERS.has(tier));
      const hasOnlyApex =
        knownTiers.length > 0 &&
        knownTiers.every((tier) => APEX_TIERS.has(tier)) &&
        !hasRepresentative;
      if (hasOnlyApex) {
        reviewFlags.push(
          `platform ${input.platform}: LADDER roots with RankSnapshot appear apex-only (Challenger/GM/Master); no Diamond/Emerald/Platinum/Gold representation yet.`,
        );
      }
    }

    let status: CollectorCoverageLadderRepresentation['status'] = 'available';
    if (!hasLadderPlayers && !hasObservations && !hasExactTierAggregates) {
      status = 'partial';
      warnings.push(
        `platform ${input.platform}: no LADDER roots with snapshots, no current-patch participant tier observations, and no exact-tier aggregates.`,
      );
    } else if (!hasLadderPlayers || !hasObservations) {
      status = 'partial';
    }

    return {
      status,
      ladderPlayersByTier: hasLadderPlayers ? ladderPlayersByTier : {},
      ladderPlayersMissingRankSnapshot,
      currentPatchQueueParticipantObservationsByTier: hasObservations ? observationsByTier : null,
      currentPatchQueueMatchesByTier: {
        status: 'unavailable',
        reason: MATCHES_BY_TIER_UNAVAILABLE_REASON,
      },
      championPositionKeysByExactTierGte1: hasExactTierAggregates
        ? championPositionKeysByExactTierGte1
        : null,
      reviewFlags,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    };
  }

  private emptyLadderRepresentation(warning: string): CollectorCoverageLadderRepresentation {
    return {
      status: 'partial',
      ladderPlayersByTier: {},
      ladderPlayersMissingRankSnapshot: 0,
      currentPatchQueueParticipantObservationsByTier: null,
      currentPatchQueueMatchesByTier: {
        status: 'unavailable',
        reason: MATCHES_BY_TIER_UNAVAILABLE_REASON,
      },
      championPositionKeysByExactTierGte1: null,
      reviewFlags: [],
      warning,
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

  private unavailableReport(
    input: CollectorCoverageReportInput,
    error: unknown,
  ): CollectorCoverageReport {
    const minimumSample = this.statsConfig.minimumSample;
    const warning = error instanceof Error ? error.message : 'Coverage report failed';
    return {
      ok: true,
      mode: 'coverage',
      generatedAt: new Date().toISOString(),
      label: 'population_coverage_observability',
      queueId: input.queueId,
      effectivePlatforms: [...input.effectivePlatforms],
      trackedPlayers: {
        total: 0,
        byEnrollmentSource: emptyEnrollmentSourceCounts(),
        byPlatformRoute: {},
        byDiscoveryDepth: {},
        byStatus: {},
      },
      capUsage: {
        matchParticipant: capSlot(0, this.collectorConfig.expansionMaxTrackedPlayers),
        ladder: capSlot(0, this.collectorConfig.ladderMaxTotal),
        totalTracked: capSlot(0, this.collectorConfig.totalTrackedPlayersHardCap),
      },
      activitySignals: {
        status: 'partial',
        note: 'Coverage report failed before activity signals could be loaded.',
        coldAfterZeroNewRuns: this.collectorConfig.coldAfterZeroNewRuns,
        activePlayers: 0,
        neverSuccessfulRefresh: 0,
        zeroNewStreakAtOrAboveCold: 0,
        byConsecutiveZeroNewMatchRuns: {},
      },
      championCoverage: {
        densityThresholds: { ...COVERAGE_DENSITY_THRESHOLDS },
        minimumSampleRankingFloor: minimumSample,
        nearFloorBand: buildNearFloorBand(minimumSample),
        sourceNormalizationVersion: this.statsConfig.sourceNormalizationVersion,
        aggregationVersion: this.statsConfig.aggregationVersion,
        positions: [...COLLECTOR_EXACT_POSITIONS],
        platforms: [],
      },
      densitySnapshot: this.unavailableSnapshot(input, error),
      reviewFlags: [],
      warnings: [warning],
    };
  }
}
