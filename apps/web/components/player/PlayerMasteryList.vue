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
        <img
          v-if="entry.championIconUrl && !failedIconIds[entry.id]"
          :src="entry.championIconUrl"
          :alt="`${championDisplayName(entry)} icon`"
          width="40"
          height="40"
          class="h-10 w-10 shrink-0 rounded-md bg-[var(--lh-surface)] object-cover"
          loading="lazy"
          @error="markIconFailed(entry.id)"
        />
        <div
          v-else
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--lh-surface)] text-xs font-semibold text-[var(--lh-muted)]"
          aria-hidden="true"
        >
          {{ championInitials(entry) }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ championDisplayName(entry) }}</p>
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
import { ref } from 'vue';

defineProps<{
  mastery: PublicMasterySummary[];
}>();

const failedIconIds = ref<Record<string, boolean>>({});

function markIconFailed(id: string): void {
  failedIconIds.value = { ...failedIconIds.value, [id]: true };
}

function championDisplayName(entry: PublicMasterySummary): string {
  return entry.championName?.trim() || `Champion #${entry.championId}`;
}

function championInitials(entry: PublicMasterySummary): string {
  const name = championDisplayName(entry);
  if (name.startsWith('Champion #')) {
    return '?';
  }
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
</script>
