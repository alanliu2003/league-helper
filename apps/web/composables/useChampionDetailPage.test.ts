import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  type ChampionDetailResponse,
  type ChampionStatsFiltersResponse,
  type ChampionStatsResponse,
} from '@league-helper/shared';
import { ChampionApiError } from './useChampionApi';
import {
  createChampionDetailPageController,
  isNumericChampionRouteKey,
  type ChampionDetailPageApi,
  type ChampionDetailPageRouter,
} from './useChampionDetailPage';

type QueryRecord = Record<string, string | string[] | undefined | null>;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function filtersMeta(
  overrides: Partial<ChampionStatsFiltersResponse> = {},
): ChampionStatsFiltersResponse {
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    defaultPlatform: 'na1',
    defaultQueueId: 420,
    defaultPatch: '14.11',
    availablePlatforms: ['na1', 'euw1'],
    availablePatches: ['14.11', '14.10'],
    availableQueues: [
      { queueId: 420, label: 'Ranked Solo/Duo', supportsStandardPositions: true },
      { queueId: 440, label: 'Ranked Flex', supportsStandardPositions: true },
      { queueId: 450, label: 'ARAM', supportsStandardPositions: false },
    ],
    availableTiers: ['ALL', 'GOLD', 'PLATINUM', 'UNKNOWN'],
    availablePositions: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'],
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    ...overrides,
  };
}

function championDetail(
  overrides: Partial<ChampionDetailResponse['champion']> = {},
): ChampionDetailResponse {
  return {
    champion: {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage', 'Assassin'],
      iconUrl: 'https://example.com/ahri.png',
      splashUrl: 'https://example.com/ahri-splash.jpg',
      ...overrides,
    },
    staticDataPatch: '14.11',
  };
}

function emptyBreakdown(): ChampionStatsResponse['positionBreakdown'] {
  return (['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'] as const).map((position) => ({
    position,
    dimensions: null,
    metrics: null,
  }));
}

function statsResponse(overrides: Partial<ChampionStatsResponse> = {}): ChampionStatsResponse {
  return {
    champion: championDetail().champion,
    stats: null,
    emptyReason: 'CHAMPION_HAS_NO_STATS',
    positionBreakdown: emptyBreakdown(),
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      platform: 'na1',
      patch: '14.11',
      queueId: 420,
    },
    freshness: 'CURRENT',
    requestedFilters: {},
    resolvedFilters: {
      platform: 'na1',
      patch: '14.11',
      queueId: 420,
      tier: 'ALL',
      position: null,
    },
    usedDefaultPlatform: false,
    usedDefaultPatch: false,
    effectiveMinimumSample: 30,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    ...overrides,
  };
}

function createApi(overrides: Partial<ChampionDetailPageApi> = {}): ChampionDetailPageApi {
  return {
    getFilters: vi.fn(async () => filtersMeta()),
    getChampionDetail: vi.fn(async () => championDetail()),
    getChampionStats: vi.fn(async () => statsResponse()),
    ...overrides,
  };
}

function createRouter(
  initialQuery: QueryRecord = {},
  initialPath = '/champions/Ahri',
): ChampionDetailPageRouter & { path: string; query: QueryRecord } {
  const state = {
    path: initialPath,
    query: { ...initialQuery } as QueryRecord,
  };
  return {
    get path() {
      return state.path;
    },
    get query() {
      return state.query;
    },
    getQuery: () => state.query,
    replaceLocation: vi.fn(async (path: string, query: Record<string, string>) => {
      state.path = path;
      state.query = { ...query };
    }),
  };
}

describe('isNumericChampionRouteKey', () => {
  it('detects numeric-only route keys', () => {
    expect(isNumericChampionRouteKey('103')).toBe(true);
    expect(isNumericChampionRouteKey(' 23 ')).toBe(true);
    expect(isNumericChampionRouteKey('Ahri')).toBe(false);
    expect(isNumericChampionRouteKey('a103')).toBe(false);
  });
});

