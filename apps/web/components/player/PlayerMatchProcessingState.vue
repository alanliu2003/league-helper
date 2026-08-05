<template>
  <div
    class="rounded-lg border border-[var(--lh-accent)]/30 bg-[var(--lh-accent)]/10 px-4 py-4 text-sm"
    role="status"
  >
    <p class="font-medium text-[var(--lh-accent)]">Match ingestion in progress</p>
    <p class="mt-1 text-[var(--lh-muted)]">
      Recent matches are being queued for ingestion. Match details will appear after the ingestion
      worker is implemented.
    </p>
    <p v-if="refresh" class="mt-2 text-xs text-[var(--lh-muted)]">
      {{ refresh.queuedMatchCount }} queued · {{ refresh.activeMatchCount }} active ·
      {{ refresh.completedMatchCount }} completed
    </p>
  </div>
</template>

<script setup lang="ts">
import type { PlayerRefreshStatus } from '@league-helper/shared';

defineProps<{
  refresh?: PlayerRefreshStatus | null;
}>();
</script>
