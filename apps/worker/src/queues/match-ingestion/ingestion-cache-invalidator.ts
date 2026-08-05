import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { logger } from '../../logger.js';

export function playerProfileCacheKey(playerId: string): string {
  return `player-profile:${playerId}`;
}

/**
 * Best-effort Redis invalidation for linked player profiles.
 * Failures are logged as warnings and never fail the ingestion job.
 */
export async function invalidatePlayerProfileCaches(input: {
  prisma: PrismaClient;
  redis: Redis;
  playerAccountIds: string[];
  correlationId?: string;
  jobId?: string;
}): Promise<void> {
  const uniqueAccountIds = [...new Set(input.playerAccountIds.filter(Boolean))];
  if (uniqueAccountIds.length === 0) {
    return;
  }

  let playerIds: string[] = [];
  try {
    const accounts = await input.prisma.playerAccount.findMany({
      where: { id: { in: uniqueAccountIds } },
      select: { playerId: true },
    });
    playerIds = [...new Set(accounts.map((account) => account.playerId))];
  } catch (error: unknown) {
    logger.warn('Cache invalidation lookup failed', {
      correlationId: input.correlationId,
      jobId: input.jobId,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return;
  }

  for (const playerId of playerIds) {
    try {
      await input.redis.del(playerProfileCacheKey(playerId));
      logger.info('Cache invalidation', {
        correlationId: input.correlationId,
        jobId: input.jobId,
        // playerId is an internal UUID, not a PUUID — safe for ops logs.
        playerId,
      });
    } catch (error: unknown) {
      logger.warn('Cache invalidation failed', {
        correlationId: input.correlationId,
        jobId: input.jobId,
        playerId,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }
}
