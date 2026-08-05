import type { Redis } from 'ioredis';
import {
  PlatformRouteSchema,
  buildChampionStatsGenerationKey,
  type PlatformRoute,
} from '@league-helper/shared';
import type { MaterializedChampionDimensions } from '@league-helper/match-analytics';
import { logger } from '../../logger.js';

export type CacheGenerationScope = {
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  platform: PlatformRoute;
  patch: string;
  queueId: number;
};

export function distinctCacheGenerationScopes(
  dims: MaterializedChampionDimensions[],
): CacheGenerationScope[] {
  const scopes = new Map<string, CacheGenerationScope>();
  for (const dim of dims) {
    const platform = PlatformRouteSchema.safeParse(dim.platformRoute);
    if (!platform.success) {
      continue;
    }
    const scope: CacheGenerationScope = {
      sourceNormalizationVersion: dim.sourceNormalizationVersion,
      aggregationVersion: dim.aggregationVersion,
      platform: platform.data,
      patch: dim.patch,
      queueId: dim.queueId,
    };
    scopes.set(
      JSON.stringify([
        scope.sourceNormalizationVersion,
        scope.aggregationVersion,
        scope.platform,
        scope.patch,
        scope.queueId,
      ]),
      scope,
    );
  }
  return [...scopes.values()];
}

/**
 * After successful aggregate commit: INCR generation for each distinct affected scope.
 * Redis failures are warnings only — never fail the aggregation job.
 * No KEYS scan.
 */
export async function incrementChampionStatsCacheGenerations(input: {
  redis: Redis;
  scopes: CacheGenerationScope[];
  matchId: string;
  correlationId?: string;
}): Promise<number> {
  let incremented = 0;
  for (const scope of input.scopes) {
    const key = buildChampionStatsGenerationKey(scope);
    try {
      await input.redis.incr(key);
      incremented += 1;
      logger.info('champion_aggregation_cache_generation_incremented', {
        matchId: input.matchId,
        correlationId: input.correlationId,
        platform: scope.platform,
        patch: scope.patch,
        queueId: scope.queueId,
        sourceNormalizationVersion: scope.sourceNormalizationVersion,
        aggregationVersion: scope.aggregationVersion,
      });
    } catch (error: unknown) {
      logger.warn('champion_aggregation_cache_generation_failed', {
        matchId: input.matchId,
        correlationId: input.correlationId,
        platform: scope.platform,
        patch: scope.patch,
        queueId: scope.queueId,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }
  return incremented;
}
