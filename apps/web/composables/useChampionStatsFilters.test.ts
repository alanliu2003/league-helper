import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  type ChampionListResponse,
  type ChampionStatsFiltersResponse,
  type ChampionStatsTableResponse,
} from '@league-helper/shared';
import {
  createChampionStatsFiltersController,
  type ChampionStatsFiltersApi,
  type ChampionStatsFiltersRouter,
} from './useChampionStatsFilters';

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
      { queueId: 450, label: 'ARAM', supportsStandardPositions: false },
    ],
    availableTiers: ['ALL', 'GOLD', 'PLATINUM'],
    availablePositions: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'],
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      platform: 'na1',
      patch: '14.11',
      queueId: 420,
    },
    ...overrides,
  };
}

function tableResponse(
  overrides: Partial<ChampionStatsTableResponse> = {},
): ChampionStatsTableResponse {
  return {
    rows: [],
    pagination: { nextCursor: null, limit: 50, offset: 0, totalCount: 0 },
    emptyReason: 'NO_MATCHING_AGGREGATES',
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      platform: 'na1',
      patch: '14.11',
      queueId: 420,
    },
    freshness: 'CURRENT',
    requestedFilters: { position: 'MIDDLE' },
    resolvedFilters: {
      platform: 'na1',
      patch: '14.11',
      queueId: 420,
      tier: 'ALL',
      position: 'MIDDLE',
    },
    usedDefaultPlatform: false,
    usedDefaultPatch: false,
    effectiveMinimumSample: 30,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    ...overrides,
  };
}

function createApi(overrides: Partial<ChampionStatsFiltersApi> = {}): ChampionStatsFiltersApi {
  return {
    getFilters: vi.fn(async () => filtersMeta()),
    getStatsTable: vi.fn(async () => tableResponse()),
    listChampions: vi.fn(async (): Promise<ChampionListResponse> => ({ champions: [] })),
    ...overrides,
  };
}

function createRouter(initialQuery: QueryRecord = {}): ChampionStatsFiltersRouter {
  const state: { query: QueryRecord } = {
    query: { ...initialQuery },
  };
  return {
    getQuery: () => state.query,
    replaceQuery: vi.fn(async (next: Record<string, string>) => {
      state.query = { ...next };
    }),
  };
}

