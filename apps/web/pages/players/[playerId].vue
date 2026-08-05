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

    <template v-else-if="profileMeta && refreshStatus">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-2">
          <p class="text-sm uppercase tracking-[0.18em] text-[var(--lh-accent)]">
            {{ platformLabel }}
          </p>
          <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
            {{ profileMeta.player.riotId.gameName }}
            <span class="text-[var(--lh-muted)]">#{{ profileMeta.player.riotId.tagLine }}</span>
          </h1>
          <p class="text-sm text-[var(--lh-muted)]">
            Level {{ profileMeta.player.summonerLevel ?? '—' }}
            <span v-if="profileMeta.player.lastResolvedAt">
              · Resolved {{ formatTimestamp(profileMeta.player.lastResolvedAt) }}
            </span>
          </p>
        </div>

        <img
          v-if="profileMeta.player.profileIconUrl && !profileIconFailed"
          :src="profileMeta.player.profileIconUrl"
          :alt="`${profileMeta.player.riotId.gameName} profile icon`"
          width="64"
          height="64"
          class="h-16 w-16 rounded-2xl border border-white/10 bg-[var(--lh-surface)] object-cover"
          loading="lazy"
          @error="profileIconFailed = true"
        />
        <div
          v-else
          class="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[var(--lh-surface)] text-xs text-[var(--lh-muted)]"
          aria-hidden="true"
        >
          {{ profileMeta.player.profileIconId ?? '—' }}
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded-lg bg-[var(--lh-accent)] px-4 py-2 text-sm font-semibold text-[#071018] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="refreshing || refreshStatus.state === 'PROCESSING'"
          @click="onRefresh"
        >
          {{ refreshing ? 'Refreshing…' : 'Refresh matches' }}
        </button>
        <p v-if="refreshMessage" class="text-sm" :class="refreshMessageClass" role="status">
          {{ refreshMessage }}
        </p>
        <p v-if="pollTimedOut" class="text-sm text-[var(--lh-muted)]" role="status">
          Auto-refresh paused after 5 minutes. Use refresh to check again.
        </p>
      </div>

      <PlayerRefreshStatus :refresh="refreshStatus" />

      <section aria-labelledby="ranks-heading" class="space-y-3">
        <h2 id="ranks-heading" class="text-lg font-medium">Ranked</h2>
        <p
          v-if="profileMeta.ranks.length === 0"
          class="rounded-lg border border-dashed border-white/15 px-4 py-6 text-sm text-[var(--lh-muted)]"
        >
          No ranked data stored for this player yet.
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <PlayerRankCard v-for="rank in profileMeta.ranks" :key="rank.id" :rank="rank" />
        </div>
      </section>

      <PlayerMasteryList :mastery="profileMeta.mastery" />

      <PlayerMatchList
        :matches="matches"
        :refresh="refreshStatus"
        :refreshing="refreshing"
        :matches-error="matchesError"
        :matches-loading="matchesLoading"
        :queue-category="queueCategory"
        :show-manual-refresh="pollTimedOut || !isPolling"
        @refresh="onRefresh"
        @update:queue-category="onQueueCategory"
      />
    </template>
  </main>
</template>

<script setup lang="ts">
import { getPlatformDisplayName, type PlayerMatchQueueCategory } from '@league-helper/shared';
import { usePlayerApi } from '../../composables/usePlayerApi';
import { createPlayerProfilePageController } from '../../composables/usePlayerProfilePage';

const route = useRoute();
const playerId = computed(() => String(route.params.playerId));
const api = usePlayerApi();

const {
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
  loadProfile,
  onRefresh,
  setQueueCategory,
  stopPolling,
} = createPlayerProfilePageController(() => playerId.value, api);

const profileIconFailed = ref(false);

watch(
  () => profileMeta.value?.player.profileIconUrl,
  () => {
    profileIconFailed.value = false;
  },
);

const platformLabel = computed(() => {
  if (!profileMeta.value) {
    return '';
  }
  return getPlatformDisplayName(profileMeta.value.player.platform);
});

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

async function onQueueCategory(category: PlayerMatchQueueCategory): Promise<void> {
  await setQueueCategory(category);
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
