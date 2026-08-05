import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerRefreshStatus, PublicMatchSummary } from '@league-helper/shared';
import { createPlayerProfilePageController } from './usePlayerProfilePage';
import type { PlayerProfilePageApi } from './usePlayerProfilePage';

function match(id: string, queueId = 420): PublicMatchSummary {
  return {
    id,
    externalMatchId: `NA1_${id.slice(0, 8)}`,
    queueId,
    gameCreation: new Date().toISOString(),
    gameDurationSeconds: 1800,
    gameVersion: '14.11.1',
    normalizedPatch: '14.11',
    remake: false,
    earlySurrender: false,
    result: 'victory',
    championId: 23,
    championKey: 'Tryndamere',
    championName: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
    teamPosition: 'TOP',
    role: 'TOP',
    win: true,
    kills: 1,
    deaths: 0,
    assists: 1,
    kda: 2,
    totalCs: 100,
    csPerMinute: 3.3,
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
    ingestionStatus: 'COMPLETED',
  };
}

function refresh(overrides: Partial<PlayerRefreshStatus> = {}): PlayerRefreshStatus {
  return {
    state: 'PROCESSING',
    requestedMatchCount: 20,
    discoveredMatchCount: 20,
    knownMatchCount: 1,
    queuedMatchCount: 19,
    activeMatchCount: 0,
    delayedMatchCount: 0,
    completedMatchCount: 1,
    failedMatchCount: 0,
    lastResolvedAt: null,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastRefreshedAt: null,
    isStale: false,
    warnings: [],
    ...overrides,
  };
}

function createApi(overrides: Partial<PlayerProfilePageApi> = {}): PlayerProfilePageApi {
  const existing = match('11111111-1111-1111-1111-111111111111');
  return {
    apiBase: 'http://localhost:3001',
    search: vi.fn(),
    getProfile: vi.fn(async () => ({
      player: {
        id: '00000000-0000-4000-8000-000000000001',
        accountId: '00000000-0000-4000-8000-000000000002',
        provider: 'RIOT' as const,
        platform: 'na1' as const,
        regionalRoute: 'americas' as const,
        riotId: { gameName: 'Example', tagLine: 'NA1' },
        profileIconId: 1,
        summonerLevel: 30,
        lastResolvedAt: null,
      },
      ranks: [],
      mastery: [],
      matches: [existing],
      refresh: refresh({ state: 'IDLE', queuedMatchCount: 0, completedMatchCount: 1 }),
    })),
    getMatches: vi.fn(async () => ({ items: [existing], nextCursor: null })),
    refresh: vi.fn(async () => refresh()),
    getRefreshStatus: vi.fn(async () => refresh()),
    ...overrides,
  };
}

describe('createPlayerProfilePageController', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('keeps existing match cards while refresh is pending and does not clear them', async () => {
    const existing = match('11111111-1111-1111-1111-111111111111');
    let resolveRefresh: (value: PlayerRefreshStatus) => void = () => undefined;
    const api = createApi({
      refresh: vi.fn(
        () =>
          new Promise<PlayerRefreshStatus>((resolve) => {
            resolveRefresh = resolve;
          }),
      ),
      getMatches: vi.fn(async () => ({ items: [existing], nextCursor: null })),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await page.loadProfile();
    expect(page.matches.value).toHaveLength(1);

    const refreshPromise = page.onRefresh();
    expect(page.matches.value).toHaveLength(1);
    expect(page.refreshing.value).toBe(true);

    resolveRefresh(refresh({ state: 'PROCESSING', completedMatchCount: 1 }));
    await refreshPromise;

    expect(page.matches.value).toHaveLength(1);
    expect(api.refresh).toHaveBeenCalledWith('player-1', { force: false });
    const refreshBody = (api.refresh as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(refreshBody.queueId).toBeUndefined();
  });

  it('does not overwrite stored matches from a refresh response without a match list', async () => {
    const existing = match('11111111-1111-1111-1111-111111111111');
    const api = createApi({
      refresh: vi.fn(async () => refresh({ completedMatchCount: 1 })),
      getMatches: vi.fn(async () => ({ items: [existing], nextCursor: null })),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await page.loadProfile();
    await page.onRefresh();
    expect(page.matches.value.map((m) => m.id)).toEqual([existing.id]);
    expect(api.getMatches).toHaveBeenCalled();
  });

  it('preserves cards when a transient match fetch fails after refresh', async () => {
    const existing = match('11111111-1111-1111-1111-111111111111');
    const api = createApi({
      getMatches: vi
        .fn()
        .mockResolvedValueOnce({ items: [existing], nextCursor: null })
        .mockRejectedValueOnce(new Error('network')),
      refresh: vi.fn(async () => refresh()),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await page.loadProfile();
    await page.onRefresh();
    expect(page.matches.value).toHaveLength(1);
    expect(page.matchesError.value).toBeTruthy();
  });

  it('adds new match cards when polling sees completedMatchCount increase', async () => {
    const first = match('11111111-1111-1111-1111-111111111111');
    const second = match('22222222-2222-2222-2222-222222222222', 450);
    const api = createApi({
      getMatches: vi
        .fn()
        .mockResolvedValueOnce({ items: [first], nextCursor: null })
        .mockResolvedValue({ items: [second, first], nextCursor: null }),
      getRefreshStatus: vi.fn(async () =>
        refresh({
          state: 'PARTIAL',
          completedMatchCount: 2,
          queuedMatchCount: 1,
          activeMatchCount: 0,
          delayedMatchCount: 0,
        }),
      ),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await page.loadProfile();
    expect(page.matches.value).toHaveLength(1);
    await page.pollOnce();
    expect(page.matches.value).toHaveLength(2);
    expect(page.matches.value.map((m) => m.queueId)).toEqual(expect.arrayContaining([420, 450]));
  });

  it('defaults filter to all and does not call refresh when changing display filter', async () => {
    const api = createApi({
      getMatches: vi
        .fn()
        .mockResolvedValueOnce({
          items: [match('11111111-1111-1111-1111-111111111111')],
          nextCursor: null,
        })
        .mockResolvedValueOnce({
          items: [match('11111111-1111-1111-1111-111111111111')],
          nextCursor: null,
        }),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await page.loadProfile();
    expect(page.queueCategory.value).toBe('all');
    await page.setQueueCategory('ranked_solo');
    expect(api.refresh).not.toHaveBeenCalled();
    expect(api.getMatches).toHaveBeenLastCalledWith(
      'player-1',
      expect.objectContaining({ queueCategory: 'ranked_solo' }),
    );
  });
});
