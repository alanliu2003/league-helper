import { describe, expect, it, vi } from 'vitest';
import {
  invalidatePlayerProfileCaches,
  playerProfileCacheKey,
} from './ingestion-cache-invalidator.js';

describe('ingestion-cache-invalidator', () => {
  it('deletes player-profile keys for linked accounts', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const prisma = {
      playerAccount: {
        findMany: vi.fn().mockResolvedValue([{ playerId: 'player-1' }]),
      },
    };
    const redis = { del };

    await invalidatePlayerProfileCaches({
      prisma: prisma as never,
      redis: redis as never,
      playerAccountIds: ['account-1'],
      correlationId: 'corr-1',
    });

    expect(del).toHaveBeenCalledWith(playerProfileCacheKey('player-1'));
  });

  it('does not throw when redis delete fails', async () => {
    const prisma = {
      playerAccount: {
        findMany: vi.fn().mockResolvedValue([{ playerId: 'player-1' }]),
      },
    };
    const redis = {
      del: vi.fn().mockRejectedValue(new Error('redis down')),
    };

    await expect(
      invalidatePlayerProfileCaches({
        prisma: prisma as never,
        redis: redis as never,
        playerAccountIds: ['account-1'],
      }),
    ).resolves.toBeUndefined();
  });
});
