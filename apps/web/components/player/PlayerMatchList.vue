<template>
  <section aria-labelledby="matches-heading" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="matches-heading" class="text-lg font-medium">Recent matches</h2>
      <button
        v-if="showManualRefresh"
        type="button"
        class="text-sm text-[var(--lh-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)] disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="refreshing"
        @click="$emit('refresh')"
      >
        {{ refreshing ? 'Refreshing…' : 'Refresh matches' }}
      </button>
    </div>

    <div class="flex flex-wrap gap-2" role="group" aria-label="Match queue filter">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
        :class="
          queueCategory === option.value
            ? 'border-[var(--lh-accent)] bg-[var(--lh-accent)]/15 text-[var(--lh-accent)]'
            : 'border-white/15 text-[var(--lh-muted)] hover:border-white/30'
        "
        :aria-pressed="queueCategory === option.value"
        @click="$emit('update:queueCategory', option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <PlayerMatchProcessingState
      v-if="showProcessingBanner"
      :refresh="refresh"
      :compact="matches.length > 0"
    />

    <p v-if="matchesError" class="text-sm text-[var(--lh-bad)]" role="alert">
      {{ matchesError }}
    </p>

    <p
      v-if="matches.length === 0 && !showProcessingBanner && !matchesLoading"
      class="rounded-lg border border-dashed border-white/15 px-4 py-6 text-sm text-[var(--lh-muted)]"
    >
      {{ emptyFilterMessage }}
    </p>

    <ul v-else-if="matches.length > 0" class="space-y-2" :aria-busy="matchesLoading">
      <li v-for="match in matches" :key="match.id">
        <PlayerMatchCard :match="match" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type {
  PlayerMatchQueueCategory,
  PlayerRefreshStatus,
  PublicMatchSummary,
} from '@league-helper/shared';
import { computed } from 'vue';
import { hasInFlightMatchJobs } from '../../utils/player-match-polling';

const props = defineProps<{
  matches: PublicMatchSummary[];
  refresh: PlayerRefreshStatus;
  refreshing?: boolean;
  matchesError?: string | null;
  matchesLoading?: boolean;
  queueCategory?: PlayerMatchQueueCategory;
  /** Show manual refresh when polling stopped with remaining interest. */
  showManualRefresh?: boolean;
}>();

defineEmits<{
  refresh: [];
  'update:queueCategory': [PlayerMatchQueueCategory];
}>();

const queueCategory = computed(() => props.queueCategory ?? 'all');

const filterOptions: Array<{ value: PlayerMatchQueueCategory; label: string }> = [
  { value: 'all', label: 'All recent matches' },
  { value: 'ranked_solo', label: 'Ranked Solo/Duo' },
  { value: 'ranked_flex', label: 'Ranked Flex' },
  { value: 'normal', label: 'Normal' },
  { value: 'aram', label: 'ARAM' },
  { value: 'other', label: 'Other' },
];

const emptyFilterMessage = computed(() => {
  if (queueCategory.value === 'all') {
    return 'No stored matches yet. Search or refresh to queue recent games for ingestion.';
  }
  const label = filterOptions.find((o) => o.value === queueCategory.value)?.label ?? 'this filter';
  return `No stored matches for ${label}.`;
});

const showProcessingBanner = computed(() => {
  if (!props.refresh) {
    return false;
  }
  if (hasInFlightMatchJobs(props.refresh)) {
    return true;
  }
  if (props.refresh.state === 'PROCESSING' || props.refresh.state === 'PARTIAL') {
    return true;
  }
  if (props.refresh.state === 'RATE_LIMITED') {
    return true;
  }
  return props.refresh.failedMatchCount > 0 && props.matches.length === 0;
});
</script>