describe('createChampionDetailPageController', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('rejects numeric routes as not-found without API calls', async () => {
    const api = createApi();
    const router = createRouter({}, '/champions/103');
    const controller = createChampionDetailPageController(() => '103', api, router);

    await controller.initialize();

    expect(controller.notFound.value).toBe(true);
    expect(api.getChampionDetail).not.toHaveBeenCalled();
    expect(api.getChampionStats).not.toHaveBeenCalled();
  });

  it('canonicalizes lowercase champion key via replace and preserves aggregate filters', async () => {
    const api = createApi({
      getChampionDetail: vi.fn(async () =>
        championDetail({ championKey: 'Ahri', canonicalChampionKey: 'Ahri' }),
      ),
    });
    const router = createRouter(
      {
        platform: 'euw1',
        queue: '420',
        tier: 'GOLD',
        position: 'MIDDLE',
        patch: '14.10',
        search: 'fox',
        tag: 'Mage',
      },
      '/champions/ahri',
    );
    const controller = createChampionDetailPageController(() => 'ahri', api, router);

    await controller.initialize();

    expect(controller.notFound.value).toBe(false);
    expect(controller.champion.value?.championKey).toBe('Ahri');
    expect(router.replaceLocation).toHaveBeenCalled();
    const [path, query] = (router.replaceLocation as ReturnType<typeof vi.fn>).mock.calls.at(
      -1,
    ) as [string, Record<string, string>];
    expect(path).toBe('/champions/Ahri');
    expect(query.platform).toBe('euw1');
    expect(query.queue).toBe('420');
    expect(query.tier).toBe('GOLD');
    expect(query.position).toBe('MIDDLE');
    expect(query.patch).toBe('14.10');
    expect(query.search).toBeUndefined();
    expect(query.tag).toBeUndefined();
  });

  it('marks unknown champion as not-found only for CHAMPION_NOT_FOUND', async () => {
    const api = createApi({
      getChampionDetail: vi.fn(async () => {
        throw new ChampionApiError(404, 'CHAMPION_NOT_FOUND', 'Champion was not found.');
      }),
      getChampionStats: vi.fn(async () => {
        throw new ChampionApiError(404, 'CHAMPION_NOT_FOUND', 'Champion was not found.');
      }),
    });
    const router = createRouter();
    const controller = createChampionDetailPageController(() => 'NotAChamp', api, router);

    await controller.initialize();

    expect(controller.notFound.value).toBe(true);
    expect(controller.metadataError.value).toBeNull();
  });

  it('keeps metadata when stats fail with a non-not-found error', async () => {
    const api = createApi({
      getChampionStats: vi.fn(async () => {
        throw new ChampionApiError(500, 'INTERNAL', 'boom');
      }),
    });
    const router = createRouter({ position: 'MIDDLE' });
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(controller.notFound.value).toBe(false);
    expect(controller.champion.value?.name).toBe('Ahri');
    expect(controller.statsError.value).toBeTruthy();
    expect(controller.statsResponse.value).toBeNull();
  });

  it('renders empty metrics state when known champion returns stats:null', async () => {
    const api = createApi({
      getChampionStats: vi.fn(async () =>
        statsResponse({
          stats: null,
          emptyReason: 'CHAMPION_HAS_NO_STATS',
          resolvedFilters: {
            platform: 'na1',
            patch: '14.11',
            queueId: 420,
            tier: 'ALL',
            position: 'MIDDLE',
          },
        }),
      ),
    });
    const router = createRouter({ position: 'MIDDLE' });
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(controller.champion.value).not.toBeNull();
    expect(controller.statsResponse.value?.stats).toBeNull();
    expect(controller.hasExactStats.value).toBe(false);
    expect(controller.emptyReason.value).toBe('CHAMPION_HAS_NO_STATS');
  });

  it('updates URL and refetches exact stats when position is selected', async () => {
    const api = createApi();
    const router = createRouter({ platform: 'na1', queue: '420', patch: '14.11', tier: 'ALL' });
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();
    expect(api.getChampionStats).toHaveBeenCalledTimes(1);
    const firstCall = (api.getChampionStats as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall?.[1]?.position).toBeUndefined();

    await controller.setPosition('MIDDLE');

    expect(router.replaceLocation).toHaveBeenCalled();
    const [, query] = (router.replaceLocation as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [
      string,
      Record<string, string>,
    ];
    expect(query.position).toBe('MIDDLE');
    expect(api.getChampionStats).toHaveBeenCalledTimes(2);
    const secondCall = (api.getChampionStats as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall?.[1]?.position).toBe('MIDDLE');
  });

  it('does not request ALL-position exact stats when position is omitted', async () => {
    const api = createApi();
    const router = createRouter({});
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(api.getChampionStats).toHaveBeenCalledTimes(1);
    const options = (api.getChampionStats as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      position?: string;
    };
    expect(options.position).toBeUndefined();
    expect(controller.hasExactStats.value).toBe(false);
    expect(controller.positionBreakdown.value).toHaveLength(5);
  });

  it('exposes five-role breakdown from a single stats response', async () => {
    const api = createApi({
      getChampionStats: vi.fn(async () =>
        statsResponse({
          positionBreakdown: emptyBreakdown(),
        }),
      ),
    });
    const router = createRouter();
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(api.getChampionStats).toHaveBeenCalledTimes(1);
    expect(controller.positionBreakdown.value.map((e) => e.position)).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'SUPPORT',
    ]);
    expect(controller.positionBreakdown.value.some((e) => (e.position as string) === 'UNKNOWN')).toBe(
      false,
    );
  });

  it('excludes UNKNOWN from primary tier options', async () => {
    const api = createApi();
    const router = createRouter();
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(controller.primaryTiers.value).not.toContain('UNKNOWN');
    expect(controller.primaryTiers.value).toContain('ALL');
  });

  it('preserves directory aggregate filters and never copies search/tag into detail URL', async () => {
    const api = createApi();
    const router = createRouter({
      platform: 'euw1',
      queue: '440',
      tier: 'PLATINUM',
      position: 'TOP',
      patch: '14.10',
      search: 'ah',
      tag: 'Mage',
    });
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(controller.filters.platform).toBe('euw1');
    expect(controller.filters.queue).toBe(440);
    expect(controller.filters.tier).toBe('PLATINUM');
    expect(controller.filters.position).toBe('TOP');
    expect(controller.filters.patch).toBe('14.10');

    const calls = (router.replaceLocation as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, query] of calls as [string, Record<string, string>][]) {
      expect(query.search).toBeUndefined();
      expect(query.tag).toBeUndefined();
    }
  });

  it('exposes freshness from the stats envelope', async () => {
    const api = createApi({
      getChampionStats: vi.fn(async () => statsResponse({ freshness: 'RECALCULATION_PENDING' })),
    });
    const router = createRouter();
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    expect(controller.freshness.value).toBe('RECALCULATION_PENDING');
  });

  it('does not sync URL or fetch stats after aborted metadata from rapid reload', async () => {
    const firstDetail = deferred<ChampionDetailResponse>();
    let detailCalls = 0;
    let routeKey = 'Zed';
    const api = createApi({
      getChampionDetail: vi.fn(async (_key, signal) => {
        detailCalls += 1;
        if (detailCalls === 1) {
          const response = await firstDetail.promise;
          if (signal?.aborted) {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }
          return response;
        }
        return championDetail({ championKey: 'Ahri', name: 'Ahri' });
      }),
      getChampionStats: vi.fn(async (key) =>
        statsResponse({
          champion: championDetail({ championKey: key }).champion,
        }),
      ),
    });
    const router = createRouter({ platform: 'na1', queue: '420' }, '/champions/Zed');
    const controller = createChampionDetailPageController(() => routeKey, api, router);

    const firstInit = controller.initialize();
    await vi.waitFor(() => expect(api.getChampionDetail).toHaveBeenCalledTimes(1));
    expect(api.getChampionStats).not.toHaveBeenCalled();

    routeKey = 'Ahri';
    const secondInit = controller.reload();
    await vi.waitFor(() => expect(api.getChampionDetail).toHaveBeenCalledTimes(2));

    // Stale first metadata resolves after abort — must not clobber the second load.
    firstDetail.resolve(championDetail({ championKey: 'Zed', name: 'Zed' }));
    await firstInit;
    await secondInit;

    expect(controller.champion.value?.championKey).toBe('Ahri');
    expect(controller.champion.value?.name).toBe('Ahri');
    expect(controller.filters.platform).toBe('na1');
    expect(controller.filters.queue).toBe(420);
    expect(router.path).toBe('/champions/Ahri');
    expect(api.getChampionStats).toHaveBeenCalled();
    const statsKeys = (api.getChampionStats as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(statsKeys).not.toContain('Zed');
    expect(statsKeys.every((key) => key === 'Ahri')).toBe(true);
    const paths = (router.replaceLocation as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0] as string,
    );
    expect(paths).not.toContain('/champions/Zed');
  });

  it('clears exact stats while refetching and ignores stale out-of-order responses', async () => {
    const middleStats = deferred<ChampionStatsResponse>();
    const topStats = deferred<ChampionStatsResponse>();
    const api = createApi({
      getChampionStats: vi.fn(async (_key, options) => {
        if (!options.position) {
          return statsResponse({
            stats: null,
            resolvedFilters: {
              platform: 'na1',
              patch: '14.11',
              queueId: 420,
              tier: 'ALL',
              position: null,
            },
          });
        }
        if (options.position === 'MIDDLE') {
          return middleStats.promise;
        }
        if (options.position === 'TOP') {
          return topStats.promise;
        }
        return statsResponse();
      }),
    });
    const router = createRouter({ platform: 'na1', queue: '420', patch: '14.11', tier: 'ALL' });
    const controller = createChampionDetailPageController(() => 'Ahri', api, router);

    await controller.initialize();

    const middlePromise = controller.setPosition('MIDDLE');
    await vi.waitFor(() => expect(controller.statsPending.value).toBe(true));
    expect(controller.filters.position).toBe('MIDDLE');
    expect(controller.statsResponse.value).toBeNull();
    expect(controller.hasExactStats.value).toBe(false);

    const topPromise = controller.setPosition('TOP');
    await vi.waitFor(() => expect(controller.filters.position).toBe('TOP'));
    expect(controller.statsResponse.value).toBeNull();

    // Latest (TOP) wins first; stale MIDDLE must not clobber it afterward.
    topStats.resolve(
      statsResponse({
        stats: {
          dimensions: {
            championId: 103,
            patch: '14.11',
            platform: 'na1',
            regionalRoute: 'americas',
            queueId: 420,
            rankTier: 'ALL',
            position: 'TOP',
            sourceNormalizationVersion: '1',
            aggregationVersion: '1',
          },
          metrics: {
            sampleSize: 30,
            wins: 18,
            winRate: 0.6,
            wilsonInterval: null,
            sampleConfidence: 'LOW',
            aggregateKdaRatio: 2,
            averageCsPerMinute: 7,
            averageDamagePerMinute: 500,
            averageVisionScorePerMinute: 0.9,
            averageGoldPerMinute: 400,
            averageGoldDifferenceAt10: null,
            averageGoldDifferenceAt15: null,
            averageCsDifferenceAt10: null,
            averageCsDifferenceAt15: null,
            latestEligibleMatchAt: null,
          },
        },
        resolvedFilters: {
          platform: 'na1',
          patch: '14.11',
          queueId: 420,
          tier: 'ALL',
          position: 'TOP',
        },
      }),
    );
    await topPromise;

    expect(controller.statsResponse.value?.resolvedFilters.position).toBe('TOP');
    expect(controller.statsResponse.value?.stats?.dimensions.position).toBe('TOP');
    expect(controller.filters.position).toBe('TOP');
    expect(controller.hasExactStats.value).toBe(true);

    middleStats.resolve(
      statsResponse({
        stats: {
          dimensions: {
            championId: 103,
            patch: '14.11',
            platform: 'na1',
            regionalRoute: 'americas',
            queueId: 420,
            rankTier: 'ALL',
            position: 'MIDDLE',
            sourceNormalizationVersion: '1',
            aggregationVersion: '1',
          },
          metrics: {
            sampleSize: 40,
            wins: 22,
            winRate: 0.55,
            wilsonInterval: null,
            sampleConfidence: 'LOW',
            aggregateKdaRatio: 3,
            averageCsPerMinute: 8,
            averageDamagePerMinute: 600,
            averageVisionScorePerMinute: 1,
            averageGoldPerMinute: 400,
            averageGoldDifferenceAt10: null,
            averageGoldDifferenceAt15: null,
            averageCsDifferenceAt10: null,
            averageCsDifferenceAt15: null,
            latestEligibleMatchAt: null,
          },
        },
        resolvedFilters: {
          platform: 'na1',
          patch: '14.11',
          queueId: 420,
          tier: 'ALL',
          position: 'MIDDLE',
        },
      }),
    );
    await middlePromise;

    expect(controller.statsResponse.value?.resolvedFilters.position).toBe('TOP');
    expect(controller.statsResponse.value?.stats?.dimensions.position).toBe('TOP');
    expect(controller.filters.position).toBe('TOP');
  });
});