describe('createChampionStatsFiltersController', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('canonicalizes queueId alias to queue', async () => {
    const api = createApi();
    const router = createRouter({ queueId: '420', position: 'MIDDLE' });
    const controller = createChampionStatsFiltersController(api, router);

    await controller.initialize();

    expect(router.replaceQuery).toHaveBeenCalled();
    const replaced = (router.replaceQuery as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      string
    >;
    expect(replaced.queue).toBe('420');
    expect(replaced.queueId).toBeUndefined();
    expect(controller.filters.queue).toBe(420);
    expect(controller.filtersReady.value).toBe(true);
  });

  it('does not ranking-fetch until filtersReady && position', async () => {
    const api = createApi();
    const router = createRouter({});
    const controller = createChampionStatsFiltersController(api, router);

    const initPromise = controller.initialize();
    expect(controller.filtersReady.value).toBe(false);
    expect(api.getStatsTable).not.toHaveBeenCalled();

    await initPromise;

    expect(controller.filtersReady.value).toBe(true);
    expect(controller.filters.position).toBeNull();
    expect(api.getStatsTable).not.toHaveBeenCalled();

    await controller.setPosition('MIDDLE');
    expect(api.getStatsTable).toHaveBeenCalledTimes(1);
  });

  it('ignores stale out-of-order table responses', async () => {
    const seeded = tableResponse({
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.11',
        queueId: 420,
      },
      resolvedFilters: {
        platform: 'na1',
        patch: '14.11',
        queueId: 420,
        tier: 'ALL',
        position: 'TOP',
      },
    });
    const stale = tableResponse({
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.10',
        queueId: 420,
      },
      resolvedFilters: {
        platform: 'na1',
        patch: '14.10',
        queueId: 420,
        tier: 'ALL',
        position: 'TOP',
      },
    });
    const latest = tableResponse({
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.11',
        queueId: 420,
      },
      resolvedFilters: {
        platform: 'na1',
        patch: '14.11',
        queueId: 420,
        tier: 'ALL',
        position: 'MIDDLE',
      },
    });

    const staleDeferred = deferred<ChampionStatsTableResponse>();
    const latestDeferred = deferred<ChampionStatsTableResponse>();

    const api = createApi({
      getStatsTable: vi
        .fn()
        .mockResolvedValueOnce(seeded)
        .mockReturnValueOnce(staleDeferred.promise)
        .mockReturnValueOnce(latestDeferred.promise),
    });
    const router = createRouter({
      platform: 'na1',
      queue: '420',
      tier: 'ALL',
      patch: '14.11',
      position: 'TOP',
    });
    const controller = createChampionStatsFiltersController(api, router);
    await controller.initialize();
    expect(api.getStatsTable).toHaveBeenCalledTimes(1);

    const staleFetch = controller.refreshRanking();
    await vi.waitFor(() => expect(api.getStatsTable).toHaveBeenCalledTimes(2));

    const latestFetch = controller.setPosition('MIDDLE');
    await vi.waitFor(() => expect(api.getStatsTable).toHaveBeenCalledTimes(3));

    latestDeferred.resolve(latest);
    await latestFetch;

    expect(controller.viewState.value.displayedResponse?.sampleScope.patch).toBe('14.11');
    expect(controller.viewState.value.displayedResponse?.resolvedFilters.position).toBe('MIDDLE');

    staleDeferred.resolve(stale);
    await staleFetch;

    expect(controller.viewState.value.displayedResponse?.sampleScope.patch).toBe('14.11');
    expect(controller.viewState.value.displayedResponse?.resolvedFilters.position).toBe('MIDDLE');
  });

  it('does not fetch ranking for queues that lack standard positions', async () => {
    const api = createApi();
    const router = createRouter({
      platform: 'na1',
      queue: '420',
      tier: 'ALL',
      patch: '14.11',
      position: 'MIDDLE',
    });
    const controller = createChampionStatsFiltersController(api, router);
    await controller.initialize();
    expect(api.getStatsTable).toHaveBeenCalledTimes(1);

    // Defense: even with a stale unsupported queue + position, refuse ranking fetch.
    controller.filters.queue = 450;
    controller.filters.position = 'MIDDLE';
    await controller.refreshRanking();
    expect(api.getStatsTable).toHaveBeenCalledTimes(1);
  });

  it('does not call getStatsTable when only search changes with a position selected', async () => {
    const api = createApi();
    const router = createRouter({
      platform: 'na1',
      queue: '420',
      tier: 'ALL',
      patch: '14.11',
      position: 'MIDDLE',
    });
    const controller = createChampionStatsFiltersController(api, router);
    await controller.initialize();
    expect(api.getStatsTable).toHaveBeenCalledTimes(1);
    expect(api.listChampions).toHaveBeenCalledTimes(1);

    await controller.setSearch('ahri');

    expect(controller.filters.search).toBe('ahri');
    expect(api.getStatsTable).toHaveBeenCalledTimes(1);
    expect(api.listChampions).toHaveBeenCalledTimes(2);
    expect(api.listChampions).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'ahri' }),
    );
  });

  it('initialize with ARAM remaps queue to defaultQueueId and clears position', async () => {
    const api = createApi();
    const router = createRouter({
      platform: 'na1',
      queue: '450',
      tier: 'ALL',
      patch: '14.11',
      position: 'MIDDLE',
    });
    const controller = createChampionStatsFiltersController(api, router);
    await controller.initialize();

    expect(controller.filters.queue).toBe(420);
    expect(controller.filters.position).toBeNull();
    expect(api.getStatsTable).not.toHaveBeenCalled();
    expect(router.replaceQuery).toHaveBeenCalled();
    const replaced = (router.replaceQuery as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      string
    >;
    expect(replaced.queue).toBe('420');
    expect(replaced.position).toBeUndefined();
    expect(controller.rankingQueues.value.some((q) => q.queueId === 450)).toBe(false);
  });

  it('ignores stale out-of-order directory responses', async () => {
    const staleDirectory: ChampionListResponse = {
      champions: [
        {
          championId: 1,
          championKey: 'Annie',
          name: 'Annie',
          title: 'the Dark Child',
          tags: ['Mage'],
          iconUrl: 'https://example.com/annie.png',
        },
      ],
    };
    const latestDirectory: ChampionListResponse = {
      champions: [
        {
          championId: 103,
          championKey: 'Ahri',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage'],
          iconUrl: 'https://example.com/ahri.png',
        },
      ],
    };

    const staleDeferred = deferred<ChampionListResponse>();
    const latestDeferred = deferred<ChampionListResponse>();
    const api = createApi({
      listChampions: vi
        .fn()
        .mockResolvedValueOnce({ champions: [] })
        .mockReturnValueOnce(staleDeferred.promise)
        .mockReturnValueOnce(latestDeferred.promise),
    });
    const router = createRouter({
      platform: 'na1',
      queue: '420',
      tier: 'ALL',
      patch: '14.11',
    });
    const controller = createChampionStatsFiltersController(api, router);
    await controller.initialize();
    expect(api.listChampions).toHaveBeenCalledTimes(1);

    const staleFetch = controller.setSearch('an');
    await vi.waitFor(() => expect(api.listChampions).toHaveBeenCalledTimes(2));

    const latestFetch = controller.setSearch('ahri');
    await vi.waitFor(() => expect(api.listChampions).toHaveBeenCalledTimes(3));

    latestDeferred.resolve(latestDirectory);
    await latestFetch;

    expect(controller.directory.value?.champions.map((c) => c.championKey)).toEqual(['Ahri']);

    staleDeferred.resolve(staleDirectory);
    await staleFetch;

    expect(controller.directory.value?.champions.map((c) => c.championKey)).toEqual(['Ahri']);
  });

  it('keeps displayedResponse.sampleScope while isUpdating', async () => {
    const initial = tableResponse({
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.11',
        queueId: 420,
      },
    });
    const updated = tableResponse({
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'euw1',
        patch: '14.11',
        queueId: 420,
      },
      resolvedFilters: {
        platform: 'euw1',
        patch: '14.11',
        queueId: 420,
        tier: 'ALL',
        position: 'MIDDLE',
      },
    });

    const updateDeferred = deferred<ChampionStatsTableResponse>();
    const api = createApi({
      getStatsTable: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockReturnValueOnce(updateDeferred.promise),
    });
    const router = createRouter({
      platform: 'na1',
      queue: '420',
      tier: 'ALL',
      patch: '14.11',
      position: 'MIDDLE',
    });
    const controller = createChampionStatsFiltersController(api, router);
    await controller.initialize();

    expect(controller.viewState.value.displayedResponse?.sampleScope.platform).toBe('na1');

    const updatePromise = controller.setPlatform('euw1');
    await vi.waitFor(() => expect(controller.viewState.value.isUpdating).toBe(true));
    expect(controller.viewState.value.displayedResponse?.sampleScope.platform).toBe('na1');
    expect(controller.viewState.value.displayedResponse?.sampleScope).toEqual(initial.sampleScope);

    updateDeferred.resolve(updated);
    await updatePromise;

    expect(controller.viewState.value.isUpdating).toBe(false);
    expect(controller.viewState.value.displayedResponse?.sampleScope.platform).toBe('euw1');
  });
});
