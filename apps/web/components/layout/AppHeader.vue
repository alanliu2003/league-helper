<template>
  <header
    class="sticky top-0 z-50 border-b backdrop-blur-md"
    style="border-color: var(--lh-border); background: rgba(10, 14, 20, 0.85)"
  >
    <div class="lh-container flex items-center gap-4 py-3">
      <NuxtLink
        to="/"
        class="font-display shrink-0 text-lg font-semibold tracking-wide text-[var(--lh-text)] no-underline hover:text-[var(--lh-accent)]"
      >
        {{ productName }}
      </NuxtLink>

      <button
        type="button"
        class="ml-auto rounded-md border px-2.5 py-1.5 text-sm md:hidden"
        style="border-color: var(--lh-border)"
        :aria-expanded="mobileNavOpen"
        aria-controls="app-nav"
        @click="mobileNavOpen = !mobileNavOpen"
      >
        {{ mobileNavOpen ? 'Close' : 'Menu' }}
      </button>

      <nav
        id="app-nav"
        class="flex flex-col gap-3 md:ml-4 md:flex-row md:items-center md:gap-6"
        :class="
          mobileNavOpen
            ? 'absolute left-0 right-0 top-full border-b p-4 md:static md:border-0 md:p-0'
            : 'hidden md:flex'
        "
        style="background: var(--lh-bg); border-color: var(--lh-border)"
        aria-label="Main navigation"
      >
        <NuxtLink
          to="/"
          class="text-sm text-[var(--lh-text-secondary)] no-underline hover:text-[var(--lh-accent)]"
          active-class="!text-[var(--lh-accent)]"
        >
          Home
        </NuxtLink>
        <span
          class="cursor-not-allowed text-sm text-[var(--lh-muted)]"
          title="Coming later"
          aria-disabled="true"
        >
          Champions
        </span>
        <NuxtLink
          to="/"
          class="text-sm text-[var(--lh-text-secondary)] no-underline hover:text-[var(--lh-accent)]"
        >
          Players
        </NuxtLink>
      </nav>

      <div class="hidden min-w-0 flex-1 md:block" :class="mobileNavOpen ? '!block w-full' : ''">
        <LayoutGlobalPlayerSearch
          :pending="searching"
          :submit-error="searchError"
          id-prefix="header-search"
          @submit="onSearch"
        />
      </div>
    </div>

    <div
      v-if="mobileNavOpen"
      class="border-t px-5 pb-4 md:hidden"
      style="border-color: var(--lh-border)"
    >
      <LayoutGlobalPlayerSearch
        :pending="searching"
        :submit-error="searchError"
        id-prefix="mobile-search"
        @submit="onSearch"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
import type { PlayerSearchRequest } from '@league-helper/shared';
import { PlayerApiError, usePlayerApi } from '~/composables/usePlayerApi';
import { useRecentPlayers } from '~/composables/useRecentPlayers';

const config = useRuntimeConfig();
const productName = config.public.productName;
const router = useRouter();
const { search } = usePlayerApi();
const { addRecent } = useRecentPlayers();

const mobileNavOpen = ref(false);
const searching = ref(false);
const searchError = ref<string | null>(null);

function mapSearchError(error: unknown): string {
  if (error instanceof PlayerApiError) {
    switch (error.code) {
      case 'RESOURCE_NOT_FOUND':
        return 'Player not found.';
      case 'PROVIDER_RATE_LIMITED':
        return 'Rate limited — try again shortly.';
      default:
        return error.message || 'Search failed.';
    }
  }
  return 'Search failed.';
}

async function onSearch(payload: PlayerSearchRequest): Promise<void> {
  if (searching.value) {
    return;
  }

  searching.value = true;
  searchError.value = null;
  mobileNavOpen.value = false;

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
