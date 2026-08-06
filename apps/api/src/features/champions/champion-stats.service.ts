import { Inject, Injectable } from '@nestjs/common';
import {
  CHAMPION_STATS_DISCLAIMER,
  CHAMPION_STATS_FILTER_QUEUE_IDS,
  ChampionStatsFiltersResponseSchema,
  ChampionStatsInvalidFilterError,
  ChampionStatsResponseSchema,
  ChampionStatsTableResponseSchema,
  PLATFORM_ROUTES,
  RANK_TIER_SEMANTICS,
  RankTierSchema,
  buildChampionStatsFilterQueue,
  getRegionalRouteForPlatform,
  parsePatchVersion,
  type ChampionRankingPosition,
  type ChampionStatsFiltersResponse,
  type ChampionStatsGenerationScope,
  type ChampionStatsQuery,
  type ChampionStatsResponse,
  type ChampionStatsTableQuery,
  type ChampionStatsTableResponse,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { ChampionStatsCacheService } from './champion-stats-cache.service';
import {
  resolveSharedFilters,
  toRequestedFiltersFromStats,
  toRequestedFiltersFromTable,
} from './champion-stats-filters';
import {
  FIVE_RANKING_POSITIONS,
  mapAggregateDimensions,
  mapAggregateMetrics,
  mapAggregateRow,
  mapChampionDetail,
} from './champion-stats.mapper';
import { ChampionStaticService } from './champion-static.service';

const AVAILABLE_TIERS: ChampionStatsTierFilter[] = [
  'ALL',
  ...RankTierSchema.options,
  'UNKNOWN',
];

@Injectable()
export class ChampionStatsService {
  constructor(
    @Inject(CHAMPION_STATS_CONFIG) private readonly config: ChampionStatsConfig,
    @Inject(ChampionAggregateReadRepository)
    private readonly aggregates: ChampionAggregateReadRepository,
    @Inject(ChampionStaticRepository) private readonly staticChampions: ChampionStaticRepository,
    @Inject(ChampionStaticService) private readonly championStatic: ChampionStaticService,
    @Inject(DataDragonChampionService) private readonly media: DataDragonChampionService,
    @Inject(ChampionStatsCacheService) private readonly cache: ChampionStatsCacheService,
  ) {}

  async getFilters(): Promise<ChampionStatsFiltersResponse> {
    const versions = this.versions();
    const platform = this.config.defaultPlatform;
    const queueId = this.config.defaultQueueId;
    const defaultPatch = await this.aggregates.resolveLatestSemanticPatch({
      platform,
      queueId,
      versions,
    });

    const scope = this.generationScope(
      platform,
      defaultPatch ?? '__none__',
      queueId,
    );
    const generation = await this.cache.getGeneration(scope);
    const cacheKey = this.cache.filtersKey({ scope, generation });
    const cached = await this.cache.getParsed(cacheKey, ChampionStatsFiltersResponseSchema);
    if (cached) {
      return cached;
    }

    const [availablePlatformRaw, availablePatches, availableQueueIds] = await Promise.all([
      this.aggregates.listAvailablePlatforms(versions),
      this.aggregates.listDistinctPatches({ platform, queueId, versions }),
      this.aggregates.listAvailableQueueIds({ platform, versions }),
    ]);

    const availablePlatforms = uniquePlatforms([
      platform,
      ...availablePlatformRaw.filter((value): value is PlatformRoute =>
        (PLATFORM_ROUTES as readonly string[]).includes(value),
      ),
    ]);

    const queueIds = uniqueNumbers([
      queueId,
      ...availableQueueIds.filter((id) => id >= 0),
      ...CHAMPION_STATS_FILTER_QUEUE_IDS,
    ]);

    const sortedPatches = sortPatchesSemanticDesc(availablePatches);

    const response = ChampionStatsFiltersResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      defaultPlatform: platform,
      defaultQueueId: queueId,
      defaultPatch,
      availablePlatforms,
      availablePatches: sortedPatches,
      availableQueues: queueIds.map((id) => buildChampionStatsFilterQueue(id)),
      availableTiers: AVAILABLE_TIERS,
      availablePositions: FIVE_RANKING_POSITIONS,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      ...(defaultPatch
        ? {
            sampleScope: {
              kind: 'COLLECTED_SAMPLE' as const,
              platform,
              patch: defaultPatch,
              queueId,
            },
          }
        : {}),
    });

    await this.cache.setIfGenerationCurrent({
      scope,
      expectedGeneration: generation,
      buildKey: (gen) => this.cache.filtersKey({ scope, generation: gen }),
      value: response,
    });

    return response;
  }

  async getTable(query: ChampionStatsTableQuery): Promise<ChampionStatsTableResponse> {
    if (query.cursor !== undefined) {
      throw new ChampionStatsInvalidFilterError(
        'Cursor pagination is not implemented for champion stats in M8; use offset instead.',
        { cursor: query.cursor },
      );
    }

    const shared = resolveSharedFilters(this.config, query);
    const position = query.position;
    const offset = query.offset ?? 0;
    const limit = query.limit;
    const resolvedPatch = await this.resolvePatch(
      shared.platform,
      shared.queueId,
      query.patch,
    );

    if (resolvedPatch.patch === null) {
      return this.emptyTableResponse({
        query,
        shared,
        patch: query.patch ?? 'unavailable',
        usedDefaultPatch: resolvedPatch.usedDefaultPatch,
        emptyReason: 'NO_MATCHING_AGGREGATES',
        offset,
        limit,
      });
    }

    const patch = resolvedPatch.patch;
    const regionalRoute = getRegionalRouteForPlatform(shared.platform);
    const scope = this.generationScope(shared.platform, patch, shared.queueId);
    const generation = await this.cache.getGeneration(scope);
    const cacheKey = this.cache.tableKey({
      scope,
      generation,
      position,
      tier: shared.tier,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
      limit,
      offset,
      minimumSample: shared.effectiveMinimumSample,
      includeInsufficient: shared.includeInsufficient,
    });

    const cached = await this.cache.getParsed(cacheKey, ChampionStatsTableResponseSchema);
    if (cached) {
      return cached;
    }

    const aggregateScope = {
      ...this.versions(),
      platform: shared.platform,
      regionalRoute,
      queueId: shared.queueId,
      patch,
      tier: shared.tier,
      position,
      minimumSample: shared.effectiveMinimumSample,
    };

    const { rows: aggregateRows, totalCount } = await this.aggregates.findTableRows({
      scope: aggregateScope,
      sort: { sortBy: query.sortBy, sortDirection: query.sortDirection },
      limit,
      offset,
    });

    const freshness = await this.aggregates.resolveFreshness({
      versions: this.versions(),
      platform: shared.platform,
      queueId: shared.queueId,
      patch,
    });

    const championMeta = await this.staticChampions.findByChampionIds(
      aggregateRows.map((row) => row.championId),
    );

    const rows = aggregateRows.flatMap((aggregate) => {
      const champion = championMeta.get(aggregate.championId);
      if (!champion) {
        return [];
      }
      return [
        mapAggregateRow({
          aggregate,
          champion,
          media: this.media,
          regionalRoute,
          confidenceLevel: this.config.confidenceLevel,
          insufficientBelow: this.config.minimumSample,
        }),
      ];
    });

    let emptyReason: ChampionStatsTableResponse['emptyReason'];
    if (rows.length === 0) {
      emptyReason = await this.resolveTableEmptyReason(aggregateScope);
    }

    const response = ChampionStatsTableResponseSchema.parse({
      rows,
      ...(emptyReason !== undefined ? { emptyReason } : {}),
      pagination: {
        nextCursor: null,
        limit,
        offset,
        totalCount,
      },
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
      },
      freshness,
      requestedFilters: toRequestedFiltersFromTable(query),
      resolvedFilters: {
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
        tier: shared.tier,
        position,
      },
      usedDefaultPlatform: shared.usedDefaultPlatform,
      usedDefaultPatch: resolvedPatch.usedDefaultPatch,
      effectiveMinimumSample: shared.effectiveMinimumSample,
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.aggregationVersion,
    });

    await this.cache.setIfGenerationCurrent({
      scope,
      expectedGeneration: generation,
      buildKey: (gen) =>
        this.cache.tableKey({
          scope,
          generation: gen,
          position,
          tier: shared.tier,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
          limit,
          offset,
          minimumSample: shared.effectiveMinimumSample,
          includeInsufficient: shared.includeInsufficient,
        }),
      value: response,
    });

    return response;
  }

  async getChampionStats(
    championKey: string,
    query: ChampionStatsQuery,
  ): Promise<ChampionStatsResponse> {
    const staticRow = await this.championStatic.requireByKey(championKey);
    const shared = resolveSharedFilters(this.config, query);
    const resolvedPatch = await this.resolvePatch(
      shared.platform,
      shared.queueId,
      query.patch,
    );

    if (resolvedPatch.patch === null) {
      return this.emptyChampionStatsResponse({
        championKey,
        staticRow,
        query,
        shared,
        patch: query.patch ?? 'unavailable',
        usedDefaultPatch: resolvedPatch.usedDefaultPatch,
        emptyReason: 'CHAMPION_HAS_NO_STATS',
      });
    }

    const patch = resolvedPatch.patch;
    const regionalRoute = getRegionalRouteForPlatform(shared.platform);
    const scope = this.generationScope(shared.platform, patch, shared.queueId);
    const generation = await this.cache.getGeneration(scope);
    const cacheKey = this.cache.championKey({
      scope,
      generation,
      championKey: staticRow.championKey,
      position: shared.position,
      tier: shared.tier,
      minimumSample: shared.effectiveMinimumSample,
      includeInsufficient: shared.includeInsufficient,
    });

    const cached = await this.cache.getParsed(cacheKey, ChampionStatsResponseSchema);
    if (cached) {
      return cached;
    }

    const baseScope = {
      ...this.versions(),
      platform: shared.platform,
      regionalRoute,
      queueId: shared.queueId,
      patch,
      tier: shared.tier,
      minimumSample: shared.effectiveMinimumSample,
    };

    const breakdownRows = await this.aggregates.findPositionBreakdown({
      championId: staticRow.championId,
      scope: baseScope,
      positions: FIVE_RANKING_POSITIONS,
    });
    const byPosition = new Map(
      breakdownRows.map((row) => [row.teamPosition as ChampionRankingPosition, row]),
    );

    const positionBreakdown = FIVE_RANKING_POSITIONS.map((position) => {
      const aggregate = byPosition.get(position);
      if (!aggregate) {
        return { position, dimensions: null, metrics: null };
      }
      return {
        position,
        dimensions: mapAggregateDimensions(aggregate, regionalRoute),
        metrics: mapAggregateMetrics(
          aggregate,
          this.config.confidenceLevel,
          this.config.minimumSample,
        ),
      };
    });

    let stats: ChampionStatsResponse['stats'] = null;
    let emptyReason: ChampionStatsResponse['emptyReason'];

    if (shared.position !== null) {
      const exact = await this.aggregates.findExactAggregate({
        championId: staticRow.championId,
        scope: { ...baseScope, position: shared.position },
      });

      if (exact) {
        stats = {
          dimensions: mapAggregateDimensions(exact, regionalRoute),
          metrics: mapAggregateMetrics(
            exact,
            this.config.confidenceLevel,
            this.config.minimumSample,
          ),
        };
      } else {
        emptyReason = await this.resolveChampionEmptyReason({
          championId: staticRow.championId,
          scope: { ...baseScope, position: shared.position },
        });
      }
    } else {
      const anyRole = positionBreakdown.some((entry) => entry.metrics !== null);
      if (!anyRole) {
        emptyReason = 'CHAMPION_HAS_NO_STATS';
      }
    }

    const freshness = await this.aggregates.resolveFreshness({
      versions: this.versions(),
      platform: shared.platform,
      queueId: shared.queueId,
      patch,
    });

    const response = ChampionStatsResponseSchema.parse({
      champion: mapChampionDetail(staticRow, this.media, {
        requestedKey: championKey.trim(),
      }),
      stats,
      ...(emptyReason !== undefined ? { emptyReason } : {}),
      positionBreakdown,
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
      },
      freshness,
      requestedFilters: toRequestedFiltersFromStats(query),
      resolvedFilters: {
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
        tier: shared.tier,
        position: shared.position,
      },
      usedDefaultPlatform: shared.usedDefaultPlatform,
      usedDefaultPatch: resolvedPatch.usedDefaultPatch,
      effectiveMinimumSample: shared.effectiveMinimumSample,
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.aggregationVersion,
    });

    await this.cache.setIfGenerationCurrent({
      scope,
      expectedGeneration: generation,
      buildKey: (gen) =>
        this.cache.championKey({
          scope,
          generation: gen,
          championKey: staticRow.championKey,
          position: shared.position,
          tier: shared.tier,
          minimumSample: shared.effectiveMinimumSample,
          includeInsufficient: shared.includeInsufficient,
        }),
      value: response,
    });

    return response;
  }

  private versions() {
    return {
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.aggregationVersion,
    };
  }

  private generationScope(
    platform: PlatformRoute,
    patch: string,
    queueId: number,
  ): ChampionStatsGenerationScope {
    return {
      ...this.versions(),
      platform,
      patch,
      queueId,
    };
  }

  private async resolvePatch(
    platform: PlatformRoute,
    queueId: number,
    requestedPatch: string | undefined,
  ): Promise<{ patch: string | null; usedDefaultPatch: boolean }> {
    if (requestedPatch !== undefined && requestedPatch.trim() !== '') {
      return { patch: requestedPatch.trim(), usedDefaultPatch: false };
    }

    const latest = await this.aggregates.resolveLatestSemanticPatch({
      platform,
      queueId,
      versions: this.versions(),
    });
    return { patch: latest, usedDefaultPatch: true };
  }

  private async resolveTableEmptyReason(scope: {
    platform: PlatformRoute;
    regionalRoute: ReturnType<typeof getRegionalRouteForPlatform>;
    queueId: number;
    patch: string;
    tier: ChampionStatsTierFilter;
    position: ChampionRankingPosition;
    minimumSample: number;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
  }): Promise<ChampionStatsTableResponse['emptyReason']> {
    if (scope.minimumSample <= 0) {
      return 'NO_MATCHING_AGGREGATES';
    }

    const unfiltered = await this.aggregates.findTableRows({
      scope: { ...scope, minimumSample: 0 },
      sort: { sortBy: 'sampleSize', sortDirection: 'desc' },
      limit: 1,
      offset: 0,
    });

    if (unfiltered.totalCount > 0) {
      return 'BELOW_MINIMUM_SAMPLE';
    }
    return 'NO_MATCHING_AGGREGATES';
  }

  private async resolveChampionEmptyReason(input: {
    championId: number;
    scope: {
      platform: PlatformRoute;
      regionalRoute: ReturnType<typeof getRegionalRouteForPlatform>;
      queueId: number;
      patch: string;
      tier: ChampionStatsTierFilter;
      position: ChampionRankingPosition;
      minimumSample: number;
      sourceNormalizationVersion: string;
      aggregationVersion: string;
    };
  }): Promise<ChampionStatsResponse['emptyReason']> {
    if (input.scope.minimumSample <= 0) {
      return 'CHAMPION_HAS_NO_STATS';
    }

    const below = await this.aggregates.findExactAggregate({
      championId: input.championId,
      scope: { ...input.scope, minimumSample: 0 },
    });
    if (below) {
      return 'BELOW_MINIMUM_SAMPLE';
    }
    return 'CHAMPION_HAS_NO_STATS';
  }

  private emptyTableResponse(input: {
    query: ChampionStatsTableQuery;
    shared: ReturnType<typeof resolveSharedFilters>;
    patch: string;
    usedDefaultPatch: boolean;
    emptyReason: NonNullable<ChampionStatsTableResponse['emptyReason']>;
    offset: number;
    limit: number;
  }): ChampionStatsTableResponse {
    return ChampionStatsTableResponseSchema.parse({
      rows: [],
      emptyReason: input.emptyReason,
      pagination: {
        nextCursor: null,
        limit: input.limit,
        offset: input.offset,
        totalCount: 0,
      },
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: input.shared.platform,
        patch: input.patch,
        queueId: input.shared.queueId,
      },
      freshness: 'UNKNOWN',
      requestedFilters: toRequestedFiltersFromTable(input.query),
      resolvedFilters: {
        platform: input.shared.platform,
        patch: input.patch,
        queueId: input.shared.queueId,
        tier: input.shared.tier,
        position: input.query.position,
      },
      usedDefaultPlatform: input.shared.usedDefaultPlatform,
      usedDefaultPatch: input.usedDefaultPatch,
      effectiveMinimumSample: input.shared.effectiveMinimumSample,
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.aggregationVersion,
    });
  }

  private emptyChampionStatsResponse(input: {
    championKey: string;
    staticRow: Awaited<ReturnType<ChampionStaticService['requireByKey']>>;
    query: ChampionStatsQuery;
    shared: ReturnType<typeof resolveSharedFilters>;
    patch: string;
    usedDefaultPatch: boolean;
    emptyReason: NonNullable<ChampionStatsResponse['emptyReason']>;
  }): ChampionStatsResponse {
    return ChampionStatsResponseSchema.parse({
      champion: mapChampionDetail(input.staticRow, this.media, {
        requestedKey: input.championKey.trim(),
      }),
      stats: null,
      emptyReason: input.emptyReason,
      positionBreakdown: FIVE_RANKING_POSITIONS.map((position) => ({
        position,
        dimensions: null,
        metrics: null,
      })),
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: input.shared.platform,
        patch: input.patch,
        queueId: input.shared.queueId,
      },
      freshness: 'UNKNOWN',
      requestedFilters: toRequestedFiltersFromStats(input.query),
      resolvedFilters: {
        platform: input.shared.platform,
        patch: input.patch,
        queueId: input.shared.queueId,
        tier: input.shared.tier,
        position: input.shared.position,
      },
      usedDefaultPlatform: input.shared.usedDefaultPlatform,
      usedDefaultPatch: input.usedDefaultPatch,
      effectiveMinimumSample: input.shared.effectiveMinimumSample,
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.aggregationVersion,
    });
  }
}

function uniquePlatforms(values: PlatformRoute[]): PlatformRoute[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function sortPatchesSemanticDesc(patches: string[]): string[] {
  return [...patches].sort((a, b) => {
    const pa = parsePatchVersion(a);
    const pb = parsePatchVersion(b);
    const aMajor = pa?.major ?? -1;
    const aMinor = pa?.minor ?? -1;
    const bMajor = pb?.major ?? -1;
    const bMinor = pb?.minor ?? -1;
    if (aMajor !== bMajor) {
      return bMajor - aMajor;
    }
    if (aMinor !== bMinor) {
      return bMinor - aMinor;
    }
    return b.localeCompare(a);
  });
}
