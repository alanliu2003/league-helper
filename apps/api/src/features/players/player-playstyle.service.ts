import { Inject, Injectable } from '@nestjs/common';
import {
  buildPlayerPlaystyleContext,
  fingerprintPlayerPlaystyleContext,
} from '@league-helper/ai';
import {
  buildPlayerPlaystyleProfile,
  deriveChampionAggregateMetrics,
  toPlayerPlaystyleBaselineMetrics,
  type BaselineLookupResult,
  type PlayerPlaystyleMatchInput,
} from '@league-helper/match-analytics';
import {
  PLAYER_PLAYSTYLE_PROMPT_VERSION,
  PlatformRouteSchema,
  PlayerPlaystyleStoredInsightSchema,
  RANKED_SOLO_QUEUE_ID,
  RankTierSchema,
  getRegionalRouteForPlatform,
  type ChampionRankingPosition,
  type ChampionStatsTierFilter,
  type PlayerPlaystyleResponse,
  type RankTier,
} from '@league-helper/shared';
import type { ChampionAggregate } from '@prisma/client';
import {
  PLAYER_PLAYSTYLE_AI_CONFIG,
  type PlayerPlaystyleAiConfig,
} from '../../config/player-playstyle-ai.config';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { PlayerPlaystyleInsightRepository } from '../../persistence/player-playstyle-insight.repository';
import { PlayerPlaystyleInsightProducer } from '../../queues/player-playstyle-insight.producer';
import { toAccumulator } from '../champions/champion-stats.mapper';
import { requirePlayerAccount } from './player.errors';
import { assertNoPuuidLeak } from './player-response.mapper';
import { toPlaystyleResponse, toPublicPlaystyleInsight } from './player-playstyle.mapper';
import {
  PLAYSTYLE_WINDOW_LIMIT,
  summarizePlaystyleWindow,
  toPlayerPlaystyleMatchInput,
} from './player-playstyle-matches';

const RANKING_POSITIONS = new Set<ChampionRankingPosition>([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'SUPPORT',
]);

@Injectable()
export class PlayerPlaystyleService {
  constructor(
    @Inject(PLAYER_PLAYSTYLE_AI_CONFIG) private readonly aiConfig: PlayerPlaystyleAiConfig,
    @Inject(CHAMPION_STATS_CONFIG) private readonly statsConfig: ChampionStatsConfig,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Inject(MatchRepository) private readonly matches: MatchRepository,
    @Inject(ChampionAggregateReadRepository)
    private readonly aggregates: ChampionAggregateReadRepository,
    @Inject(ChampionStaticRepository) private readonly championStatic: ChampionStaticRepository,
    @Inject(PlayerPlaystyleInsightRepository)
    private readonly insights: PlayerPlaystyleInsightRepository,
    @Inject(PlayerPlaystyleInsightProducer)
    private readonly producer: PlayerPlaystyleInsightProducer,
  ) {}

