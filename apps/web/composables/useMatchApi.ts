import {
  ApiErrorResponseSchema,
  PublicMatchDetailSchema,
  type PublicMatchDetail,
} from '@league-helper/shared';

export class MatchApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'MatchApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function parseApiError(error: unknown): MatchApiError {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const fetchError = error as { statusCode?: number; data?: unknown; message?: string };
    const statusCode = fetchError.statusCode ?? 500;

    if (fetchError.data) {
      const parsed = ApiErrorResponseSchema.safeParse(fetchError.data);
      if (parsed.success) {
        return new MatchApiError(statusCode, parsed.data.error.code, parsed.data.error.message);
      }
    }

    return new MatchApiError(statusCode, 'UNKNOWN', fetchError.message ?? 'Request failed');
  }

  return new MatchApiError(
    500,
    'UNKNOWN',
    error instanceof Error ? error.message : 'Request failed',
  );
}

export function useMatchApi() {
  const config = useRuntimeConfig();
  const apiBase = config.public.apiBase as string;

  async function getMatch(matchId: string): Promise<PublicMatchDetail> {
    try {
      const response = await $fetch(`${apiBase}/api/matches/${matchId}`);
      return PublicMatchDetailSchema.parse(response);
    } catch (error) {
      throw parseApiError(error);
    }
  }

  return { apiBase, getMatch };
}
