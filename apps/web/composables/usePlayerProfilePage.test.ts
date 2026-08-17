import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  type PlayerPlaystyleResponse,
  type PlayerRefreshStatus,
  type PublicMatchSummary,
} from '@league-helper/shared';
import { createPlayerProfilePageController } from './usePlayerProfilePage';
import type { PlayerProfilePageApi } from './usePlayerProfilePage';
import { PlayerApiError } from './usePlayerApi';

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

function disabledPlaystyle(): PlayerPlaystyleResponse {
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    aiDisclaimer: PLAYER_PLAYSTYLE_AI_DISCLAIMER,
    rankSemantics: RANK_TIER_SEMANTICS,
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      queueId: 420,
      matchWindow: 20,
      windowSize: 20,
      matchesAnalyzed: 18,
      comparableMatchCount: 16,
      wins: 10,
      playerSampleBand: 'CREDIBLE',
      patchRange: { min: '16.14', max: '16.15' },
    },
    mix: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
      },
    ],
    overall: {
      comparisons: [
        {
          metric: 'CS_PER_MIN',
          playerValue: null,
          baseline: {
            value: null,
            sampleSize: 1000,
            sampleConfidence: 'HIGH',
            rankTier: 'GOLD',
            usedAllTierFallback: false,
          },
          delta: 0.2,
          comparableMatchCount: 12,
          direction: 'NEAR_BASELINE',
          interpretationAllowed: true,
        },
      ],
    },
    championSlices: [],
    skipped: { remake: 0, incomplete: 0, unknownPosition: 0, noBaseline: 0 },
    ai: {
      status: 'DISABLED',
      emptyReason: 'AI_DISABLED',
      insight: null,
    },
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
    getPlaystyle: vi.fn(async () => disabledPlaystyle()),
    ...overrides,
  };
}

async function loadUntilPlaystyleSettled(
  page: ReturnType<typeof createPlayerProfilePageController>,
  api: PlayerProfilePageApi,
): Promise<void> {
  await page.loadProfile();
  const results = vi.mocked(api.getPlaystyle).mock.results;
  await Promise.all(results.map((result) => Promise.resolve(result.value).catch(() => undefined)));
  await Promise.resolve();
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

  it('loads playstyle on successful profile load', async () => {
    const envelope = disabledPlaystyle();
    const api = createApi({
      getPlaystyle: vi.fn(async () => envelope),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await loadUntilPlaystyleSettled(page, api);

    expect(api.getPlaystyle).toHaveBeenCalledWith('player-1');
    expect(page.playstyle.value).toEqual(envelope);
    expect(page.playstyleError.value).toBeNull();
    expect(page.loadError.value).toBeNull();
  });

  it('sets playstyleError without clearing matches when playstyle GET fails', async () => {
    const api = createApi({
      getPlaystyle: vi.fn(async () => {
        throw new PlayerApiError(500, 'INTERNAL_ERROR', 'boom');
      }),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await loadUntilPlaystyleSettled(page, api);

    expect(page.matches.value).toHaveLength(1);
    expect(page.loadError.value).toBeNull();
    expect(page.playstyle.value).toBeNull();
    expect(page.playstyleError.value).toBe('Unable to load playstyle analysis.');
  });

  it('continues getPlaystyle while AI status is PENDING', async () => {
    vi.useFakeTimers();
    const pendingEnvelope: PlayerPlaystyleResponse = {
      ...disabledPlaystyle(),
      ai: { status: 'PENDING', insight: null },
    };
    const api = createApi({
      getPlaystyle: vi.fn(async () => pendingEnvelope),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await loadUntilPlaystyleSettled(page, api);

    expect(api.getPlaystyle).toHaveBeenCalledTimes(1);
    expect(page.playstyle.value?.ai.status).toBe('PENDING');

    await vi.advanceTimersByTimeAsync(2000);
    expect(api.getPlaystyle).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(api.getPlaystyle).toHaveBeenCalledTimes(3);

    page.stopPlaystylePolling();
  });

  it('refetches playstyle after a completed match refresh', async () => {
    const api = createApi({
      refresh: vi.fn(async () =>
        refresh({
          state: 'IDLE',
          queuedMatchCount: 0,
          activeMatchCount: 0,
          delayedMatchCount: 0,
          completedMatchCount: 1,
        }),
      ),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await loadUntilPlaystyleSettled(page, api);
    const callsAfterLoad = vi.mocked(api.getPlaystyle).mock.calls.length;

    await page.onRefresh();
    const refreshResults = vi.mocked(api.getPlaystyle).mock.results.slice(callsAfterLoad);
    await Promise.all(
      refreshResults.map((result) => Promise.resolve(result.value).catch(() => undefined)),
    );

    expect(vi.mocked(api.getPlaystyle).mock.calls.length).toBeGreaterThan(callsAfterLoad);
    expect(page.playstyle.value).not.toBeNull();
  });

  it('refetches playstyle when match polling completes', async () => {
    const api = createApi({
      getRefreshStatus: vi.fn(async () =>
        refresh({
          state: 'IDLE',
          queuedMatchCount: 0,
          activeMatchCount: 0,
          delayedMatchCount: 0,
          completedMatchCount: 2,
        }),
      ),
    });
    const page = createPlayerProfilePageController(() => 'player-1', api);
    await loadUntilPlaystyleSettled(page, api);
    const callsAfterLoad = vi.mocked(api.getPlaystyle).mock.calls.length;

    await page.pollOnce();
    const pollResults = vi.mocked(api.getPlaystyle).mock.results.slice(callsAfterLoad);
    await Promise.all(
      pollResults.map((result) => Promise.resolve(result.value).catch(() => undefined)),
    );

    expect(vi.mocked(api.getPlaystyle).mock.calls.length).toBeGreaterThan(callsAfterLoad);
  });
});