  async getPlaystyle(playerId: string): Promise<PlayerPlaystyleResponse> {
    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));
    const rows = await this.matches.listPlaystyleWindow({
      playerAccountId: account.id,
      limit: PLAYSTYLE_WINDOW_LIMIT,
    });
    const summary = summarizePlaystyleWindow(rows);
    const championIds = [
      ...new Set(
        summary.analyzed
          .map((row) => row.participants[0]?.championId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const staticById = await this.championStatic.findByChampionIds(championIds);

    const matchInputs = summary.analyzed.map((row) =>
      toPlayerPlaystyleMatchInput(row, staticById),
    );
    const matchIdentity = matchInputs.map((match) => ({
      matchId: match.matchId,
      participantId: match.participantId,
    }));

    const baselinesByMatchId: Record<string, BaselineLookupResult> = {};
    for (const match of matchInputs) {
      baselinesByMatchId[match.matchId] = await this.lookupBaseline(match);
    }

    const profile = buildPlayerPlaystyleProfile({
      matches: matchInputs,
      baselinesByMatchId,
      skipped: summary.skipped,
    });

    if (!this.aiConfig.enabled) {
      return this.finish({
        profile,
        ai: { status: 'DISABLED', emptyReason: 'AI_DISABLED', insight: null },
      });
    }

    const context = buildPlayerPlaystyleContext({
      profile,
      matchIdentity,
      queueId: RANKED_SOLO_QUEUE_ID,
    });

    if (!context.generationEligible) {
      return this.finish({
        profile,
        ai: { status: 'LOW_CONFIDENCE', emptyReason: 'INSUFFICIENT_SAMPLE', insight: null },
      });
    }

    const contextFingerprint = fingerprintPlayerPlaystyleContext({
      context,
      promptVersion: PLAYER_PLAYSTYLE_PROMPT_VERSION,
      model: this.aiConfig.model,
      provider: this.aiConfig.provider,
    });

    const existing = await this.insights.findByScopeFingerprint({
      playerAccountId: account.id,
      queueId: RANKED_SOLO_QUEUE_ID,
      contextFingerprint,
    });

    const now = Date.now();

    if (existing?.status === 'READY') {
      const parsed = PlayerPlaystyleStoredInsightSchema.safeParse(existing.structuredResult);
      const generatedAt = existing.generatedAt ?? existing.updatedAt;
      if (parsed.success) {
        return this.finish({
          profile,
          ai: {
            status: 'AVAILABLE',
            insight: toPublicPlaystyleInsight(parsed.data, generatedAt),
          },
        });
      }
    }

    if (
      existing?.status === 'PENDING' &&
      now - existing.updatedAt.getTime() <= this.aiConfig.stalePendingMs
    ) {
      return this.finish({
        profile,
        ai: { status: 'PENDING', insight: null },
      });
    }

    if (
      existing?.status === 'FAILED' &&
      now - existing.updatedAt.getTime() <= this.aiConfig.failedRetryMs
    ) {
      return this.finish({
        profile,
        ai: { status: 'UNAVAILABLE', emptyReason: 'GENERATION_FAILED', insight: null },
      });
    }

    const pending = await this.insights.upsertPending({
      playerAccountId: account.id,
      queueId: RANKED_SOLO_QUEUE_ID,
      contextFingerprint,
      promptVersion: PLAYER_PLAYSTYLE_PROMPT_VERSION,
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
      return this.finish({
        profile,
        ai: { status: 'UNAVAILABLE', emptyReason: 'QUEUE_UNAVAILABLE', insight: null },
      });
    }

    return this.finish({
      profile,
      ai: { status: 'PENDING', insight: null },
    });
  }

  private finish(input: Parameters<typeof toPlaystyleResponse>[0]): PlayerPlaystyleResponse {
    const response = toPlaystyleResponse(input);
    assertNoPuuidLeak(response);
    return response;
  }

  private async lookupBaseline(match: PlayerPlaystyleMatchInput): Promise<BaselineLookupResult> {
    if (!RANKING_POSITIONS.has(match.position as ChampionRankingPosition)) {
      return null;
    }

    const platformParsed = PlatformRouteSchema.safeParse(match.platformRoute);
    if (!platformParsed.success) {
      return null;
    }
    const platform = platformParsed.data;
    const regionalRoute = getRegionalRouteForPlatform(platform);

    const versions = {
      sourceNormalizationVersion: this.statsConfig.sourceNormalizationVersion,
      aggregationVersion: this.statsConfig.aggregationVersion,
    };
    const position = match.position as ChampionRankingPosition;

    const load = async (tier: ChampionStatsTierFilter): Promise<ChampionAggregate | null> => {
      if (tier === 'UNKNOWN') {
        return null;
      }
      return this.aggregates.findExactAggregate({
        championId: match.championId,
        scope: {
          platform,
          regionalRoute,
          queueId: RANKED_SOLO_QUEUE_ID,
          patch: match.patch,
          tier,
          position,
          minimumSample: 1,
          ...versions,
        },
      });
    };

    const toResult = (
      row: ChampionAggregate,
      rankTier: ChampionStatsTierFilter,
      usedAllTierFallback: boolean,
    ): Exclude<BaselineLookupResult, null> => {
      const metrics = toPlayerPlaystyleBaselineMetrics(
        deriveChampionAggregateMetrics(toAccumulator(row), {
          confidenceLevel: this.statsConfig.confidenceLevel,
        }),
      );
      return { metrics, rankTier, usedAllTierFallback };
    };

    const exactTier = resolveExactRankTier(match);
    if (exactTier) {
      const exact = await load(exactTier);
      if (exact) {
        const result = toResult(exact, exactTier, false);
        if (result.metrics.sampleConfidence !== 'INSUFFICIENT') {
          return result;
        }
      }
    }

    const all = await load('ALL');
    if (!all) {
      return null;
    }
    return toResult(all, 'ALL', true);
  }
}

function resolveExactRankTier(match: PlayerPlaystyleMatchInput): RankTier | null {
  if (match.rankResolutionStatus !== 'RESOLVED_RANKED') {
    return null;
  }
  const parsed = RankTierSchema.safeParse(match.rankTier?.trim().toUpperCase());
  return parsed.success ? parsed.data : null;
}
