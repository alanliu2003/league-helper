<template>
  <main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-14">
    <header class="space-y-4">
      <p class="text-sm uppercase tracking-[0.22em] text-[var(--lh-accent)]">Player lookup</p>
      <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">{{ productName }}</h1>
      <p class="max-w-2xl text-[var(--lh-muted)]">
        Search a Riot ID to resolve the account, store ranked and mastery snapshots, and queue
        recent matches for ingestion. Match detail cards arrive in a later milestone.
      </p>
    </header>

    <section
      class="rounded-2xl border border-white/10 bg-[var(--lh-surface)]/80 p-6 backdrop-blur"
      aria-labelledby="search-heading"
    >
      <h2 id="search-heading" class="mb-5 text-lg font-medium">Search by Riot ID</h2>

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
        <li v-for="entry in recentPlayers" :key="entry.playerId">
          <NuxtLink
            :to="`/players/${entry.playerId}`"
            class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[var(--lh-surface)]/50 px-4 py-3 text-sm transition hover:border-white/20"
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

    <DevelopmentApiHealthStatus />
  </main>
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

const searching = ref(false);
const searchError = ref<string | null>(null);

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
