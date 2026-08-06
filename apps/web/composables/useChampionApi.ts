import {
  ApiErrorResponseSchema,
  ChampionDetailResponseSchema,
  ChampionListResponseSchema,
  ChampionStatsFiltersResponseSchema,
  ChampionStatsResponseSchema,
  ChampionStatsTableResponseSchema,
  type ChampionDetailResponse,
  type ChampionListResponse,
  type ChampionRankingPosition,
  type ChampionStatsFiltersResponse,
  type ChampionStatsResponse,
  type ChampionStatsSortBy,
  type ChampionStatsSortDirection,
  type ChampionStatsTableResponse,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';

export class ChampionApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ChampionApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function parseApiError(error: unknown): ChampionApiError {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const fetchError = error as { statusCode?: number; data?: unknown; message?: string };
    const statusCode = fetchError.statusCode ?? 500;

    if (fetchError.data) {
      const parsed = ApiErrorResponseSchema.safeParse(fetchError.data);
      if (parsed.success) {
        return new ChampionApiError(statusCode, parsed.data.error.code, parsed.data.error.message);
      }
    }

    return new ChampionApiError(statusCode, 'UNKNOWN', fetchError.message ?? 'Request failed');
  }

  return new ChampionApiError(
    500,
    'UNKNOWN',
    error instanceof Error ? error.message : 'Request failed',
  );
}

export type ListChampionsOptions = {
  search?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

/**
 * Public filter naming uses `queue`. API boundary maps to `queueId`.
 */
export type GetChampionStatsTableOptions = {
  position: ChampionRankingPosition;
  platform: PlatformRoute;
  /** Public queue id — sent to API as `queueId`. */
  queue: number;
  tier?: ChampionStatsTierFilter;
  patch?: string;
  sortBy?: ChampionStatsSortBy;
  sortDirection?: ChampionStatsSortDirection;
  limit?: number;
  offset?: number;
  includeInsufficient?: boolean;
  minimumSample?: number;
  signal?: AbortSignal;
};

/**
 * Single-champion stats. Public filter naming uses `queue`; API maps to `queueId`.
 * Omit `position` for metadata + five-role breakdown without inventing ALL-position exact stats.
 */
export type GetChampionStatsOptions = {
  platform: PlatformRoute;
  /** Public queue id — sent to API as `queueId`. */
  queue: number;
  tier?: ChampionStatsTierFilter;
  position?: ChampionRankingPosition;
  patch?: string;
  includeInsufficient?: boolean;
  minimumSample?: number;
  signal?: AbortSignal;
};

export function useChampionApi() {
  const config = useRuntimeConfig();
  const apiBase = config.public.apiBase as string;

  async function getFilters(signal?: AbortSignal): Promise<ChampionStatsFiltersResponse> {
    try {
      const response = await $fetch(`${apiBase}/api/champion-stats/filters`, { signal });
      return ChampionStatsFiltersResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function listChampions(options: ListChampionsOptions = {}): Promise<ChampionListResponse> {
    try {
      const response = await $fetch(`${apiBase}/api/champions`, {
        query: {
          search: options.search || undefined,
          tag: options.tag || undefined,
          limit: options.limit,
          offset: options.offset,
        },
        signal: options.signal,
      });
      return ChampionListResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function getStatsTable(
    options: GetChampionStatsTableOptions,
  ): Promise<ChampionStatsTableResponse> {
    try {
      const response = await $fetch(`${apiBase}/api/champion-stats`, {
        query: {
          position: options.position,
          platform: options.platform,
          // Map public `queue` → API `queueId` at the boundary only.
          queueId: options.queue,
          tier: options.tier,
          patch: options.patch,
          sortBy: options.sortBy,
          sortDirection: options.sortDirection,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          includeInsufficient: options.includeInsufficient,
          minimumSample: options.minimumSample,
        },
        signal: options.signal,
      });
      return ChampionStatsTableResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function getChampionDetail(
    championKey: string,
    signal?: AbortSignal,
  ): Promise<ChampionDetailResponse> {
    try {
      const response = await $fetch(
        `${apiBase}/api/champions/${encodeURIComponent(championKey)}`,
        { signal },
      );
      return ChampionDetailResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function getChampionStats(
    championKey: string,
    options: GetChampionStatsOptions,
  ): Promise<ChampionStatsResponse> {
    try {
      const response = await $fetch(
        `${apiBase}/api/champions/${encodeURIComponent(championKey)}/stats`,
        {
          query: {
            platform: options.platform,
            // Map public `queue` → API `queueId` at the boundary only.
            queueId: options.queue,
            tier: options.tier,
            position: options.position,
            patch: options.patch,
            includeInsufficient: options.includeInsufficient,
            minimumSample: options.minimumSample,
          },
          signal: options.signal,
        },
      );
      return ChampionStatsResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  return {
    apiBase,
    getFilters,
    listChampions,
    getStatsTable,
    getChampionDetail,
    getChampionStats,
  };
}

export type ChampionApi = ReturnType<typeof useChampionApi>;
