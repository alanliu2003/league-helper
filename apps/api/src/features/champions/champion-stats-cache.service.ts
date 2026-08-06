import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { z, ZodTypeAny } from 'zod';
import {
  buildChampionStatsChampionCacheKey,
  buildChampionStatsFiltersCacheKey,
  buildChampionStatsGenerationKey,
  buildChampionStatsTableCacheKey,
  type ChampionStatsChampionCacheKeyInput,
  type ChampionStatsFiltersCacheKeyInput,
  type ChampionStatsGenerationScope,
  type ChampionStatsTableCacheKeyInput,
} from '@league-helper/shared';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';

@Injectable()
export class ChampionStatsCacheService {
  private readonly logger = new Logger(ChampionStatsCacheService.name);

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(CHAMPION_STATS_CONFIG) private readonly config: ChampionStatsConfig,
  ) {}

  async getGeneration(scope: ChampionStatsGenerationScope): Promise<number> {
    try {
      const raw = await this.redis.get(buildChampionStatsGenerationKey(scope));
      if (raw === null || raw === undefined || raw.trim() === '') {
        return 0;
      }
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : 0;
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Champion stats generation read failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return 0;
    }
  }

  async getParsed<T extends ZodTypeAny>(
    key: string,
    schema: T,
  ): Promise<z.output<T> | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        return null;
      }
      return schema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Champion stats cache read failed or corrupt',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  /**
   * Write only if generation is unchanged since the read used for the key.
   * If generation advanced during compute, skip the write — the payload was
   * produced against the old generation and must not be stored under the new one.
   */
  async setIfGenerationCurrent<T>(input: {
    scope: ChampionStatsGenerationScope;
    expectedGeneration: number;
    buildKey: (generation: number) => string;
    value: T;
  }): Promise<'written' | 'skipped' | 'failed'> {
    try {
      const current = await this.getGeneration(input.scope);
      if (current !== input.expectedGeneration) {
        return 'skipped';
      }

      await this.redis.set(
        input.buildKey(current),
        JSON.stringify(input.value),
        'EX',
        this.config.cacheTtlSeconds,
      );
      return 'written';
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Champion stats cache write failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return 'failed';
    }
  }

  tableKey(input: ChampionStatsTableCacheKeyInput): string {
    return buildChampionStatsTableCacheKey(input);
  }

  championKey(input: ChampionStatsChampionCacheKeyInput): string {
    return buildChampionStatsChampionCacheKey(input);
  }

  filtersKey(input: ChampionStatsFiltersCacheKeyInput): string {
    return buildChampionStatsFiltersCacheKey(input);
  }
}
