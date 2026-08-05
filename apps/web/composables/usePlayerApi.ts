import {
  ApiErrorResponseSchema,
  CursorPageSchema,
  PlayerProfileResponseSchema,
  PlayerRefreshStatusSchema,
  PlayerSearchResponseSchema,
  PublicMatchSummarySchema,
  type PlayerMatchQueueCategory,
  type PlayerProfileResponse,
  type PlayerRefreshRequest,
  type PlayerRefreshStatus,
  type PlayerSearchRequest,
  type PlayerSearchResponse,
  type PublicMatchSummary,
} from '@league-helper/shared';

export class PlayerApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'PlayerApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function parseApiError(error: unknown): PlayerApiError {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const fetchError = error as { statusCode?: number; data?: unknown; message?: string };
    const statusCode = fetchError.statusCode ?? 500;

    if (fetchError.data) {
      const parsed = ApiErrorResponseSchema.safeParse(fetchError.data);
      if (parsed.success) {
        return new PlayerApiError(statusCode, parsed.data.error.code, parsed.data.error.message);
      }
    }

    return new PlayerApiError(statusCode, 'UNKNOWN', fetchError.message ?? 'Request failed');
  }

  return new PlayerApiError(
    500,
    'UNKNOWN',
    error instanceof Error ? error.message : 'Request failed',
  );
}

const MatchesPageSchema = CursorPageSchema(PublicMatchSummarySchema);

export type PlayerMatchesPage = {
  items: PublicMatchSummary[];
  nextCursor: string | null;
};

export type GetMatchesOptions = {
  limit?: number;
  cursor?: string;
  queueId?: number;
  queueCategory?: PlayerMatchQueueCategory;
  includeRemakes?: boolean;
};

export function usePlayerApi() {
  const config = useRuntimeConfig();
  const apiBase = config.public.apiBase as string;

  async function search(body: PlayerSearchRequest): Promise<PlayerSearchResponse> {
    try {
      const response = await $fetch(`${apiBase}/api/players/search`, {
        method: 'POST',
        body,
      });
      return PlayerSearchResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function getProfile(playerId: string): Promise<PlayerProfileResponse> {
    try {
      const response = await $fetch(`${apiBase}/api/players/${playerId}`);
      return PlayerProfileResponseSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function getMatches(
    playerId: string,
    options: GetMatchesOptions = {},
  ): Promise<PlayerMatchesPage> {
    try {
      const response = await $fetch(`${apiBase}/api/players/${playerId}/matches`, {
        query: {
          limit: options.limit ?? 20,
          cursor: options.cursor,
          queueId: options.queueId,
          queueCategory: options.queueCategory === 'all' ? undefined : options.queueCategory,
          includeRemakes: options.includeRemakes ?? true,
        },
      });
      return MatchesPageSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function refresh(
    playerId: string,
    body: PlayerRefreshRequest = { force: false },
  ): Promise<PlayerRefreshStatus> {
    try {
      // Do not send queueId by default — all-queue discovery.
      const response = await $fetch(`${apiBase}/api/players/${playerId}/refresh`, {
        method: 'POST',
        body,
      });
      return PlayerRefreshStatusSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  async function getRefreshStatus(playerId: string): Promise<PlayerRefreshStatus> {
    try {
      const response = await $fetch(`${apiBase}/api/players/${playerId}/refresh-status`);
      return PlayerRefreshStatusSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  return {
    apiBase,
    search,
    getProfile,
    getMatches,
    refresh,
    getRefreshStatus,
  };
}
