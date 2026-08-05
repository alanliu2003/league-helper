import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerProfileResponse } from '@league-helper/shared';
import { loadPlayerRefreshConfig } from '../../config/player-refresh.config';
import { PlayerCacheService } from './player-cache.service';

function sampleProfile(playerId: string, matchCount: number): PlayerProfileResponse {
  const matches = Array.from({ length: matchCount }, (_, index) => ({
    id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa${String(index).padStart(2, '0')}`,
    externalMatchId: `NA1_${index}`,
    queueId: 420,
    gameCreation: new Date().toISOString(),
    gameDurationSeconds: 1000,
    gameVersion: '14.1.1',
    normalizedPatch: '14.1',
    remake: false,
    earlySurrender: false,
    result: 'victory' as const,
    championId: 23,
    championKey: 'Tryndamere',
    championName: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/Tryndamere.png',
    teamPosition: 'TOP',
    role: 'TOP',
    win: true,
    kills: 1,
    deaths: 0,
    assists: 0,
    kda: 1,
    totalCs: 10,
    csPerMinute: 1,
    killParticipation: null,
    itemIds: [],
    itemIconUrls: [],
    summonerSpell1Id: null,
    summonerSpell2Id: null,
    goldAt10: null,
    goldAt15: null,
    csAt10: null,
    csAt15: null,
    xpAt10: null,
    xpAt15: null,
    goldDifferenceAt10: null,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    timelineMetricsAvailable: false,
    ingestionStatus: 'COMPLETED' as const,
  }));

  return {
    player: {
      id: playerId,
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      provider: 'RIOT',
      platform: 'na1',
      regionalRoute: 'americas',
      riotId: { gameName: 'Example', tagLine: 'NA1' },
      profileIconId: 1,
      summonerLevel: 30,
      lastResolvedAt: null,
    },
    ranks: [],
    mastery: [],
    matches,
    refresh: {
      state: 'COMPLETE',
      requestedMatchCount: 20,
      discoveredMatchCount: 20,
      knownMatchCount: matchCount,
      queuedMatchCount: 0,
      activeMatchCount: 0,
      delayedMatchCount: 0,
      completedMatchCount: matchCount,
      failedMatchCount: 0,
      lastResolvedAt: null,
      lastRefreshStartedAt: null,
      lastRefreshCompletedAt: null,
      lastRefreshedAt: null,
      isStale: false,
      warnings: [],
    },
  };
}

describe('PlayerCacheService', () => {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  };

  beforeEach(() => {
    store.clear();
    redis.get.mockClear();
    redis.set.mockClear();
    redis.del.mockClear();
  });

  it('uses distinct keys per player and can invalidate without affecting others', async () => {
    const cache = new PlayerCacheService(redis as never, loadPlayerRefreshConfig());
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    await cache.setProfile(a, sampleProfile(a, 1));
    await cache.setProfile(b, sampleProfile(b, 2));

    expect(store.has(`player-profile:${a}`)).toBe(true);
    expect(store.has(`player-profile:${b}`)).toBe(true);

    await cache.invalidate(a);
    expect(await cache.getProfile(a)).toBeNull();
    expect((await cache.getProfile(b))?.matches).toHaveLength(2);
  });

  it('does not treat refresh-status keys as profile match cache', async () => {
    const cache = new PlayerCacheService(redis as never, loadPlayerRefreshConfig());
    const playerId = '11111111-1111-1111-1111-111111111111';
    store.set(`player-refresh-cooldown:${playerId}`, '1');
    expect(await cache.getProfile(playerId)).toBeNull();
  });
});
