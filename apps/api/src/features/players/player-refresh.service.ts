import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccountIdentityConflictError,
  PlayerRefreshRequestSchema,
  RefreshCooldownError,
  RefreshInProgressError,
  ValidationFailureError,
  type PlayerRefreshRequest,
  type PlayerRefreshStatus,
} from '@league-helper/shared';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../config/player-refresh.config';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import type { GameDataProvider } from '@league-helper/shared';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';
import type { Redis } from 'ioredis';
import { requirePlayerAccount } from './player.errors';
import { PlayerCacheService } from './player-cache.service';
import { PlayerRefreshStatusService } from './player-refresh-status.service';
import { PlayerSearchService } from './player-search.service';
import { assertNoPuuidLeak } from './player-response.mapper';

@Injectable()
export class PlayerRefreshService {
  private readonly logger = new Logger(PlayerRefreshService.name);

  constructor(
    @Inject(GAME_DATA_PROVIDER) private readonly gameData: GameDataProvider,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Inject(PlayerSearchService) private readonly searchService: PlayerSearchService,
    @Inject(PlayerRefreshStatusService)
    private readonly refreshStatus: PlayerRefreshStatusService,
    @Inject(PlayerCacheService) private readonly cache: PlayerCacheService,
  ) {}

  async refresh(
    playerId: string,
    request: PlayerRefreshRequest,
    correlationId: string,
  ): Promise<PlayerRefreshStatus> {
    const parsed = PlayerRefreshRequestSchema.parse(request);
    if (parsed.force && process.env.NODE_ENV !== 'development') {
      throw new ValidationFailureError('force refresh is only allowed in development.');
    }

    const account = requirePlayerAccount(await this.playerAccounts.findAccountByPlayerId(playerId));
    const lockKey = this.lockKey(account.id);
    const cooldownKey = this.cooldownKey(account.id);

    if (!parsed.force) {
      await this.assertCooldown(cooldownKey);
    }

    const lockAcquired = await this.tryAcquireLock(lockKey);
    if (!lockAcquired) {
      throw new RefreshInProgressError();
    }

    try {
      await this.refreshStatus.recordRefreshStarted(account.id);

      const resolved = await this.gameData.resolvePlayer({
        gameName: account.currentGameName,
        tagLine: account.currentTagLine,
        platform: account.platformRoute as Parameters<
          GameDataProvider['resolvePlayer']
        >[0]['platform'],
      });

      if (resolved.externalAccountId !== account.externalAccountId) {
        throw new AccountIdentityConflictError(undefined, {
          playerId: account.playerId,
        });
      }

      const updated = await this.playerAccounts.upsertPlayerAccount({
        playerId: account.playerId,
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

      const matchCount = this.searchService.resolveMatchCount(parsed.matchCount);
      const queueId =
        parsed.queueId !== undefined ? parsed.queueId : this.config.defaultMatchQueueId;

      const response = await this.searchService.syncPlayerData({
        account: updated,
        providerAccount: resolved,
        matchCount,
        queueId,
        correlationId,
      });

      // Invalidate then cache authoritative stored profile (including existing matches).
      // Refresh HTTP response returns status only — never treat it as the match list.
      await this.cache.invalidate(playerId);
      await this.cache.setProfile(playerId, response);
      await this.refreshStatus.recordRefreshCompleted(account.id);

      if (!parsed.force) {
        await this.setCooldown(cooldownKey);
      }

      this.logger.log({
        message: 'Player refresh completed',
        correlationId,
        playerId,
        refreshState: response.refresh.state,
      });

      assertNoPuuidLeak(response.refresh);
      return response.refresh;
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private lockKey(accountId: string): string {
    return `player-refresh-lock:${accountId}`;
  }

  private cooldownKey(accountId: string): string {
    return `player-refresh-cooldown:${accountId}`;
  }

  private async tryAcquireLock(key: string): Promise<boolean> {
    try {
      const result = await this.redis.set(key, '1', 'EX', this.config.refreshLockTtlSeconds, 'NX');
      return result === 'OK';
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Refresh lock acquisition failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return false;
    }
  }

  private async releaseLock(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // fail-open
    }
  }

  private async assertCooldown(key: string): Promise<void> {
    try {
      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        throw new RefreshCooldownError(undefined, { retryAfterSeconds: ttl });
      }
    } catch (error: unknown) {
      if (error instanceof RefreshCooldownError) {
        throw error;
      }
      // Redis failure must not block refresh
    }
  }

  private async setCooldown(key: string): Promise<void> {
    try {
      await this.redis.set(key, '1', 'EX', this.config.cooldownSeconds);
    } catch {
      // fail-open
    }
  }
}
