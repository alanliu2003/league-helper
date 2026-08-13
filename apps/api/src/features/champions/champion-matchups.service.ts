import { Inject, Injectable } from '@nestjs/common';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionMatchupsResponseSchema,
  RANK_TIER_SEMANTICS,
  exactTiersForRankScope,
  legacyTierFilterToRankScope,
  parseRankScopeCacheToken,
  serializeRankScopeCacheToken,
  type ChampionMatchupsQuery,
  type ChampionMatchupsResponse,
  type ChampionStatsGenerationScope,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import { MATCHUP_RANKING_POLICY, rankStrongAndWeakMatchups } from '@league-helper/match-analytics';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import { ChampionMatchupReadRepository } from '../../persistence/champion-matchup-read.repository';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { ChampionStatsCacheService } from './champion-stats-cache.service';
import { resolveSharedFilters } from './champion-stats-filters';
import { ChampionStaticService } from './champion-static.service';
import { mapMatchupRow, mergeMatchupRowsByOpponent } from './champion-matchups.mapper';

@Injectable()
export class ChampionMatchupsService {
  constructor(
    @Inject(CHAMPION_STATS_CONFIG) private readonly config: ChampionStatsConfig,
    @Inject(ChampionStaticService) private readonly championStatic: ChampionStaticService,
    @Inject(ChampionStaticRepository) private readonly staticRepo: ChampionStaticRepository,
    @Inject(ChampionAggregateReadRepository)
    private readonly aggregates: ChampionAggregateReadRepository,
    @Inject(ChampionMatchupReadRepository) private readonly matchups: ChampionMatchupReadRepository,
    @Inject(DataDragonChampionService) private readonly media: DataDragonChampionService,
    @Inject(ChampionStatsCacheService) private readonly cache: ChampionStatsCacheService,
  ) {}

  async getMatchups(
    championKey: string,
    query: ChampionMatchupsQuery,
  ): Promise<ChampionMatchupsResponse> {
    const staticRow = await this.championStatic.requireByKey(championKey);
    const shared = resolveSharedFilters(this.config, query);
    const rankScope = query.rankScope
      ? parseRankScopeCacheToken(query.rankScope)
      : legacyTierFilterToRankScope(shared.tier);
    const displayFloor = this.config.matchupDisplayFloor;

    const resolvedPatch = await this.aggregates.resolveLatestSemanticPatch({
      platform: shared.platform,
      queueId: shared.queueId,
      versions: {
        sourceNormalizationVersion: this.config.sourceNormalizationVersion,
        aggregationVersion: this.config.aggregationVersion,
      },
    });
    const patch = query.patch?.trim() || resolvedPatch;
    if (!patch) {
      return this.emptyResponse({
        platform: shared.platform,
        patch: query.patch ?? 'unavailable',
        queueId: shared.queueId,
        tier: shared.tier,
        position: query.position,
        emptyReason: 'NO_ELIGIBLE_MATCHUPS',
        displayFloor,
      });
    }

    if (rankScope.kind === 'UNKNOWN') {
      return this.emptyResponse({
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
        tier: shared.tier,
        position: query.position,
        emptyReason: 'UNKNOWN_RANK_HIDDEN',
        displayFloor,
      });
    }

    const scope = this.buildScope(shared.platform, patch, shared.queueId);
    const generation = await this.cache.getMatchupGeneration(scope);
    const rankScopeToken = serializeRankScopeCacheToken(rankScope);
    const cacheKey = this.cache.matchupsKey({
      scope,
      generation,
      championKey: staticRow.championKey,
      position: query.position,
      rankScopeToken,
      displayFloor,
    });
    const cached = await this.cache.getParsed(cacheKey, ChampionMatchupsResponseSchema);
    if (cached) {
      return cached;
    }

    const rankTiers = rankScope.kind === 'ALL' ? ['ALL'] : [...exactTiersForRankScope(rankScope)];
    const rawRows = await this.matchups.findByChampion({
      championId: staticRow.championId,
      patch,
      platformRoute: shared.platform,
      queueId: shared.queueId,
      position: query.position,
      rankTiers,
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.matchupAggregationVersion,
    });

    const merged = rankScope.kind === 'SEGMENT' ? mergeMatchupRowsByOpponent(rawRows) : rawRows;
    const opponentIds = [...new Set(merged.map((row) => row.opponentChampionId))];
    const opponentById = await this.staticRepo.findByChampionIds(opponentIds);

    const mapped = merged.flatMap((row) => {
      const opponent = opponentById.get(row.opponentChampionId);
      if (!opponent) {
        return [];
      }
      return [
        mapMatchupRow(row, opponent, this.media, {
          confidenceLevel: this.config.confidenceLevel,
          displayFloor,
        }),
      ];
    });

    const rankable = mapped.map((row) => ({
      ...row,
      opponentChampionId: row.opponent.championId,
    }));
    const ranked = rankStrongAndWeakMatchups(rankable, {
      displayFloor,
      confidenceLevel: this.config.confidenceLevel,
    });

    const emptyReason =
      ranked.strongAgainst.length === 0 && ranked.weakAgainst.length === 0
        ? ('NO_ELIGIBLE_MATCHUPS' as const)
        : null;

    const response = ChampionMatchupsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
      },
      resolvedFilters: {
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
        tier: shared.tier,
        position: query.position,
      },
      emptyReason,
      displayFloor,
      rankingPolicy: MATCHUP_RANKING_POLICY,
      totalEligiblePairs: ranked.eligibleCount,
      totalSourcePairs: mapped.length,
      strongAgainst: ranked.strongAgainst,
      weakAgainst: ranked.weakAgainst,
    });

    await this.cache.setIfMatchupGenerationCurrent({
      scope,
      expectedGeneration: generation,
      buildKey: (gen) =>
        this.cache.matchupsKey({
          scope,
          generation: gen,
          championKey: staticRow.championKey,
          position: query.position,
          rankScopeToken,
          displayFloor,
        }),
      value: response,
    });

    return response;
  }

  private buildScope(
    platform: PlatformRoute,
    patch: string,
    queueId: number,
  ): ChampionStatsGenerationScope {
    return {
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.matchupAggregationVersion,
      platform,
      patch,
      queueId,
    };
  }

  private emptyResponse(input: {
    platform: PlatformRoute;
    patch: string;
    queueId: number;
    tier: ChampionStatsTierFilter;
    position: ChampionMatchupsQuery['position'];
    emptyReason: ChampionMatchupsResponse['emptyReason'];
    displayFloor: number;
  }): ChampionMatchupsResponse {
    return ChampionMatchupsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: input.platform,
        patch: input.patch,
        queueId: input.queueId,
      },
      resolvedFilters: {
        platform: input.platform,
        patch: input.patch,
        queueId: input.queueId,
        tier: input.tier,
        position: input.position,
      },
      emptyReason: input.emptyReason,
      displayFloor: input.displayFloor,
      rankingPolicy: MATCHUP_RANKING_POLICY,
      totalEligiblePairs: 0,
      totalSourcePairs: 0,
      strongAgainst: [],
      weakAgainst: [],
    });
  }
}
