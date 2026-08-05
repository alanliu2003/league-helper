import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PlayerMasteryQuerySchema,
  PlayerMatchesQuerySchema,
  PlayerRanksQuerySchema,
  resolveMatchQueueCategoryFilter,
  type PlayerMasteryQuery,
  type PlayerMatchesQuery,
  type PlayerProfileResponse,
  type PlayerRanksQuery,
  type PlayerRefreshStatus,
  type PublicMasterySummary,
  type PublicMatchSummary,
  type PublicPlayer,
} from '@league-helper/shared';
import type { ChampionMasterySnapshot, PlayerAccount } from '@prisma/client';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../config/player-refresh.config';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { MasterySnapshotRepository } from '../../persistence/mastery-snapshot.repository';
import { MatchRepository, type PlayerMatchListRow } from '../../persistence/match.repository';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { RankSnapshotRepository } from '../../persistence/rank-snapshot.repository';
import { decodeCursor, encodeCursor } from './player-cursor.utils';
import { requirePlayerAccount } from './player.errors';
import { PlayerCacheService } from './player-cache.service';
import { PlayerRefreshStatusService } from './player-refresh-status.service';
import {
  assertNoPuuidLeak,
  mapPublicMastery,
  mapPublicMatch,
  mapPublicPlayer,
  mapPublicRank,
} from './player-response.mapper';

@Injectable()
export class PlayerProfileService {
  private readonly logger = new Logger(PlayerProfileService.name);

  constructor(
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Inject(RankSnapshotRepository) private readonly rankSnapshots: RankSnapshotRepository,
    @Inject(MasterySnapshotRepository)
    private readonly masterySnapshots: MasterySnapshotRepository,
    @Inject(MatchRepository) private readonly matches: MatchRepository,
    @Inject(PlayerCacheService) private readonly cache: PlayerCacheService,
    @Inject(PlayerRefreshStatusService)
    private readonly refreshStatus: PlayerRefreshStatusService,
    @Inject(DataDragonChampionService) private readonly dataDragon: DataDragonChampionService,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
  ) {}

  async getProfile(playerId: string): Promise<PlayerProfileResponse> {
    const cached = await this.cache.getProfile(playerId);
    if (cached) {
      assertNoPuuidLeak(cached);
      return cached;
    }

    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));

    const [ranks, mastery, matchRows, refresh] = await Promise.all([
      this.rankSnapshots.getLatestForPlayer(account.id),
      this.masterySnapshots.getTopCurrentMasteryForPlayer(account.id, this.config.masteryLimit),
      this.matches.listForPlayerAccount({
        playerAccountId: account.id,
        limit: this.config.defaultMatchCount,
        includeRemakes: true,
      }),
      this.refreshStatus.compute({
        account,
        discoveredMatchIds: [],
        requestedMatchCount: this.config.defaultMatchCount,
      }),
    ]);

    const response: PlayerProfileResponse = {
      player: await this.mapPlayerWithProfileIcon(account),
      ranks: ranks.map(mapPublicRank),
      mastery: await this.mapMasteryWithChampions(mastery),
      matches: await this.mapMatchesWithChampions(matchRows),
      refresh,
    };

    await this.cache.setProfile(playerId, response);
    assertNoPuuidLeak(response);
    return response;
  }

  async getRanks(playerId: string, query: PlayerRanksQuery) {
    const parsed = PlayerRanksQuerySchema.parse(query);
    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));

    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
    const rows = await this.rankSnapshots.listHistory({
      playerAccountId: account.id,
      queueType: parsed.queueType,
      limit: parsed.limit + 1,
      cursorCapturedAt: cursor?.capturedAt,
      cursorId: cursor?.id,
    });

    const hasMore = rows.length > parsed.limit;
    const items = rows.slice(0, parsed.limit).map(mapPublicRank);
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(new Date(last.capturedAt), last.id) : null,
    };
  }

  async getMastery(playerId: string, query: PlayerMasteryQuery) {
    const parsed = PlayerMasteryQuerySchema.parse(query);
    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));

    if (parsed.latestOnly && !parsed.cursor) {
      const rows = parsed.championId
        ? await this.masterySnapshots
            .getLatestForChampion(account.id, parsed.championId)
            .then((row) => (row ? [row] : []))
        : await this.masterySnapshots.getTopCurrentMasteryForPlayer(account.id, parsed.limit);

      const items = await this.mapMasteryWithChampions(rows);
      return { items, nextCursor: null };
    }

    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
    const rows = await this.masterySnapshots.listHistory({
      playerAccountId: account.id,
      championId: parsed.championId,
      limit: parsed.limit + 1,
      cursorCapturedAt: cursor?.capturedAt,
      cursorId: cursor?.id,
    });

    const hasMore = rows.length > parsed.limit;
    const items = await this.mapMasteryWithChampions(rows.slice(0, parsed.limit));
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(new Date(last.capturedAt), last.id) : null,
    };
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

  /** Enrich match rows with champion/item icons; never throws; never calls Riot. */
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

  async getMatches(playerId: string, query: PlayerMatchesQuery) {
    const parsed = PlayerMatchesQuerySchema.parse(query);
    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));

    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
    const categoryFilter =
      parsed.queueId === undefined ? resolveMatchQueueCategoryFilter(parsed.queueCategory) : {};
    const rows = await this.matches.listForPlayerAccount({
      playerAccountId: account.id,
      limit: parsed.limit + 1,
      cursorGameCreation: cursor?.capturedAt,
      cursorId: cursor?.id,
      queueId: parsed.queueId,
      queueIds: categoryFilter.queueIds,
      excludeQueueIds: categoryFilter.excludeQueueIds,
      championId: parsed.championId,
      result: parsed.result,
      includeRemakes: parsed.includeRemakes,
    });

    const hasMore = rows.length > parsed.limit;
    const items = await this.mapMatchesWithChampions(rows.slice(0, parsed.limit));
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(new Date(last.gameCreation), last.id) : null,
    };
  }

  async getRefreshStatus(playerId: string): Promise<PlayerRefreshStatus> {
    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));
    return this.refreshStatus.compute({
      account,
      discoveredMatchIds: [],
      requestedMatchCount: this.config.defaultMatchCount,
    });
  }
}
