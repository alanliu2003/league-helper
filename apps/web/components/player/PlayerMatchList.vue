<template>
  <section aria-labelledby="matches-heading" class="space-y-4">
    <MatchHistoryToolbar
      :queue-category="queueCategory"
      :refreshing="refreshing"
      :show-refresh="showManualRefresh"
      :last-updated="lastUpdatedLabel"
      @refresh="$emit('refresh')"
      @update:queue-category="$emit('update:queueCategory', $event)"
    />

    <PlayerMatchProcessingState
      v-if="showProcessingBanner"
      :refresh="refresh"
      :compact="matches.length > 0"
    />

    <p v-if="matchesError" class="text-sm text-[var(--lh-error)]" role="alert">
      {{ matchesError }}
    </p>

    <p
      v-if="matches.length === 0 && !showProcessingBanner && !matchesLoading"
      class="rounded-lg border border-dashed px-4 py-6 text-sm text-[var(--lh-muted)]"
      style="border-color: var(--lh-border)"
    >
      {{ emptyFilterMessage }}
    </p>

    <ul v-else-if="matches.length > 0" class="space-y-2" :aria-busy="matchesLoading">
      <li v-for="match in matches" :key="match.id">
        <PlayerMatchCard :match="match" :player-id="playerId" />
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
import MatchHistoryToolbar from '~/components/player/MatchHistoryToolbar.vue';
import PlayerMatchCard from '~/components/player/PlayerMatchCard.vue';
import PlayerMatchProcessingState from '~/components/player/PlayerMatchProcessingState.vue';
import { hasInFlightMatchJobs } from '../../utils/player-match-polling';

const props = defineProps<{
  matches: PublicMatchSummary[];
  refresh: PlayerRefreshStatus;
  refreshing?: boolean;
  matchesError?: string | null;
  matchesLoading?: boolean;
  queueCategory?: PlayerMatchQueueCategory;
  showManualRefresh?: boolean;
  lastUpdated?: string | null;
  playerId?: string | null;
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

const lastUpdatedLabel = computed(() => {
  if (!props.lastUpdated) {
    return null;
  }
  return new Date(props.lastUpdated).toLocaleString();
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
