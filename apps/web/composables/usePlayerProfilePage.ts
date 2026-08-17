import type {
  PlayerMatchQueueCategory,
  PlayerPlaystyleResponse,
  PlayerProfileResponse,
  PlayerRefreshStatus,
  PublicMatchSummary,
  PublicMasterySummary,
  PublicPlayer,
  PublicRankSummary,
} from '@league-helper/shared';
import { ref } from 'vue';
import { PlayerApiError, usePlayerApi } from './usePlayerApi';
import {
  PLAYER_MATCH_POLL_INTERVAL_MS,
  shouldPollMatchProgress,
  shouldStopPollingForTimeout,
} from '../utils/player-match-polling';
import { nextAiInsightPollDelayMs, shouldContinueAiInsightPoll } from '../utils/ai-insight-poll';

export type PlayerProfilePageApi = ReturnType<typeof usePlayerApi>;

/**
 * Separate profile / matches / refresh-status state so refresh metadata never
 * overwrites stored match cards with an empty list.
 */
export function createPlayerProfilePageController(
  playerId: () => string,
  api: PlayerProfilePageApi,
) {
  const profileMeta = ref<{
    player: PublicPlayer;
    ranks: PublicRankSummary[];
    mastery: PublicMasterySummary[];
  } | null>(null);
  const matches = ref<PublicMatchSummary[]>([]);
  const refreshStatus = ref<PlayerRefreshStatus | null>(null);
  const pending = ref(true);
  const loadError = ref<string | null>(null);
  const matchesError = ref<string | null>(null);
  const refreshing = ref(false);
  const refreshMessage = ref<string | null>(null);
  const refreshMessageClass = ref('text-[var(--lh-muted)]');
  const isPolling = ref(false);
  const pollTimedOut = ref(false);
  const queueCategory = ref<PlayerMatchQueueCategory>('all');
  const matchesLoading = ref(false);
  const playstyle = ref<PlayerPlaystyleResponse | null>(null);
  const playstyleError = ref<string | null>(null);
  const playstylePending = ref(false);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollStartedAt = 0;
  let lastCompletedMatchCount: number | null = null;
  let playstylePollTimers: ReturnType<typeof setTimeout>[] = [];
  let playstyleRequestId = 0;

  function applyProfile(profile: PlayerProfileResponse): void {
    profileMeta.value = {
      player: profile.player,
      ranks: profile.ranks,
      mastery: profile.mastery,
    };
    // Initial load may seed matches from profile; later updates use getMatches.
    if (matches.value.length === 0) {
      matches.value = profile.matches;
    }
    refreshStatus.value = profile.refresh;
    lastCompletedMatchCount = profile.refresh.completedMatchCount;
  }

  function stopMatchPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    isPolling.value = false;
  }

  function stopPlaystylePolling(): void {
    for (const timer of playstylePollTimers) {
      clearTimeout(timer);
    }
    playstylePollTimers = [];
  }

  function stopPolling(): void {
    stopMatchPolling();
    stopPlaystylePolling();
  }

  async function fetchMatches(options: { preserveOnError?: boolean } = {}): Promise<void> {
    const preserveOnError = options.preserveOnError ?? true;
    matchesLoading.value = true;
    try {
      const page = await api.getMatches(playerId(), {
        limit: 20,
        includeRemakes: true,
        queueCategory: queueCategory.value,
      });
      matches.value = page.items;
      matchesError.value = null;
    } catch {
      if (!preserveOnError) {
        matches.value = [];
      }
      matchesError.value = 'Unable to load match history.';
    } finally {
      matchesLoading.value = false;
    }
  }

  async function pollOnce(): Promise<void> {
    if (pollStartedAt > 0 && shouldStopPollingForTimeout(pollStartedAt)) {
      stopMatchPolling();
      pollTimedOut.value = true;
      return;
    }

    try {
      const status = await api.getRefreshStatus(playerId());
      refreshStatus.value = status;

      const completedIncreased =
        lastCompletedMatchCount != null && status.completedMatchCount > lastCompletedMatchCount;
      lastCompletedMatchCount = status.completedMatchCount;

      if (completedIncreased || matches.value.length === 0) {
        await fetchMatches({ preserveOnError: true });
      }

      if (!shouldPollMatchProgress(status)) {
        await fetchMatches({ preserveOnError: true });
        stopMatchPolling();
      }
    } catch {
      // Keep cards; stop aggressive polling on transport failures.
      stopMatchPolling();
    }
  }

  function startPollingIfNeeded(): void {
    stopMatchPolling();
    pollTimedOut.value = false;
    if (!refreshStatus.value || !shouldPollMatchProgress(refreshStatus.value)) {
      return;
    }

    pollStartedAt = Date.now();
    isPolling.value = true;
    pollTimer = setInterval(() => {
      void pollOnce();
    }, PLAYER_MATCH_POLL_INTERVAL_MS);
  }

  function applyTimedOutPlaystyle(response: PlayerPlaystyleResponse): PlayerPlaystyleResponse {
    return {
      ...response,
      ai: {
        ...response.ai,
        status: 'UNAVAILABLE',
        emptyReason: 'GENERATION_FAILED',
        insight: null,
      },
    };
  }

  async function fetchPlaystyle(requestId: number, startedAt: number): Promise<void> {
    try {
      const response = await api.getPlaystyle(playerId());
      if (requestId !== playstyleRequestId) {
        return;
      }
      playstyleError.value = null;
      const elapsed = Date.now() - startedAt;
      if (shouldContinueAiInsightPoll(response.ai.status, elapsed)) {
        playstyle.value = response;
        playstylePending.value = false;
        const delay = nextAiInsightPollDelayMs(elapsed);
        const timer = setTimeout(() => {
          void fetchPlaystyle(requestId, startedAt);
        }, delay);
        playstylePollTimers.push(timer);
        return;
      }
      if (response.ai.status === 'PENDING') {
        playstyle.value = applyTimedOutPlaystyle(response);
        playstylePending.value = false;
        return;
      }
      playstyle.value = response;
      playstylePending.value = false;
    } catch {
      if (requestId !== playstyleRequestId) {
        return;
      }
      if (!playstyle.value) {
        playstyleError.value = 'Unable to load playstyle analysis.';
      }
      playstylePending.value = false;
    }
  }

  async function loadPlaystyle(): Promise<void> {
    stopPlaystylePolling();
    const requestId = ++playstyleRequestId;
    playstylePending.value = true;
    playstyleError.value = null;
    playstyle.value = null;
    await fetchPlaystyle(requestId, Date.now());
  }

  async function loadProfile(): Promise<void> {
    pending.value = true;
    loadError.value = null;
    matchesError.value = null;
    void loadPlaystyle();
    try {
      const profile = await api.getProfile(playerId());
      applyProfile(profile);
      await fetchMatches({ preserveOnError: false });
      startPollingIfNeeded();
    } catch (error) {
      if (error instanceof PlayerApiError && error.code === 'RESOURCE_NOT_FOUND') {
        loadError.value = 'Player not found.';
      } else {
        loadError.value = 'Unable to load player profile.';
      }
    } finally {
      pending.value = false;
    }
  }

  async function onRefresh(): Promise<void> {
    if (refreshing.value || !profileMeta.value) {
      return;
    }

    refreshing.value = true;
    refreshMessage.value = null;
    pollTimedOut.value = false;
    // Do not clear matches at the start of refresh.

    try {
      // No queueId → all recent queues.
      const status = await api.refresh(playerId(), { force: false });
      refreshStatus.value = status;
      lastCompletedMatchCount = status.completedMatchCount;
      refreshMessage.value = 'Refresh started.';
      refreshMessageClass.value = 'text-[var(--lh-ok)]';

      // Re-fetch authoritative stored matches; never assign refresh.matches.
      await fetchMatches({ preserveOnError: true });

      try {
        const profile = await api.getProfile(playerId());
        profileMeta.value = {
          player: profile.player,
          ranks: profile.ranks,
          mastery: profile.mastery,
        };
      } catch {
        // Profile metadata refresh is best-effort; keep match cards.
      }

      startPollingIfNeeded();
    } catch (error) {
      if (error instanceof PlayerApiError) {
        if (error.code === 'REFRESH_COOLDOWN') {
          refreshMessage.value = 'Refresh cooldown active. Try again shortly.';
          refreshMessageClass.value = 'text-[var(--lh-muted)]';
        } else if (error.code === 'REFRESH_IN_PROGRESS') {
          refreshMessage.value = 'A refresh is already in progress.';
          refreshMessageClass.value = 'text-[var(--lh-muted)]';
          startPollingIfNeeded();
        } else if (error.code === 'ACCOUNT_IDENTITY_CONFLICT') {
          refreshMessage.value = 'Account identity conflict — refresh aborted.';
          refreshMessageClass.value = 'text-[var(--lh-bad)]';
        } else {
          refreshMessage.value = 'Refresh failed.';
          refreshMessageClass.value = 'text-[var(--lh-bad)]';
        }
      } else {
        refreshMessage.value = 'Refresh failed.';
        refreshMessageClass.value = 'text-[var(--lh-bad)]';
      }
    } finally {
      refreshing.value = false;
    }
  }

  async function setQueueCategory(category: PlayerMatchQueueCategory): Promise<void> {
    if (queueCategory.value === category) {
      return;
    }
    queueCategory.value = category;
    // Display filter only — never trigger Riot refresh.
    await fetchMatches({ preserveOnError: true });
  }

  return {
    profileMeta,
    matches,
    refreshStatus,
    pending,
    loadError,
    matchesError,
    refreshing,
    refreshMessage,
    refreshMessageClass,
    isPolling,
    pollTimedOut,
    queueCategory,
    matchesLoading,
    playstyle,
    playstyleError,
    playstylePending,
    loadProfile,
    onRefresh,
    setQueueCategory,
    fetchMatches,
    startPollingIfNeeded,
    stopPolling,
    stopPlaystylePolling,
    pollOnce,
  };
}
