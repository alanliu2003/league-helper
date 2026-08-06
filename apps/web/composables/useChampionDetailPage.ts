import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import {
  type ChampionDetail,
  type ChampionPositionBreakdownEntry,
  type ChampionRankingPosition,
  type ChampionStatsEmptyReason,
  type ChampionStatsFiltersResponse,
  type ChampionStatsFreshness,
  type ChampionStatsResponse,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import {
  firstQueryValue,
  parseAggregateFiltersFromQuery,
  resolveAggregateFilterDefaults,
  type ChampionAggregateFilterValues,
  type ChampionQueryRecord,
} from '../utils/champion-filter-query';
import { buildChampionPath, toChampionPublicQuery } from '../utils/champion-links';
import { ChampionApiError, type GetChampionStatsOptions } from './useChampionApi';

export type ChampionDetailAggregateFilters = ChampionAggregateFilterValues;

export type ChampionDetailPageApi = {
  getFilters: (signal?: AbortSignal) => Promise<ChampionStatsFiltersResponse>;
  getChampionDetail: (
    championKey: string,
    signal?: AbortSignal,
  ) => Promise<{ champion: ChampionDetail; staticDataPatch?: string; staticDataVersion?: string }>;
  getChampionStats: (
    championKey: string,
    options: GetChampionStatsOptions,
  ) => Promise<ChampionStatsResponse>;
};

export type ChampionDetailPageRouter = {
  getQuery: () => ChampionQueryRecord;
  /** Replace path + query without adding a history entry (canonicalization / filter sync). */
  replaceLocation: (path: string, query: Record<string, string>) => Promise<void>;
};

export type ChampionDetailPageController = {
  filters: ChampionDetailAggregateFilters;
  filtersMeta: Ref<ChampionStatsFiltersResponse | null>;
  filtersResolving: Ref<boolean>;
  filtersReady: Ref<boolean>;
  filtersError: Ref<string | null>;
  notFound: Ref<boolean>;
  champion: Ref<ChampionDetail | null>;
  metadataPending: Ref<boolean>;
  metadataError: Ref<string | null>;
  statsResponse: Ref<ChampionStatsResponse | null>;
  statsPending: Ref<boolean>;
  statsError: Ref<string | null>;
  hasExactStats: ComputedRef<boolean>;
  emptyReason: ComputedRef<ChampionStatsEmptyReason | null>;
  positionBreakdown: ComputedRef<ChampionPositionBreakdownEntry[]>;
  freshness: ComputedRef<ChampionStatsFreshness | null>;
  primaryTiers: ComputedRef<ChampionStatsTierFilter[]>;
  rankingQueues: ComputedRef<NonNullable<ChampionStatsFiltersResponse['availableQueues']>>;
  selectedQueueSupportsPositions: ComputedRef<boolean>;
  initialize: () => Promise<void>;
  /** Reset and load for a new route key (Nuxt may reuse the page component). */
  reload: () => Promise<void>;
  setPlatform: (platform: PlatformRoute) => Promise<void>;
  setQueue: (queue: number) => Promise<void>;
  setTier: (tier: ChampionStatsTierFilter) => Promise<void>;
  setPosition: (position: ChampionRankingPosition | null) => Promise<void>;
  setPatch: (patch: string) => Promise<void>;
  refreshStats: () => Promise<void>;
};

/** Numeric-only keys must never be treated as championId routes. */
export function isNumericChampionRouteKey(key: string): boolean {
  return /^\d+$/.test(key.trim());
}

function aggregateFiltersEqual(
  a: ChampionDetailAggregateFilters,
  b: ChampionDetailAggregateFilters,
): boolean {
  return (
    a.platform === b.platform &&
    a.queue === b.queue &&
    a.tier === b.tier &&
    a.position === b.position &&
    a.patch === b.patch
  );
}

function toAggregateQuery(filters: ChampionDetailAggregateFilters): Record<string, string> {
  // Never include directory-only search/tag on detail URLs.
  return toChampionPublicQuery({
    platform: filters.platform,
    queue: filters.queue,
    tier: filters.tier,
    position: filters.position,
    patch: filters.patch,
  });
}

function needsQueryCanonicalReplace(
  currentQuery: ChampionQueryRecord,
  resolved: ChampionDetailAggregateFilters,
  hadQueueIdAlias: boolean,
  hadDirectoryOnlyParams: boolean,
): boolean {
  if (hadQueueIdAlias || hadDirectoryOnlyParams) {
    return true;
  }
  if (firstQueryValue(currentQuery, 'queueId') !== undefined) {
    return true;
  }

  const expected = toAggregateQuery(resolved);
  const keys = new Set([
    ...Object.keys(expected),
    ...Object.keys(currentQuery).filter((k) => k !== 'search' && k !== 'tag' && k !== 'queueId'),
  ]);
  for (const key of keys) {
    const current = firstQueryValue(currentQuery, key) ?? '';
    const want = expected[key] ?? '';
    if (current !== want) {
      return true;
    }
  }
  return false;
}

/**
 * Detail page controller: independent metadata / stats UI states, URL-authoritative
 * aggregate filters, canonical championKey routes.
 */
export function createChampionDetailPageController(
  getRouteKey: () => string,
  api: ChampionDetailPageApi,
  router: ChampionDetailPageRouter,
): ChampionDetailPageController {
  const filtersResolving = ref(true);
  const filtersReady = ref(false);
  const filtersMeta = ref<ChampionStatsFiltersResponse | null>(null);
  const filtersError = ref<string | null>(null);

  const notFound = ref(false);
  const champion = ref<ChampionDetail | null>(null);
  const metadataPending = ref(false);
  const metadataError = ref<string | null>(null);

  const statsResponse = ref<ChampionStatsResponse | null>(null);
  const statsPending = ref(false);
  const statsError = ref<string | null>(null);

  const filters = reactive<ChampionDetailAggregateFilters>({
    platform: null,
    queue: null,
    tier: null,
    position: null,
    patch: null,
  });

  let initialized = false;
  let initializeGeneration = 0;
  let statsRequestId = 0;
  let statsAbort: AbortController | null = null;
  let metadataAbort: AbortController | null = null;
  /** Canonical key after metadata resolve; used for subsequent stats/filter fetches. */
  let resolvedChampionKey: string | null = null;

  function assignFilters(next: ChampionDetailAggregateFilters): void {
    filters.platform = next.platform;
    filters.queue = next.queue;
    filters.tier = next.tier;
    filters.position = next.position;
    filters.patch = next.patch;
  }

  function snapshotFilters(): ChampionDetailAggregateFilters {
    return {
      platform: filters.platform,
      queue: filters.queue,
      tier: filters.tier,
      position: filters.position,
      patch: filters.patch,
    };
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

  function isCurrentGeneration(generation: number): boolean {
    return generation === initializeGeneration;
  }

  async function syncLocation(
    championKey: string,
    next: ChampionDetailAggregateFilters,
  ): Promise<void> {
    const path =
      buildChampionPath(championKey).split('?')[0] ??
      `/champions/${encodeURIComponent(championKey)}`;
    await router.replaceLocation(path, toAggregateQuery(next));
  }

  async function fetchMetadata(
    routeKey: string,
    generation: number,
  ): Promise<'ok' | 'not_found' | 'error'> {
    metadataAbort?.abort();
    metadataAbort = new AbortController();
    const signal = metadataAbort.signal;

    metadataPending.value = true;
    metadataError.value = null;

    try {
      const response = await api.getChampionDetail(routeKey, signal);
      if (!isCurrentGeneration(generation) || signal.aborted) {
        return 'error';
      }
      champion.value = response.champion;
      resolvedChampionKey = response.champion.championKey;
      metadataPending.value = false;
      return 'ok';
    } catch (error) {
      if (!isCurrentGeneration(generation) || signal.aborted) {
        return 'error';
      }
      metadataPending.value = false;
      if (error instanceof ChampionApiError && error.code === 'CHAMPION_NOT_FOUND') {
        notFound.value = true;
        champion.value = null;
        return 'not_found';
      }
      metadataError.value =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to load champion details.';
      return 'error';
    }
  }

  async function fetchStats(generation?: number): Promise<void> {
    const activeGeneration = generation ?? initializeGeneration;
    const key = resolvedChampionKey;
    if (
      !isCurrentGeneration(activeGeneration) ||
      !filtersReady.value ||
      !key ||
      !filters.platform ||
      filters.queue === null ||
      notFound.value
    ) {
      statsPending.value = false;
      return;
    }

    const requestId = ++statsRequestId;
    statsAbort?.abort();
    statsAbort = new AbortController();
    const signal = statsAbort.signal;

    // Clear immediately so prior exact metrics cannot flash under new filters/position.
    statsResponse.value = null;
    statsPending.value = true;
    statsError.value = null;

    try {
      const options: GetChampionStatsOptions = {
        platform: filters.platform,
        queue: filters.queue,
        tier: filters.tier ?? 'ALL',
        patch: filters.patch ?? undefined,
        signal,
      };
      // Only send position when selected — never invent ALL-position exact stats.
      if (filters.position) {
        options.position = filters.position;
      }

      const response = await api.getChampionStats(key, options);
      if (
        !isCurrentGeneration(activeGeneration) ||
        requestId !== statsRequestId ||
        signal.aborted
      ) {
        return;
      }
      statsResponse.value = response;
      statsError.value = null;
      statsPending.value = false;
    } catch (error) {
      if (
        !isCurrentGeneration(activeGeneration) ||
        signal.aborted ||
        requestId !== statsRequestId
      ) {
        return;
      }
      if (error instanceof ChampionApiError && error.code === 'CHAMPION_NOT_FOUND') {
        // Stats not-found after metadata success is unexpected; treat as stats error.
        statsError.value = 'Unable to load champion statistics.';
        statsPending.value = false;
        return;
      }
      statsError.value =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to load champion statistics.';
      statsPending.value = false;
    }
  }

  function resetLoadState(): void {
    initializeGeneration += 1;
    statsRequestId += 1;
    statsAbort?.abort();
    metadataAbort?.abort();
    notFound.value = false;
    champion.value = null;
    metadataPending.value = false;
    metadataError.value = null;
    statsResponse.value = null;
    statsPending.value = false;
    statsError.value = null;
    resolvedChampionKey = null;
  }

  async function initialize(): Promise<void> {
    if (initialized) {
      return;
    }
    initialized = true;
    const generation = initializeGeneration;

    const routeKey = getRouteKey().trim();
    if (!routeKey || isNumericChampionRouteKey(routeKey)) {
      notFound.value = true;
      filtersResolving.value = false;
      filtersReady.value = false;
      return;
    }

    filtersResolving.value = true;
    filtersReady.value = false;
    filtersError.value = null;
    notFound.value = false;

    try {
      const meta = await api.getFilters();
      if (!isCurrentGeneration(generation)) {
        return;
      }
      filtersMeta.value = meta;

      const { filters: parsed, hadQueueIdAlias, hadDirectoryOnlyParams } =
        parseAggregateFiltersFromQuery(router.getQuery());
      const resolved = resolveAggregateFilterDefaults(parsed, meta);
      if (!queueSupportsStandardPositions(resolved.queue)) {
        resolved.queue = meta.defaultQueueId;
        resolved.position = null;
      }
      assignFilters(resolved);

      filtersReady.value = true;
      filtersResolving.value = false;

      const metaResult = await fetchMetadata(routeKey, generation);
      if (!isCurrentGeneration(generation) || metaResult !== 'ok') {
        return;
      }

      const canonicalKey = resolvedChampionKey ?? routeKey;
      const needsKeyReplace = canonicalKey !== routeKey;
      const needsQueryReplace = needsQueryCanonicalReplace(
        router.getQuery(),
        resolved,
        hadQueueIdAlias,
        hadDirectoryOnlyParams,
      );

      if (needsKeyReplace || needsQueryReplace) {
        await syncLocation(canonicalKey, resolved);
        if (!isCurrentGeneration(generation)) {
          return;
        }
      }

      await fetchStats(generation);
    } catch {
      if (!isCurrentGeneration(generation)) {
        return;
      }
      filtersError.value = 'Unable to load champion filters.';
      filtersResolving.value = false;
      filtersReady.value = false;
    }
  }

  async function reload(): Promise<void> {
    initialized = false;
    resetLoadState();
    await initialize();
  }

  async function applyFilterPatch(patch: Partial<ChampionDetailAggregateFilters>): Promise<void> {
    // Do not gate on replacingUrl: detail has no URL→filter watcher, and blocking
    // here drops rapid position changes while a prior syncLocation is in flight.
    if (!filtersReady.value || notFound.value) {
      return;
    }

    const next: ChampionDetailAggregateFilters = {
      ...snapshotFilters(),
      ...patch,
    };

    if (aggregateFiltersEqual(snapshotFilters(), next)) {
      return;
    }

    assignFilters(next);
    // Drop stale exact metrics as soon as filters change (before URL sync await).
    statsResponse.value = null;
    statsPending.value = true;
    statsError.value = null;

    const key = resolvedChampionKey ?? getRouteKey();
    const generation = initializeGeneration;
    await syncLocation(key, next);
    if (!isCurrentGeneration(generation)) {
      return;
    }
    await fetchStats(generation);
  }

  async function setPlatform(platform: PlatformRoute): Promise<void> {
    await applyFilterPatch({ platform });
  }

  async function setQueue(queue: number): Promise<void> {
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

  async function refreshStats(): Promise<void> {
    await fetchStats();
  }

  const hasExactStats = computed(() => statsResponse.value?.stats != null);

  const emptyReason = computed(() => statsResponse.value?.emptyReason ?? null);

  const positionBreakdown = computed(() => statsResponse.value?.positionBreakdown ?? []);

  const freshness = computed(() => statsResponse.value?.freshness ?? null);

  const primaryTiers = computed(() => {
    const tiers = filtersMeta.value?.availableTiers ?? [];
    return tiers.filter((tier) => tier !== 'UNKNOWN');
  });

  const rankingQueues = computed(() => {
    const queues = filtersMeta.value?.availableQueues ?? [];
    return queues.filter((q) => q.supportsStandardPositions);
  });

  const selectedQueueSupportsPositions = computed(() =>
    queueSupportsStandardPositions(filters.queue),
  );

  return {
    filters,
    filtersMeta,
    filtersResolving,
    filtersReady,
    filtersError,
    notFound,
    champion,
    metadataPending,
    metadataError,
    statsResponse,
    statsPending,
    statsError,
    hasExactStats,
    emptyReason,
    positionBreakdown,
    freshness,
    primaryTiers,
    rankingQueues,
    selectedQueueSupportsPositions,
    initialize,
    reload,
    setPlatform,
    setQueue,
    setTier,
    setPosition,
    setPatch,
    refreshStats,
  };
}

export function useChampionDetailPage(getRouteKey: () => string): ChampionDetailPageController {
  const route = useRoute();
  const router = useRouter();
  const api = useChampionApi();

  return createChampionDetailPageController(getRouteKey, api, {
    getQuery: () => route.query as ChampionQueryRecord,
    replaceLocation: async (path, query) => {
      await router.replace({ path, query });
    },
  });
}
