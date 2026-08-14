import { Inject, Injectable } from '@nestjs/common';
import { buildChampionInsightContext, fingerprintChampionInsightContext } from '@league-helper/ai';
import {
  CHAMPION_AI_PROMPT_VERSION,
  ChampionAiStoredInsightSchema,
  ChampionNotFoundError,
  legacyTierFilterToRankScope,
  type ChampionAbilitySummary,
  type ChampionAiInsightsQuery,
  type ChampionAiInsightsResponse,
  type ChampionMatchupsResponse,
  type ChampionStatsResolvedFilters,
  type ChampionStatsTierFilter,
  type PlatformRoute,
  type SampleScope,
} from '@league-helper/shared';
import { CHAMPION_AI_CONFIG, type ChampionAiConfig } from '../../config/champion-ai.config';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { ChampionAiInsightRepository } from '../../persistence/champion-ai-insight.repository';
import { ChampionAiInsightProducer } from '../../queues/champion-ai-insight.producer';
import { resolveSharedFilters } from './champion-stats-filters';
import { ChampionBuildsService } from './champion-builds.service';
import { ChampionMatchupsService } from './champion-matchups.service';
import { ChampionStaticService } from './champion-static.service';
import { ChampionStatsService } from './champion-stats.service';
import { toInsightsResponse, toPublicInsight } from './champion-insights.mapper';

@Injectable()
export class ChampionInsightsService {
  constructor(
    @Inject(CHAMPION_AI_CONFIG) private readonly aiConfig: ChampionAiConfig,
    @Inject(CHAMPION_STATS_CONFIG) private readonly statsConfig: ChampionStatsConfig,
    @Inject(ChampionStaticService) private readonly staticService: ChampionStaticService,
    @Inject(ChampionStatsService) private readonly statsService: ChampionStatsService,
    @Inject(ChampionBuildsService) private readonly buildsService: ChampionBuildsService,
    @Inject(ChampionMatchupsService) private readonly matchupsService: ChampionMatchupsService,
    @Inject(ChampionAiInsightRepository)
    private readonly insights: ChampionAiInsightRepository,
    @Inject(ChampionAiInsightProducer) private readonly producer: ChampionAiInsightProducer,
  ) {}

