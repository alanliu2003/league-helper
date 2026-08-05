<template>
  <div class="lh-container flex flex-col gap-12 py-10 md:py-16">
    <section class="space-y-6 text-center md:text-left">
      <p class="text-sm uppercase tracking-[0.22em] text-[var(--lh-accent-gold)]">
        League analytics
      </p>
      <h1 class="font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
        {{ productName }}
      </h1>
      <p class="mx-auto max-w-2xl text-lg text-[var(--lh-text-secondary)] md:mx-0">
        Understand your matches, champion pool, and improvement opportunities.
      </p>
    </section>

    <section class="lh-surface-raised p-6 md:p-8" aria-labelledby="search-heading">
      <h2 id="search-heading" class="mb-5 font-display text-xl">Search by Riot ID</h2>
      <PlayerSearchForm :pending="searching" :submit-error="searchError" @submit="onSearch" />
    </section>

    <section v-if="recentPlayers.length > 0" class="space-y-3" aria-labelledby="recent-heading">
      <div class="flex items-center justify-between gap-3">
        <h2 id="recent-heading" class="text-sm font-medium text-[var(--lh-muted)]">
          Recent searches
        </h2>
        <button
          type="button"
          class="text-xs text-[var(--lh-muted)] underline-offset-2 hover:text-[var(--lh-text)] hover:underline"
          @click="clearRecent()"
        >
          Clear
        </button>
      </div>
      <ul class="space-y-2">
        <li v-for="entry in recentPlayers.slice(0, 5)" :key="entry.playerId">
          <NuxtLink
            :to="`/players/${entry.playerId}`"
            class="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition hover:border-[var(--lh-border-strong)]"
            style="border-color: var(--lh-border); background: var(--lh-surface)"
          >
            <span>
              <span class="font-medium">{{ entry.riotIdDisplay }}</span>
              <span class="ml-2 text-[var(--lh-muted)]">{{ entry.platformLabel }}</span>
            </span>
            <span class="text-xs text-[var(--lh-muted)]">
              {{ formatRecent(entry.lastSearchedAt) }}
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section aria-labelledby="capabilities-heading" class="space-y-4">
      <h2 id="capabilities-heading" class="font-display text-xl">Current capabilities</h2>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li
          v-for="item in capabilities"
          :key="item"
          class="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
        >
          <span class="text-[var(--lh-victory)]" aria-hidden="true">✓</span>
          {{ item }}
        </li>
      </ul>
    </section>

    <aside v-if="isDev" class="opacity-80">
      <DevelopmentApiHealthStatus />
    </aside>
  </div>
</template>

<script setup lang="ts">
import type { PlayerSearchRequest } from '@league-helper/shared';
import { PlayerApiError, usePlayerApi } from '../composables/usePlayerApi';
import { useRecentPlayers } from '../composables/useRecentPlayers';

const config = useRuntimeConfig();
const productName = config.public.productName;
const router = useRouter();
const { search } = usePlayerApi();
const { recentPlayers, addRecent, clearRecent } = useRecentPlayers();

const isDev = import.meta.dev;
const searching = ref(false);
const searchError = ref<string | null>(null);

const capabilities = [
  'Player profile',
  'Rank history',
  'Champion mastery',
  'Recent-match ingestion',
  'Mixed-queue match history',
];

function formatRecent(iso: string): string {
  return new Date(iso).toLocaleString();
}

function mapSearchError(error: unknown): string {
  if (error instanceof PlayerApiError) {
    switch (error.code) {
      case 'RESOURCE_NOT_FOUND':
        return 'Player not found for that Riot ID and platform.';
      case 'PROVIDER_FORBIDDEN':
      case 'PROVIDER_UNAUTHORIZED':
        return 'Riot rejected the request. Development API keys expire regularly — refresh the key on the backend.';
      case 'PROVIDER_RATE_LIMITED':
        return 'Riot rate limit reached. Wait a moment and try again.';
      case 'PROVIDER_UNAVAILABLE':
      case 'PROVIDER_NOT_CONFIGURED':
        return 'The game data provider is temporarily unavailable.';
      case 'UNSUPPORTED_PLATFORM_ROUTE':
      case 'INVALID_RIOT_ID':
      case 'VALIDATION_ERROR':
        return error.message;
      default:
        return 'Search failed. Please try again.';
    }
  }
  return 'Search failed. Please try again.';
}

async function onSearch(payload: PlayerSearchRequest): Promise<void> {
  if (searching.value) {
    return;
  }

  searching.value = true;
  searchError.value = null;

  try {
    const result = await search(payload);
    addRecent({
      playerId: result.player.id,
      gameName: result.player.riotId.gameName,
      tagLine: result.player.riotId.tagLine,
      platform: result.player.platform,
    });
    await router.push(`/players/${result.player.id}`);
  } catch (error) {
    searchError.value = mapSearchError(error);
  } finally {
    searching.value = false;
  }
}
</script>
