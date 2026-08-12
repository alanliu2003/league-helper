import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type ChampionMasterySnapshot, type PlayerAccount } from '@prisma/client';
import { withRiotWorkload } from '@league-helper/server-riot';
import {
  PlayerSearchRequestSchema,
  type GameDataProvider,
  type PlayerAccount as ProviderPlayerAccount,
  type PlayerSafeWarning,
  type PlayerSearchRequest,
  type PlayerSearchResponse,
  type PublicMasterySummary,
  type PublicMatchSummary,
  type PublicPlayer,
} from '@league-helper/shared';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../config/player-refresh.config';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import { IngestionJobRepository } from '../../persistence/ingestion-job.repository';
import { MasterySnapshotRepository } from '../../persistence/mastery-snapshot.repository';
import { MatchRepository, type PlayerMatchListRow } from '../../persistence/match.repository';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { RankSnapshotRepository } from '../../persistence/rank-snapshot.repository';
import { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import { maybeEnrollFromSearch } from '../collector/collector-enrollment.hooks';
import {
  COLLECTOR_CONFIG,
  CollectorEnrollmentService,
} from '../collector/collector-enrollment.service';
import type { CollectorConfig } from '../collector/collector.config';
import { enqueueDiscoveredMatches } from './bootstrap/enqueue-discovered-matches';
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
  /** Riot queue filter; null/undefined omits queue (all recent queues). */
  queueId?: number | null;
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
    @Inject(DataDragonChampionService) private readonly dataDragon: DataDragonChampionService,
    @Optional()
    @Inject(COLLECTOR_CONFIG)
    private readonly collectorConfig?: CollectorConfig,
    @Optional()
    @Inject(CollectorEnrollmentService)
    private readonly collectorEnrollment?: CollectorEnrollmentService,
  ) {}

  async search(request: PlayerSearchRequest, correlationId: string): Promise<PlayerSearchResponse> {
    return withRiotWorkload('product', async () => {
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

    // Flag-gated: short-circuit before any enrollment when disabled / unavailable.
    if (this.collectorConfig?.enrollFromSearch === true && this.collectorEnrollment) {
      await maybeEnrollFromSearch({
        enabled: true,
        enroll: (input) => this.collectorEnrollment!.enroll(input),
        account: {
          id: account.id,
          provider: account.provider,
          platformRoute: account.platformRoute,
        },
        warn: (message) => this.logger.warn(message),
      });
    }

    const response = await this.syncPlayerData({
      account,
      providerAccount: resolved,
      matchCount,
      queueId: parsed.queueId !== undefined ? parsed.queueId : this.config.defaultMatchQueueId,
      correlationId,
    });

    await this.cache.setProfile(account.playerId, response);
    assertNoPuuidLeak(response);
    return response;
    });
  }

  async syncPlayerData(input: SyncPlayerDataInput): Promise<PlayerSearchResponse> {
    const warnings: PlayerSafeWarning[] = [];
    const { account, providerAccount, matchCount, queueId, correlationId } = input;

    const matchIdOptions: { count: number; queue?: number } = { count: matchCount };
    if (queueId != null) {
      matchIdOptions.queue = queueId;
    }

    const [ranksSettled, masterySettled, matchIdsSettled] = await Promise.allSettled([
      this.gameData.getRankedEntries(providerAccount),
      this.gameData.getChampionMastery(providerAccount),
      this.gameData.getRecentMatchIds(providerAccount, matchIdOptions),
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

    const enqueueResult = await enqueueDiscoveredMatches(
      {
        matches: this.matches,
        ingestionJobs: this.ingestionJobs,
        producer: this.producer,
        matchIngestionJobAttempts: this.config.matchIngestionJobAttempts,
        logger: this.logger,
        invalidatePlayerCache: (playerId) => this.cache.invalidate(playerId),
      },
      {
        account,
        discoveredMatchIds,
        correlationId,
      },
    );
    warnings.push(...enqueueResult.warnings);

    await this.refreshStatus.recordDiscoveredMatches(account.id, discoveredMatchIds, matchCount);

    const [rankRows, masteryRows, matchRows, refresh] = await Promise.all([
      this.rankSnapshots.getLatestForPlayer(account.id),
      this.masterySnapshots.getTopCurrentMasteryForPlayer(account.id, this.config.masteryLimit),
      // Always return authoritative stored matches — never erase history because
      // discovery is empty or newly queued IDs are not ingested yet.
      this.listStoredMatches(account.id, matchCount),
      this.refreshStatus.compute({
        account,
        discoveredMatchIds,
        requestedMatchCount: matchCount,
        warnings,
      }),
    ]);

    const response: PlayerSearchResponse = {
      player: await this.mapPlayerWithProfileIcon(account),
      ranks: rankRows.map(mapPublicRank),
      mastery: await this.mapMasteryWithChampions(masteryRows),
      matches: await this.mapMatchesWithChampions(matchRows),
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

  /** Enrich player with Data Dragon profile icon URL; never throws. */
  private async mapPlayerWithProfileIcon(account: PlayerAccount): Promise<PublicPlayer> {
    try {
      const version = await this.dataDragon.getCurrentVersion();
      const profileIconUrl =
        account.profileIconId != null && version
          ? this.dataDragon.buildProfileIconUrl(account.profileIconId, version)
          : null;
      return mapPublicPlayer(account, { profileIconUrl });
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon profile icon enrichment failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return mapPublicPlayer(account, { profileIconUrl: null });
    }
  }

  /** Enrich mastery rows with Data Dragon metadata; never throws. */
  private async mapMasteryWithChampions(
    rows: ChampionMasterySnapshot[],
  ): Promise<PublicMasterySummary[]> {
    try {
      const champions = await this.dataDragon.getAllChampions();
      const byNumericId = new Map(champions.map((c) => [Number(c.key), c]));
      return rows.map((row) => mapPublicMastery(row, byNumericId.get(row.championId) ?? null));
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon mastery enrichment failed; using numeric fallback',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return rows.map((row) => mapPublicMastery(row, null));
    }
  }

  /** Enrich match rows with champion/item icons; never throws. */
  private async mapMatchesWithChampions(rows: PlayerMatchListRow[]): Promise<PublicMatchSummary[]> {
    try {
      const [champions, version] = await Promise.all([
        this.dataDragon.getAllChampions(),
        this.dataDragon.getCurrentVersion(),
      ]);
      const byNumericId = new Map(champions.map((c) => [Number(c.key), c]));
      const baseUrl = this.dataDragon.getBaseUrl();
      return rows.map((row) => {
        const championId = row.participants[0]?.championId;
        return mapPublicMatch(row, {
          champion: championId !== undefined ? (byNumericId.get(championId) ?? null) : null,
          dataDragonVersion: version,
          dataDragonBaseUrl: baseUrl,
        });
      });
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon match enrichment failed; using numeric fallback',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return rows.map((row) => mapPublicMatch(row));
    }
  }

  private async listStoredMatches(
    playerAccountId: string,
    limit: number,
  ): Promise<PlayerMatchListRow[]> {
    return this.matches.listForPlayerAccount({
      playerAccountId,
      limit,
      includeRemakes: true,
    });
  }
}