  async getInsights(
    championKey: string,
    query: ChampionAiInsightsQuery,
  ): Promise<ChampionAiInsightsResponse> {
    if (!this.aiConfig.enabled) {
      return this.shortCircuit(query, 'DISABLED', 'AI_DISABLED');
    }

    const staticRow = await this.staticService.requireByKey(championKey);
    const shared = resolveSharedFilters(this.statsConfig, query);
    const rankScope = legacyTierFilterToRankScope(shared.tier);

    if (rankScope.kind === 'UNKNOWN') {
      return this.shortCircuit(query, 'UNAVAILABLE', 'UNKNOWN_RANK_HIDDEN');
    }

    const [statsResponse, buildsResponse, matchupsResponse, detail] = await Promise.all([
      this.statsService.getChampionStats(championKey, query),
      this.buildsService.getBuilds(championKey, query),
      this.matchupsService.getMatchups(championKey, { ...query }),
      this.staticService.getByKey(championKey),
    ]);

    const opponentAbilities = await this.loadOpponentAbilities(matchupsResponse);
    const sampleScope = buildsResponse.sampleScope;
    const resolvedFilters = buildsResponse.resolvedFilters;

    const context = buildChampionInsightContext({
      champion: {
        championId: staticRow.championId,
        championKey: staticRow.championKey,
        name: staticRow.name,
        position: query.position,
      },
      scope: {
        patch: resolvedFilters.patch,
        platform: resolvedFilters.platform,
        queueId: resolvedFilters.queueId,
        tier: resolvedFilters.tier,
        kind: 'COLLECTED_SAMPLE',
      },
      stats: statsResponse.stats,
      builds: {
        coreBuilds: buildsResponse.coreBuilds,
        startingItems: buildsResponse.startingItems,
        boots: buildsResponse.boots,
        runes: buildsResponse.runes,
        summonerSpells: buildsResponse.summonerSpells,
        skillOrder: buildsResponse.skillOrder,
      },
      matchups: {
        strongAgainst: matchupsResponse.strongAgainst,
        weakAgainst: matchupsResponse.weakAgainst,
      },
      abilities: detail.champion.abilities ?? [],
      opponentAbilities,
    });

    if (!context.generationEligible) {
      return toInsightsResponse({
        status: 'LOW_CONFIDENCE',
        emptyReason: 'INSUFFICIENT_EVIDENCE',
        insight: null,
        sampleScope,
        resolvedFilters,
      });
    }

    const contextFingerprint = fingerprintChampionInsightContext({
      context,
      promptVersion: CHAMPION_AI_PROMPT_VERSION,
      model: this.aiConfig.model,
      provider: this.aiConfig.provider,
    });

    const existing = await this.insights.findByScopeFingerprint({
      championId: staticRow.championId,
      patch: resolvedFilters.patch,
      platformRoute: resolvedFilters.platform,
      queueId: resolvedFilters.queueId,
      rankTier: resolvedFilters.tier,
      teamPosition: query.position,
      contextFingerprint,
    });

    const now = Date.now();

    if (existing?.status === 'READY') {
      const parsed = ChampionAiStoredInsightSchema.safeParse(existing.structuredResult);
      const generatedAt = existing.generatedAt ?? existing.updatedAt;
      if (parsed.success) {
        return toInsightsResponse({
          status: 'AVAILABLE',
          insight: toPublicInsight(parsed.data, generatedAt),
          sampleScope,
          resolvedFilters,
        });
      }
    }

    if (
      existing?.status === 'PENDING' &&
      now - existing.updatedAt.getTime() <= this.aiConfig.stalePendingMs
    ) {
      return toInsightsResponse({
        status: 'PENDING',
        insight: null,
        sampleScope,
        resolvedFilters,
      });
    }

    if (
      existing?.status === 'FAILED' &&
      now - existing.updatedAt.getTime() <= this.aiConfig.failedRetryMs
    ) {
      return toInsightsResponse({
        status: 'UNAVAILABLE',
        emptyReason: 'GENERATION_FAILED',
        insight: null,
        sampleScope,
        resolvedFilters,
      });
    }

    const pending = await this.insights.upsertPending({
      championId: staticRow.championId,
      championKey: staticRow.championKey,
      patch: resolvedFilters.patch,
      platformRoute: resolvedFilters.platform,
      queueId: resolvedFilters.queueId,
      rankTier: resolvedFilters.tier,
      teamPosition: query.position,
      contextFingerprint,
      promptVersion: CHAMPION_AI_PROMPT_VERSION,
      provider: this.aiConfig.provider,
      model: this.aiConfig.model,
      inputContext: JSON.parse(JSON.stringify(context)),
    });

    const enqueue = await this.producer.enqueueInsight({
      insightId: pending.id,
      contextFingerprint,
    });

    if (!enqueue.published) {
      await this.insights.markFailed(pending.id, 'QUEUE_UNAVAILABLE');
      return toInsightsResponse({
        status: 'UNAVAILABLE',
        emptyReason: 'QUEUE_UNAVAILABLE',
        insight: null,
        sampleScope,
        resolvedFilters,
      });
    }

    return toInsightsResponse({
      status: 'PENDING',
      insight: null,
      sampleScope,
      resolvedFilters,
    });
  }

  private shortCircuit(
    query: ChampionAiInsightsQuery,
    status: 'DISABLED' | 'UNAVAILABLE',
    emptyReason: 'AI_DISABLED' | 'UNKNOWN_RANK_HIDDEN',
  ): ChampionAiInsightsResponse {
    const shared = resolveSharedFilters(this.statsConfig, query);
    const { sampleScope, resolvedFilters } = this.filtersFromShared(query, shared);
    return toInsightsResponse({
      status,
      emptyReason,
      insight: null,
      sampleScope,
      resolvedFilters,
    });
  }

  private filtersFromShared(
    query: ChampionAiInsightsQuery,
    shared: {
      platform: PlatformRoute;
      queueId: number;
      tier: ChampionStatsTierFilter;
    },
  ): { sampleScope: SampleScope; resolvedFilters: ChampionStatsResolvedFilters } {
    const patch = query.patch?.trim() || 'unavailable';
    return {
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
    };
  }

  private async loadOpponentAbilities(
    matchups: Pick<ChampionMatchupsResponse, 'strongAgainst' | 'weakAgainst'>,
  ): Promise<Array<{ championKey: string; abilities: ChampionAbilitySummary[] }>> {
    const keys = [
      ...new Set(
        [
          ...matchups.strongAgainst.slice(0, 3),
          ...matchups.weakAgainst.slice(0, 3),
        ].map((row) => row.opponent.championKey),
      ),
    ];

    const groups = await Promise.all(
      keys.map(async (key) => {
        try {
          const detail = await this.staticService.getByKey(key);
          return {
            championKey: detail.champion.championKey,
            abilities: detail.champion.abilities ?? [],
          };
        } catch (error: unknown) {
          if (error instanceof ChampionNotFoundError) {
            return null;
          }
          throw error;
        }
      }),
    );

    return groups.filter((group) => group !== null);
  }
}
