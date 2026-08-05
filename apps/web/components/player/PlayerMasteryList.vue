<template>
  <section aria-labelledby="mastery-heading">
    <h2 id="mastery-heading" class="mb-3 text-lg font-medium">Champion mastery</h2>

    <p
      v-if="mastery.length === 0"
      class="rounded-lg border border-dashed border-white/15 px-4 py-6 text-sm text-[var(--lh-muted)]"
    >
      No mastery data yet. Refresh the profile to pull champion mastery from Riot.
    </p>

    <ol v-else class="space-y-2">
      <li
        v-for="(entry, index) in mastery"
        :key="entry.id"
        class="flex items-center gap-4 rounded-lg border border-white/10 bg-[var(--lh-bg)]/40 px-4 py-3"
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--lh-surface)] text-sm font-semibold text-[var(--lh-accent)]"
          aria-hidden="true"
        >
          {{ index + 1 }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">Champion #{{ entry.championId }}</p>
          <p class="text-xs text-[var(--lh-muted)]">
            Level {{ entry.championLevel }} · {{ entry.championPoints.toLocaleString() }} points
          </p>
        </div>
        <div class="text-right text-xs text-[var(--lh-muted)]">
          <p v-if="entry.lastPlayTime">Last played {{ formatDate(entry.lastPlayTime) }}</p>
          <p v-if="entry.chestGranted === false" class="text-[var(--lh-accent)]">Chest available</p>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import type { PublicMasterySummary } from '@league-helper/shared';

defineProps<{
  mastery: PublicMasterySummary[];
}>();

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
</script>
