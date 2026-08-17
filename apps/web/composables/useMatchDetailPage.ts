import { computed, ref, type Ref } from 'vue';
import { z } from 'zod';
import type { PublicMatchDetail } from '@league-helper/shared';
import { MatchApiError } from './useMatchApi';

const UuidSchema = z.string().uuid();

export type MatchDetailPageApi = {
  getMatch: (matchId: string) => Promise<PublicMatchDetail>;
};

export type MatchDetailPageController = {
  matchId: Ref<string>;
  originPlayerId: Ref<string | null>;
  detail: Ref<PublicMatchDetail | null>;
  pending: Ref<boolean>;
  notFound: Ref<boolean>;
  errorMessage: Ref<string | null>;
  load: () => Promise<void>;
  reload: () => Promise<void>;
};

function parseUuid(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? '';
  const parsed = UuidSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

export function createMatchDetailPageController(
  getMatchId: () => string,
  getPlayerQuery: () => string | undefined,
  api: MatchDetailPageApi,
): MatchDetailPageController {
  const matchId = ref('');
  const originPlayerId = ref<string | null>(null);
  const detail = ref<PublicMatchDetail | null>(null);
  const pending = ref(false);
  const notFound = ref(false);
  const errorMessage = ref<string | null>(null);
  let requestId = 0;

  async function load(): Promise<void> {
    const currentId = getMatchId().trim();
    matchId.value = currentId;
    originPlayerId.value = parseUuid(getPlayerQuery() ?? null);
    const parsedId = parseUuid(currentId);
    const currentRequest = ++requestId;

    if (!parsedId) {
      detail.value = null;
      pending.value = false;
      notFound.value = true;
      errorMessage.value = null;
      return;
    }

    pending.value = true;
    notFound.value = false;
    errorMessage.value = null;

    try {
      const response = await api.getMatch(parsedId);
      if (currentRequest !== requestId) {
        return;
      }
      detail.value = response;
      pending.value = false;
    } catch (error) {
      if (currentRequest !== requestId) {
        return;
      }
      pending.value = false;
      detail.value = null;
      if (
        error instanceof MatchApiError &&
        (error.statusCode === 404 || error.statusCode === 400 || error.code === 'RESOURCE_NOT_FOUND')
      ) {
        notFound.value = true;
        errorMessage.value = null;
        return;
      }
      errorMessage.value =
        error instanceof Error && error.message ? error.message : 'Unable to load match details.';
    }
  }

  return {
    matchId,
    originPlayerId,
    detail,
    pending,
    notFound,
    errorMessage,
    load,
    reload: load,
  };
}

export function useMatchDetailPage(): MatchDetailPageController {
  const route = useRoute();
  const api = useMatchApi();
  const playerQuery = computed(() => {
    const value = route.query.player;
    return Array.isArray(value) ? value[0] : value;
  });

  return createMatchDetailPageController(
    () => String(route.params.matchId ?? ''),
    () => playerQuery.value,
    api,
  );
}
