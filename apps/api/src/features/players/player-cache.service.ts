import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PlayerProfileResponseSchema, type PlayerProfileResponse } from '@league-helper/shared';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../config/player-refresh.config';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';

@Injectable()
export class PlayerCacheService {
  private readonly logger = new Logger(PlayerCacheService.name);

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
  ) {}

  private key(playerId: string): string {
    return `player-profile:${playerId}`;
  }

  async getProfile(playerId: string): Promise<PlayerProfileResponse | null> {
    try {
      const raw = await this.redis.get(this.key(playerId));
      if (!raw) {
        return null;
      }
      return PlayerProfileResponseSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Profile cache read failed',
        playerId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  async setProfile(playerId: string, profile: PlayerProfileResponse): Promise<void> {
    try {
      const parsed = PlayerProfileResponseSchema.parse(profile);
      await this.redis.set(
        this.key(playerId),
        JSON.stringify(parsed),
        'EX',
        this.config.profileCacheTtlSeconds,
      );
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Profile cache write failed',
        playerId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  async invalidate(playerId: string): Promise<void> {
    try {
      await this.redis.del(this.key(playerId));
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Profile cache invalidate failed',
        playerId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}
