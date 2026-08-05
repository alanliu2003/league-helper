<template>
  <div class="rounded-lg border px-3 py-2 text-sm" :class="bannerClass" role="status">
    <p class="font-medium" :class="titleClass">{{ title }}</p>
    <p v-if="!compact" class="mt-0.5 text-xs text-[var(--lh-muted)]">{{ description }}</p>

    <p v-if="refresh && !compact" class="mt-1.5 text-xs text-[var(--lh-muted)]">
      {{ refresh.completedMatchCount }}/{{ refresh.requestedMatchCount }} completed
      <span v-if="inFlight > 0"> · {{ inFlight }} in flight</span>
    </p>

    <p v-if="showFailureWarning" class="mt-1 text-xs text-[var(--lh-error)]" role="alert">
      Some jobs failed — completed matches still appear below.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { PlayerRefreshStatus } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  refresh?: PlayerRefreshStatus | null;
  compact?: boolean;
}>();

const inFlight = computed(() => {
  if (!props.refresh) {
    return 0;
  }
  return (
    props.refresh.queuedMatchCount +
    props.refresh.activeMatchCount +
    props.refresh.delayedMatchCount
  );
});

const showFailureWarning = computed(() => (props.refresh?.failedMatchCount ?? 0) > 0);

const onlyDelayed = computed(
  () =>
    (props.refresh?.delayedMatchCount ?? 0) > 0 &&
    (props.refresh?.queuedMatchCount ?? 0) === 0 &&
    (props.refresh?.activeMatchCount ?? 0) === 0,
);

const title = computed(() => {
  if (onlyDelayed.value) {
    return 'Ingestion delayed (rate limits)';
  }
  if (props.compact && inFlight.value > 0) {
    return 'Still ingesting matches…';
  }
  if (inFlight.value > 0) {
    return 'Match ingestion in progress';
  }
  if (showFailureWarning.value) {
    return 'Ingestion finished with failures';
  }
  return 'Match ingestion';
});

const description = computed(() => {
  if (onlyDelayed.value) {
    return 'Waiting on Riot rate limits — cards appear as delays clear.';
  }
  if (props.compact && inFlight.value > 0) {
    return 'New cards appear as jobs complete.';
  }
  if (inFlight.value > 0) {
    return 'Recent matches are queued for background ingestion.';
  }
  if (showFailureWarning.value) {
    return 'Refresh later to retry eligible failed matches.';
  }
  return '';
});

const bannerClass = computed(() => {
  if (showFailureWarning.value && inFlight.value === 0) {
    return 'border-[var(--lh-error)]/30 bg-[var(--lh-error)]/10';
  }
  if (props.compact) {
    return 'border-[var(--lh-accent)]/25 bg-[var(--lh-accent)]/8';
  }
  return 'border-[var(--lh-accent)]/30 bg-[var(--lh-accent)]/10';
});

const titleClass = computed(() => {
  if (showFailureWarning.value && inFlight.value === 0) {
    return 'text-[var(--lh-error)]';
  }
  return 'text-[var(--lh-accent)]';
});
</script>
