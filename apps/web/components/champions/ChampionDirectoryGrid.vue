<template>
  <section aria-labelledby="champion-directory-heading" class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="champion-directory-heading" class="font-display text-xl">Champion directory</h2>
        <p class="mt-1 text-sm text-[var(--lh-muted)]">
          Static roster from the active game-data version. Search and tags filter this list only.
        </p>
      </div>
      <p v-if="staticDataPatch" class="text-xs text-[var(--lh-muted)]">
        Static data patch {{ staticDataPatch }}
      </p>
    </div>

    <p v-if="pending" class="text-sm text-[var(--lh-muted)]" role="status">Loading champions…</p>
    <p v-else-if="error" class="text-sm text-[var(--lh-error)]" role="alert">{{ error }}</p>
    <p v-else-if="champions.length === 0" class="text-sm text-[var(--lh-muted)]" role="status">
      No champions match the current search or tag.
    </p>
    <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <li v-for="champion in champions" :key="champion.championId">
        <NuxtLink
          :to="linkFor(champion.championKey)"
          class="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition hover:border-[var(--lh-border-strong)]"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
        >
          <img
            v-if="champion.iconUrl"
            :src="champion.iconUrl"
            :alt="`${champion.name} icon`"
            width="40"
            height="40"
            class="h-10 w-10 shrink-0 rounded-md object-cover"
            style="background: var(--lh-surface-inset)"
            loading="lazy"
          />
          <div
            v-else
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-[var(--lh-muted)]"
            style="background: var(--lh-surface-inset)"
            aria-hidden="true"
          >
            {{ initials(champion.name, champion.championId) }}
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ champion.name }}</p>
            <p class="truncate text-xs text-[var(--lh-muted)]">{{ champion.title }}</p>
          </div>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { ChampionSummary } from '@league-helper/shared';
import { buildChampionPath, type ChampionAggregateLinkFilters } from '~/utils/champion-links';
import { championInitials } from '~/utils/champion-display';

const props = defineProps<{
  champions: ChampionSummary[];
  pending?: boolean;
  error?: string | null;
  staticDataPatch?: string | null;
  linkFilters?: ChampionAggregateLinkFilters;
}>();

function linkFor(championKey: string): string {
  return buildChampionPath(championKey, props.linkFilters ?? {});
}

function initials(name: string, championId: number): string {
  return championInitials(name, championId);
}
</script>
