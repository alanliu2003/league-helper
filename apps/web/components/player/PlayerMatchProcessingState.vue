<template>
  <div class="rounded-lg border px-4 py-3 text-sm" :class="bannerClass" role="status">
    <p class="font-medium" :class="titleClass">{{ title }}</p>
    <p class="mt-1 text-[var(--lh-muted)]">{{ description }}</p>

    <p v-if="refresh" class="mt-2 text-xs text-[var(--lh-muted)]">
      {{ refresh.queuedMatchCount }} queued · {{ refresh.activeMatchCount }} active ·
      {{ refresh.delayedMatchCount }} delayed · {{ refresh.completedMatchCount }} completed ·
      {{ refresh.failedMatchCount }} failed
    </p>

    <p v-if="showFailureWarning" class="mt-2 text-xs text-[var(--lh-bad)]" role="alert">
      Some match jobs failed. Completed matches still appear below when available.
    </p>

    <p v-if="showDelayedNote" class="mt-2 text-xs text-[var(--lh-muted)]">
      Delayed jobs are waiting on rate limits — this is expected, not stuck.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { PlayerRefreshStatus } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  refresh?: PlayerRefreshStatus | null;
  /** Compact banner while some matches already render. */
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

const showDelayedNote = computed(
  () => (props.refresh?.delayedMatchCount ?? 0) > 0 && inFlight.value > 0,
);

const onlyDelayed = computed(
  () =>
    (props.refresh?.delayedMatchCount ?? 0) > 0 &&
    (props.refresh?.queuedMatchCount ?? 0) === 0 &&
    (props.refresh?.activeMatchCount ?? 0) === 0,
);

const title = computed(() => {
  if (onlyDelayed.value) {
    return 'Match ingestion is temporarily delayed.';
  }
  if (props.compact && (props.refresh?.completedMatchCount ?? 0) > 0) {
    return 'Still ingesting matches';
  }
  if (inFlight.value > 0) {
    return 'Match ingestion is in progress.';
  }
  if (showFailureWarning.value) {
    return 'Match ingestion finished with failures';
  }
  return 'Match ingestion';
});

const description = computed(() => {
  if (onlyDelayed.value) {
    return 'Jobs are waiting on Riot rate limits. This is expected — cards appear as delays clear.';
  }
  if (props.compact && inFlight.value > 0) {
    return 'New match cards appear as jobs complete. You can keep browsing.';
  }
  if (inFlight.value > 0 && (props.refresh?.completedMatchCount ?? 0) === 0) {
    return 'Recent matches are queued for background ingestion. Cards appear as each match completes.';
  }
  if (inFlight.value > 0) {
    return 'Remaining jobs are still processing.';
  }
  if (showFailureWarning.value) {
    return 'You can refresh the profile later to retry eligible failed matches.';
  }
  return 'No match ingestion jobs are currently queued.';
});

const bannerClass = computed(() => {
  if (showFailureWarning.value && inFlight.value === 0) {
    return 'border-[var(--lh-bad)]/30 bg-[var(--lh-bad)]/10';
  }
  return 'border-[var(--lh-accent)]/30 bg-[var(--lh-accent)]/10';
});

const titleClass = computed(() => {
  if (showFailureWarning.value && inFlight.value === 0) {
    return 'text-[var(--lh-bad)]';
  }
  return 'text-[var(--lh-accent)]';
});
</script>
