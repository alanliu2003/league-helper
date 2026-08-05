import { Inject, Injectable, Logger } from '@nestjs/common';
import { IngestionJobStatus, type Match, type PlayerAccount } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_NORMALIZATION_VERSION,
  PlayerSearchRequestSchema,
  type GameDataProvider,
  type PlayerAccount as ProviderPlayerAccount,
  type MatchIngestionJobPayload,
  type PlayerSafeWarning,
  type PlayerSearchRequest,
  type PlayerSearchResponse,
  buildMatchIngestionIdempotencyKey,
} from '@league-helper/shared';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../config/player-refresh.config';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import { IngestionJobRepository } from '../../persistence/ingestion-job.repository';
import { MasterySnapshotRepository } from '../../persistence/mastery-snapshot.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { RankSnapshotRepository } from '../../persistence/rank-snapshot.repository';
import { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import { providerFailureToWarning } from './player.errors';
import { PlayerCacheService } from './player-cache.service';
import { PlayerRefreshStatusService } from './player-refresh-status.service';
import {
  assertNoPuuidLeak,
  mapPublicMastery,
  mapPublicMatch,
  mapPublicPlayer,
  mapPublicRank,
} from './player-response.mapper';

export type SyncPlayerDataInput = {
  account: PlayerAccount;
  providerAccount: ProviderPlayerAccount;
  matchCount: number;
  queueId: number;
  correlationId: string;
};

@Injectable()
export class PlayerSearchService {
  private readonly logger = new Logger(PlayerSearchService.name);

  constructor(
    @Inject(GAME_DATA_PROVIDER) private readonly gameData: GameDataProvider,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Inject(RankSnapshotRepository) private readonly rankSnapshots: RankSnapshotRepository,
    @Inject(MasterySnapshotRepository)
    private readonly masterySnapshots: MasterySnapshotRepository,
    @Inject(MatchRepository) private readonly matches: MatchRepository,
    @Inject(IngestionJobRepository) private readonly ingestionJobs: IngestionJobRepository,
    @Inject(MatchIngestionProducer) private readonly producer: MatchIngestionProducer,
    @Inject(PlayerRefreshStatusService)
    private readonly refreshStatus: PlayerRefreshStatusService,
    @Inject(PlayerCacheService) private readonly cache: PlayerCacheService,
  ) {}

  async search(request: PlayerSearchRequest, correlationId: string): Promise<PlayerSearchResponse> {
    const parsed = PlayerSearchRequestSchema.parse(request);
    const matchCount = this.resolveMatchCount(parsed.matchCount);

    const resolved = await this.gameData.resolvePlayer({
      gameName: parsed.gameName,
      tagLine: parsed.tagLine,
      platform: parsed.platform,
    });

    const account = await this.playerAccounts.upsertPlayerAccount({
      provider: resolved.provider,
      externalAccountId: resolved.externalAccountId,
      platformRoute: resolved.platform,
      regionalRoute: resolved.regionalRoute,
      gameName: resolved.riotId.gameName,
      tagLine: resolved.riotId.tagLine,
      summonerId: resolved.summonerId ?? null,
      accountId: resolved.accountId ?? null,
      profileIconId: resolved.profileIconId ?? null,
      summonerLevel: resolved.summonerLevel ?? null,
      lastResolvedAt: new Date(),
    });

    this.logger.log({
      message: 'Player search resolved',
      correlationId,
      playerId: account.playerId,
      platform: account.platformRoute,
    });

    const response = await this.syncPlayerData({
      account,
      providerAccount: resolved,
      matchCount,
      queueId: this.config.defaultQueueId,
      correlationId,
    });

    await this.cache.setProfile(account.playerId, response);
    assertNoPuuidLeak(response);
    return response;
  }

  async syncPlayerData(input: SyncPlayerDataInput): Promise<PlayerSearchResponse> {
    const warnings: PlayerSafeWarning[] = [];
    const { account, providerAccount, matchCount, queueId, correlationId } = input;

    const [ranksSettled, masterySettled, matchIdsSettled] = await Promise.allSettled([
      this.gameData.getRankedEntries(providerAccount),
      this.gameData.getChampionMastery(providerAccount),
      this.gameData.getRecentMatchIds(providerAccount, { queue: queueId, count: matchCount }),
    ]);

    if (ranksSettled.status === 'rejected') {
      warnings.push(providerFailureToWarning(ranksSettled.reason));
    }
    if (masterySettled.status === 'rejected') {
      warnings.push(providerFailureToWarning(masterySettled.reason));
    }
    if (matchIdsSettled.status === 'rejected') {
      warnings.push(providerFailureToWarning(matchIdsSettled.reason));
    }

    if (ranksSettled.status === 'fulfilled') {
      for (const entry of ranksSettled.value) {
        await this.rankSnapshots.insertIfChanged({
          playerAccountId: account.id,
          queueType: entry.queueType,
          tier: entry.tier,
          division: entry.division,
          leaguePoints: entry.leaguePoints,
          wins: entry.wins,
          losses: entry.losses,
          veteran: entry.veteran,
          inactive: entry.inactive,
          freshBlood: entry.freshBlood,
          hotStreak: entry.hotStreak,
        });
      }
    }

    if (masterySettled.status === 'fulfilled') {
      for (const mastery of masterySettled.value) {
        await this.masterySnapshots.insertIfChanged(
          {
            playerAccountId: account.id,
            championId: mastery.championId,
            championLevel: mastery.championLevel,
            championPoints: mastery.championPoints,
            lastPlayTime: mastery.lastPlayTime ? new Date(mastery.lastPlayTime) : null,
            chestGranted: mastery.chestGranted ?? null,
            tokensEarned: mastery.tokensEarned ?? null,
          },
          this.config.masterySnapshotMinAgeSeconds,
        );
      }
    }

    const discoveredMatchIds = matchIdsSettled.status === 'fulfilled' ? matchIdsSettled.value : [];

    const enqueueWarnings = await this.enqueueDiscoveredMatches({
      account,
      discoveredMatchIds,
      correlationId,
    });
    warnings.push(...enqueueWarnings);

    await this.refreshStatus.recordDiscoveredMatches(account.id, discoveredMatchIds, matchCount);

    const [rankRows, masteryRows, matchRows, refresh] = await Promise.all([
      this.rankSnapshots.getLatestForPlayer(account.id),
      this.masterySnapshots.getTopCurrentMasteryForPlayer(account.id, this.config.masteryLimit),
      this.listStoredMatches(account.id, discoveredMatchIds),
      this.refreshStatus.compute({
        account,
        discoveredMatchIds,
        requestedMatchCount: matchCount,
        warnings,
      }),
    ]);

    const response: PlayerSearchResponse = {
      player: mapPublicPlayer(account),
      ranks: rankRows.map(mapPublicRank),
      mastery: masteryRows.map(mapPublicMastery),
      matches: matchRows.map(mapPublicMatch),
      refresh,
    };

    this.logger.log({
      message: 'Player data synchronized',
      correlationId,
      playerId: account.playerId,
      discoveredMatchCount: discoveredMatchIds.length,
      refreshState: refresh.state,
      warningCount: warnings.length,
    });

    return response;
  }

  resolveMatchCount(requested: number | undefined): number {
    const raw = requested ?? this.config.defaultMatchCount;
    return Math.min(Math.max(1, raw), this.config.maxMatchCount);
  }

  private async enqueueDiscoveredMatches(input: {
    account: PlayerAccount;
    discoveredMatchIds: string[];
    correlationId: string;
  }): Promise<PlayerSafeWarning[]> {
    const warnings: PlayerSafeWarning[] = [];
    const { account, discoveredMatchIds, correlationId } = input;
    if (discoveredMatchIds.length === 0) {
      return warnings;
    }

    const existingMatches = await this.matches.findExistingByExternalIds(
      account.provider,
      discoveredMatchIds,
    );
    const knownIds = new Set(existingMatches.map((match) => match.externalMatchId));
    const candidateIds = discoveredMatchIds.filter((id) => !knownIds.has(id));

    const durableJobs = await this.ingestionJobs.findByExternalResourceIds(
      MATCH_INGESTION_JOB_NAME,
      account.provider,
      candidateIds,
    );
    const jobByMatchId = new Map(durableJobs.map((job) => [job.externalResourceId ?? '', job]));

    const missingIds = candidateIds.filter((id) => !jobByMatchId.has(id));
    const discoveredAt = new Date().toISOString();

    for (const externalMatchId of missingIds) {
      const payload: MatchIngestionJobPayload = {
        provider: 'RIOT',
        externalMatchId,
        regionalRoute: account.regionalRoute as MatchIngestionJobPayload['regionalRoute'],
        requestedByPlayerAccountId: account.id,
        correlationId,
        normalizationVersion: MATCH_INGESTION_NORMALIZATION_VERSION,
        discoveredAt,
      };

      const idempotencyKey = buildMatchIngestionIdempotencyKey({
        provider: payload.provider,
        regionalRoute: payload.regionalRoute,
        externalMatchId: payload.externalMatchId,
        normalizationVersion: payload.normalizationVersion,
      });

      const { job } = await this.ingestionJobs.createIdempotent({
        jobType: MATCH_INGESTION_JOB_NAME,
        idempotencyKey,
        provider: account.provider,
        externalResourceId: externalMatchId,
        status: IngestionJobStatus.PENDING,
        metadata: payload,
        maxAttempts: this.config.matchIngestionJobAttempts,
      });

      const result = await this.producer.enqueueMatch(payload);
      if (result.published) {
        await this.ingestionJobs.updateStatus(job.id, IngestionJobStatus.QUEUED, {
          scheduledAt: new Date(),
        });
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    return warnings;
  }

  private async listStoredMatches(
    playerAccountId: string,
    discoveredMatchIds: string[],
  ): Promise<
    Array<
      Match & {
        participants: Array<{
          championId: number;
          win: boolean;
          kills: number;
          deaths: number;
          assists: number;
        }>;
      }
    >
  > {
    if (discoveredMatchIds.length === 0) {
      return [];
    }

    const rows = await this.matches.listForPlayerAccount({
      playerAccountId,
      limit: discoveredMatchIds.length,
    });

    const order = new Map(discoveredMatchIds.map((id, index) => [id, index]));
    return rows
      .filter((row) => order.has(row.externalMatchId))
      .sort(
        (a, b) =>
          (order.get(a.externalMatchId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.externalMatchId) ?? Number.MAX_SAFE_INTEGER),
      );
  }
}
