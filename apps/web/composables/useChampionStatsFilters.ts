import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import {
  type ChampionListResponse,
  type ChampionRankingPosition,
  type ChampionStatsFilterQueue,
  type ChampionStatsFiltersResponse,
  type ChampionStatsTableResponse,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import type { GetChampionStatsTableOptions, ListChampionsOptions } from './useChampionApi';
import {
  firstQueryValue,
  parseDirectoryFiltersFromQuery,
  resolveDirectoryFilterDefaults,
  type ChampionDirectoryFilterValues,
  type ChampionQueryRecord,
} from '../utils/champion-filter-query';
import { toChampionPublicQuery } from '../utils/champion-links';

export type ChampionPublicFilters = ChampionDirectoryFilterValues;

export type ChampionStatsViewState = {
  displayedResponse: ChampionStatsTableResponse | null;
  pendingFilters: ChampionPublicFilters | null;
  isUpdating: boolean;
};

export type ChampionStatsFiltersApi = {
  getFilters: (signal?: AbortSignal) => Promise<ChampionStatsFiltersResponse>;
  getStatsTable: (options: GetChampionStatsTableOptions) => Promise<ChampionStatsTableResponse>;
  listChampions: (options?: ListChampionsOptions) => Promise<ChampionListResponse>;
};

export type ChampionStatsFiltersRouter = {
  getQuery: () => ChampionQueryRecord;
  replaceQuery: (query: Record<string, string>) => Promise<void>;
};

function publicFiltersEqual(a: ChampionPublicFilters, b: ChampionPublicFilters): boolean {
  return (
    a.platform === b.platform &&
    a.queue === b.queue &&
    a.tier === b.tier &&
    a.position === b.position &&
    a.patch === b.patch &&
    a.search === b.search &&
    a.tag === b.tag
  );
}

function needsCanonicalReplace(
  currentQuery: ChampionQueryRecord,
  resolved: ChampionPublicFilters,
  hadQueueIdAlias: boolean,
): boolean {
  if (hadQueueIdAlias) {
    return true;
  }
  if (firstQueryValue(currentQuery, 'queueId') !== undefined) {
    return true;
  }

  const expected = toChampionPublicQuery(resolved);
  const keys = new Set([...Object.keys(expected), ...Object.keys(currentQuery)]);
  for (const key of keys) {
    if (key === 'queueId') {
      return true;
    }
    const current = firstQueryValue(currentQuery, key) ?? '';
    const want = expected[key] ?? '';
    if (current !== want) {
      // Only force replace when missing required defaults or wrong values for aggregate keys.
      if (
        key === 'platform' ||
        key === 'queue' ||
        key === 'tier' ||
        key === 'patch' ||
        key === 'position' ||
        key === 'search' ||
        key === 'tag'
      ) {
        if (want !== current) {
          return true;
        }
      }
    }
  }
  return false;
}

export type ChampionStatsFiltersController = {
  filters: ChampionPublicFilters;
  filtersMeta: Ref<ChampionStatsFiltersResponse | null>;
  filtersResolving: Ref<boolean>;
  filtersReady: Ref<boolean>;
  filtersError: Ref<string | null>;
  viewState: Ref<ChampionStatsViewState>;
  rankingError: Ref<string | null>;
  directory: Ref<ChampionListResponse | null>;
  directoryError: Ref<string | null>;
  directoryPending: Ref<boolean>;
  rankingPending: Ref<boolean>;
  selectedQueueSupportsPositions: ComputedRef<boolean>;
  primaryTiers: ComputedRef<ChampionStatsTierFilter[]>;
  rankingQueues: ComputedRef<ChampionStatsFilterQueue[]>;
  initialize: () => Promise<void>;
  refreshRanking: () => Promise<void>;
  setPlatform: (platform: PlatformRoute) => Promise<void>;
  setQueue: (queue: number) => Promise<void>;
  setTier: (tier: ChampionStatsTierFilter) => Promise<void>;
  setPosition: (position: ChampionRankingPosition | null) => Promise<void>;
  setPatch: (patch: string) => Promise<void>;
  setSearch: (search: string | null) => Promise<void>;
  setTag: (tag: string | null) => Promise<void>;
  fetchDirectory: () => Promise<void>;
};

/**
 * Filter lifecycle + ranking view-state controller.
 * URL is authoritative; no localStorage.
 */
export function createChampionStatsFiltersController(
  api: ChampionStatsFiltersApi,
  router: ChampionStatsFiltersRouter,
): ChampionStatsFiltersController {
  const filtersResolving = ref(true);
  const filtersReady = ref(false);
  const filtersMeta = ref<ChampionStatsFiltersResponse | null>(null);
  const filtersError = ref<string | null>(null);
  const rankingError = ref<string | null>(null);
  const directory = ref<ChampionListResponse | null>(null);
  const directoryError = ref<string | null>(null);
  const directoryPending = ref(false);
  const rankingPending = ref(false);

  const filters = reactive<ChampionPublicFilters>({
    platform: null,
    queue: null,
    tier: null,
    position: null,
    patch: null,
    search: null,
    tag: null,
  });

  const viewState: Ref<ChampionStatsViewState> = ref({
    displayedResponse: null,
    pendingFilters: null,
    isUpdating: false,
  });

  let rankingRequestId = 0;
  let rankingAbort: AbortController | null = null;
  let directoryRequestId = 0;
  let directoryAbort: AbortController | null = null;
  let initialized = false;
  let replacingUrl = false;

  function assignFilters(next: ChampionPublicFilters): void {
    filters.platform = next.platform;
    filters.queue = next.queue;
    filters.tier = next.tier;
    filters.position = next.position;
    filters.patch = next.patch;
    filters.search = next.search;
    filters.tag = next.tag;
  }

  function snapshotFilters(): ChampionPublicFilters {
    return {
      platform: filters.platform,
      queue: filters.queue,
      tier: filters.tier,
      position: filters.position,
      patch: filters.patch,
      search: filters.search,
      tag: filters.tag,
    };
  }

  async function syncUrl(next: ChampionPublicFilters): Promise<void> {
    replacingUrl = true;
    try {
      await router.replaceQuery(toChampionPublicQuery(next));
    } finally {
      replacingUrl = false;
    }
  }

  async function fetchDirectory(): Promise<void> {
    const requestId = ++directoryRequestId;
    directoryAbort?.abort();
    directoryAbort = new AbortController();
    const signal = directoryAbort.signal;

    directoryPending.value = true;
    directoryError.value = null;
    try {
      const response = await api.listChampions({
        search: filters.search ?? undefined,
        tag: filters.tag ?? undefined,
        limit: 200,
        offset: 0,
        signal,
      });
      if (requestId !== directoryRequestId) {
        return;
      }
      directory.value = response;
      directoryError.value = null;
      directoryPending.value = false;
    } catch {
      if (signal.aborted || requestId !== directoryRequestId) {
        return;
      }
      directoryError.value = 'Unable to load champion directory.';
      directoryPending.value = false;
    }
  }

  function queueSupportsStandardPositions(queueId: number | null): boolean {
    if (queueId === null || !filtersMeta.value) {
      return false;
    }
    return (
      filtersMeta.value.availableQueues.find((q) => q.queueId === queueId)
        ?.supportsStandardPositions ?? false
    );
  }

  async function fetchRanking(): Promise<void> {
    if (
      !filtersReady.value ||
      !filters.position ||
      !filters.platform ||
      filters.queue === null ||
      !queueSupportsStandardPositions(filters.queue)
    ) {
      rankingPending.value = false;
      return;
    }

    const requestId = ++rankingRequestId;
    rankingAbort?.abort();
    rankingAbort = new AbortController();
    const signal = rankingAbort.signal;

    const pending = snapshotFilters();
    const hadDisplay = viewState.value.displayedResponse !== null;
    rankingPending.value = true;
    viewState.value = {
      displayedResponse: viewState.value.displayedResponse,
      pendingFilters: pending,
      isUpdating: hadDisplay,
    };
    rankingError.value = null;

    try {
      const response = await api.getStatsTable({
        position: filters.position,
        platform: filters.platform,
        queue: filters.queue,
        tier: filters.tier ?? 'ALL',
        patch: filters.patch ?? undefined,
        offset: 0,
        limit: 50,
        signal,
      });

      if (requestId !== rankingRequestId) {
        return;
      }

      viewState.value = {
        displayedResponse: response,
        pendingFilters: null,
        isUpdating: false,
      };
      rankingError.value = null;
      rankingPending.value = false;
    } catch (error) {
      if (signal.aborted || requestId !== rankingRequestId) {
        return;
      }
      // Keep previous rows + warning.
      viewState.value = {
        displayedResponse: viewState.value.displayedResponse,
        pendingFilters: null,
        isUpdating: false,
      };
      rankingError.value =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to load collected sample ranking.';
      rankingPending.value = false;
    }
  }

  async function refreshRanking(): Promise<void> {
    await fetchRanking();
  }

  async function initialize(): Promise<void> {
    if (initialized) {
      return;
    }
    initialized = true;
    filtersResolving.value = true;
    filtersReady.value = false;
    filtersError.value = null;

    try {
      const meta = await api.getFilters();
      filtersMeta.value = meta;

      const { filters: parsed, hadQueueIdAlias } = parseDirectoryFiltersFromQuery(router.getQuery());
      const resolved = resolveDirectoryFilterDefaults(parsed, meta);
      // Ranking selector only offers supportsStandardPositions queues — remap others
      // so the <select> value always matches an option (URL still gets one replace).
      if (!queueSupportsStandardPositions(resolved.queue)) {
        resolved.queue = meta.defaultQueueId;
        resolved.position = null;
      }
      assignFilters(resolved);

      const query = router.getQuery();
      if (needsCanonicalReplace(query, resolved, hadQueueIdAlias)) {
        await syncUrl(resolved);
      }

      filtersReady.value = true;
      filtersResolving.value = false;

      const tasks: Promise<void>[] = [fetchDirectory()];
      if (resolved.position) {
        rankingPending.value = true;
        tasks.push(fetchRanking());
      }
      await Promise.all(tasks);
    } catch {
      filtersError.value = 'Unable to load champion filters.';
      filtersResolving.value = false;
      filtersReady.value = false;
    }
  }

  async function applyFilterPatch(
    patch: Partial<ChampionPublicFilters>,
    options: { refreshDirectory?: boolean; refreshRanking?: boolean } = {},
  ): Promise<void> {
    if (!filtersReady.value || replacingUrl) {
      return;
    }

    const refreshRanking = options.refreshRanking !== false;
    const next: ChampionPublicFilters = {
      ...snapshotFilters(),
      ...patch,
    };

    if (publicFiltersEqual(snapshotFilters(), next)) {
      return;
    }

    assignFilters(next);

    if (refreshRanking && next.position && viewState.value.displayedResponse) {
      viewState.value = {
        displayedResponse: viewState.value.displayedResponse,
        pendingFilters: next,
        isUpdating: true,
      };
    }

    await syncUrl(next);

    if (options.refreshDirectory) {
      await fetchDirectory();
    }

    if (!refreshRanking) {
      return;
    }

    if (next.position && queueSupportsStandardPositions(next.queue)) {
      await fetchRanking();
    } else {
      // Clear ranking display when position removed or queue cannot rank by role.
      rankingRequestId += 1;
      rankingAbort?.abort();
      rankingPending.value = false;
      viewState.value = {
        displayedResponse: null,
        pendingFilters: null,
        isUpdating: false,
      };
      rankingError.value = null;
    }
  }

  async function setPlatform(platform: PlatformRoute): Promise<void> {
    await applyFilterPatch({ platform });
  }

  async function setQueue(queue: number): Promise<void> {
    // Non-role queues are not offered in the ranking selector; ignore / remap away.
    if (!queueSupportsStandardPositions(queue)) {
      const fallback = filtersMeta.value?.defaultQueueId;
      if (fallback === undefined || fallback === filters.queue) {
        if (filters.position !== null) {
          await applyFilterPatch({ position: null });
        }
        return;
      }
      await applyFilterPatch({ queue: fallback, position: null });
      return;
    }
    await applyFilterPatch({ queue });
  }

  async function setTier(tier: ChampionStatsTierFilter): Promise<void> {
    await applyFilterPatch({ tier });
  }

  async function setPosition(position: ChampionRankingPosition | null): Promise<void> {
    await applyFilterPatch({ position });
  }

  async function setPatch(patch: string): Promise<void> {
    await applyFilterPatch({ patch });
  }

  async function setSearch(search: string | null): Promise<void> {
    await applyFilterPatch(
      { search: search?.trim() || null },
      { refreshDirectory: true, refreshRanking: false },
    );
  }

  async function setTag(tag: string | null): Promise<void> {
    await applyFilterPatch(
      { tag: tag?.trim() || null },
      { refreshDirectory: true, refreshRanking: false },
    );
  }

  const selectedQueueSupportsPositions = computed(() =>
    queueSupportsStandardPositions(filters.queue),
  );

  const primaryTiers = computed(() => {
    const tiers = filtersMeta.value?.availableTiers ?? [];
    return tiers.filter((tier) => tier !== 'UNKNOWN');
  });

  const rankingQueues = computed(() => {
    const queues = filtersMeta.value?.availableQueues ?? [];
    return queues.filter((q) => q.supportsStandardPositions);
  });

  return {
    filters,
    filtersMeta,
    filtersResolving,
    filtersReady,
    filtersError,
    viewState,
    rankingError,
    directory,
    directoryError,
    directoryPending,
    rankingPending,
    selectedQueueSupportsPositions,
    primaryTiers,
    rankingQueues,
    initialize,
    refreshRanking,
    setPlatform,
    setQueue,
    setTier,
    setPosition,
    setPatch,
    setSearch,
    setTag,
    fetchDirectory,
  };
}

export function useChampionStatsFilters(): ChampionStatsFiltersController {
  const route = useRoute();
  const router = useRouter();
  const api = useChampionApi();

  return createChampionStatsFiltersController(api, {
    getQuery: () => route.query as ChampionQueryRecord,
    replaceQuery: async (query) => {
      await router.replace({ path: '/champions', query });
    },
  });
}
