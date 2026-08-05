<template>
  <main class="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
    <div>
      <NuxtLink
        to="/"
        class="text-sm text-[var(--lh-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
      >
        ← Back to search
      </NuxtLink>
    </div>

    <p v-if="pending" class="text-sm text-[var(--lh-muted)]" role="status">Loading player…</p>

    <div v-else-if="loadError" class="space-y-2" role="alert">
      <p class="font-medium text-[var(--lh-bad)]">{{ loadError }}</p>
      <NuxtLink to="/" class="text-sm text-[var(--lh-accent)] hover:underline">
        Return to search
      </NuxtLink>
    </div>

    <template v-else-if="profile">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm uppercase tracking-[0.18em] text-[var(--lh-accent)]">
            {{ platformLabel }}
          </p>
          <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
            {{ profile.player.riotId.gameName }}
            <span class="text-[var(--lh-muted)]">#{{ profile.player.riotId.tagLine }}</span>
          </h1>
          <p class="text-sm text-[var(--lh-muted)]">
            Level {{ profile.player.summonerLevel ?? '—' }}
            <span v-if="profile.player.lastResolvedAt">
              · Resolved {{ formatTimestamp(profile.player.lastResolvedAt) }}
            </span>
          </p>
        </div>

        <div
          class="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[var(--lh-surface)] text-xs text-[var(--lh-muted)]"
          aria-hidden="true"
        >
          Icon {{ profile.player.profileIconId ?? '—' }}
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded-lg bg-[var(--lh-accent)] px-4 py-2 text-sm font-semibold text-[#071018] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="refreshing || profile.refresh.state === 'PROCESSING'"
          @click="onRefresh"
        >
          {{ refreshing ? 'Refreshing…' : 'Refresh profile' }}
        </button>
        <p v-if="refreshMessage" class="text-sm" :class="refreshMessageClass" role="status">
          {{ refreshMessage }}
        </p>
      </div>

      <PlayerRefreshStatus :refresh="profile.refresh" />

      <section aria-labelledby="ranks-heading" class="space-y-3">
        <h2 id="ranks-heading" class="text-lg font-medium">Ranked</h2>
        <p
          v-if="profile.ranks.length === 0"
          class="rounded-lg border border-dashed border-white/15 px-4 py-6 text-sm text-[var(--lh-muted)]"
        >
          No ranked data stored for this player yet.
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <PlayerRankCard v-for="rank in profile.ranks" :key="rank.id" :rank="rank" />
        </div>
      </section>

      <PlayerMasteryList :mastery="profile.mastery" />

      <section aria-labelledby="matches-heading" class="space-y-3">
        <h2 id="matches-heading" class="text-lg font-medium">Recent matches</h2>
        <PlayerMatchProcessingState
          v-if="profile.refresh.completedMatchCount === 0"
          :refresh="profile.refresh"
        />
        <p v-else class="text-sm text-[var(--lh-muted)]">
          {{ profile.refresh.completedMatchCount }} stored match(es). Detailed cards arrive after
          Milestone 6 ingestion.
        </p>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { getPlatformDisplayName, type PlayerProfileResponse } from '@league-helper/shared';
import { PlayerApiError, usePlayerApi } from '../../composables/usePlayerApi';

const route = useRoute();
const playerId = computed(() => String(route.params.playerId));
const { getProfile, refresh, getRefreshStatus } = usePlayerApi();

const profile = ref<PlayerProfileResponse | null>(null);
const pending = ref(true);
const loadError = ref<string | null>(null);
const refreshing = ref(false);
const refreshMessage = ref<string | null>(null);
const refreshMessageClass = ref('text-[var(--lh-muted)]');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollStartedAt = 0;
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 120_000;

const platformLabel = computed(() => {
  if (!profile.value) {
    return '';
  }
  return getPlatformDisplayName(profile.value.player.platform);
});

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPollingIfNeeded(): void {
  stopPolling();
  if (!profile.value || profile.value.refresh.state !== 'PROCESSING') {
    return;
  }

  pollStartedAt = Date.now();
  pollTimer = setInterval(async () => {
    if (Date.now() - pollStartedAt > POLL_MAX_MS) {
      stopPolling();
      return;
    }

    try {
      const status = await getRefreshStatus(playerId.value);
      if (profile.value) {
        profile.value = { ...profile.value, refresh: status };
      }
      if (status.state !== 'PROCESSING') {
        stopPolling();
        const updated = await getProfile(playerId.value);
        profile.value = updated;
      }
    } catch {
      stopPolling();
    }
  }, POLL_INTERVAL_MS);
}

async function loadProfile(): Promise<void> {
  pending.value = true;
  loadError.value = null;
  try {
    profile.value = await getProfile(playerId.value);
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
  if (refreshing.value || !profile.value) {
    return;
  }

  refreshing.value = true;
  refreshMessage.value = null;

  try {
    const status = await refresh(playerId.value);
    if (profile.value) {
      profile.value = { ...profile.value, refresh: status };
    }
    refreshMessage.value = 'Refresh started.';
    refreshMessageClass.value = 'text-[var(--lh-ok)]';
    startPollingIfNeeded();
    if (status.state !== 'PROCESSING') {
      profile.value = await getProfile(playerId.value);
    }
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

watch(playerId, () => {
  void loadProfile();
});

onMounted(() => {
  void loadProfile();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>
