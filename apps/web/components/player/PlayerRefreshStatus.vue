<template>
  <section
    class="rounded-xl border border-white/10 bg-[var(--lh-surface)]/50 p-4"
    aria-labelledby="refresh-status-heading"
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id="refresh-status-heading" class="text-sm font-medium">Refresh status</h2>
      <span
        class="rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide"
        :class="stateBadgeClass"
      >
        {{ refresh.state }}
      </span>
    </div>

    <p v-if="refresh.isStale" class="mb-3 text-xs text-[var(--lh-muted)]">
      Profile data may be stale. Consider refreshing for the latest ranks and matches.
    </p>

    <dl class="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <div>
        <dt class="text-[var(--lh-muted)]">Requested</dt>
        <dd class="font-medium">{{ refresh.requestedMatchCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Queued</dt>
        <dd class="font-medium">{{ refresh.queuedMatchCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Active</dt>
        <dd class="font-medium">{{ refresh.activeMatchCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Delayed</dt>
        <dd class="font-medium">{{ refresh.delayedMatchCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Completed</dt>
        <dd class="font-medium text-[var(--lh-ok)]">{{ refresh.completedMatchCount }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Failed</dt>
        <dd class="font-medium" :class="refresh.failedMatchCount > 0 ? 'text-[var(--lh-bad)]' : ''">
          {{ refresh.failedMatchCount }}
        </dd>
      </div>
    </dl>

    <ul v-if="refresh.warnings.length > 0" class="mt-3 space-y-1.5">
      <li
        v-for="warning in refresh.warnings"
        :key="warning.code"
        class="rounded-md border border-white/10 bg-[var(--lh-bg)]/50 px-3 py-2 text-xs"
        role="alert"
      >
        <span class="font-medium">{{ warning.code }}</span>
        — {{ warning.message }}
        <span v-if="warning.retryAfterSeconds !== undefined" class="text-[var(--lh-muted)]">
          (retry in {{ warning.retryAfterSeconds }}s)
        </span>
      </li>
    </ul>

    <p
      v-if="refresh.state === 'RATE_LIMITED' && refresh.retryAfterSeconds !== undefined"
      class="mt-3 text-xs text-[var(--lh-muted)]"
      role="status"
    >
      Rate limited — try again in {{ refresh.retryAfterSeconds }} seconds.
    </p>

    <p v-if="refresh.lastRefreshedAt" class="mt-3 text-xs text-[var(--lh-muted)]">
      Last refreshed {{ formatTimestamp(refresh.lastRefreshedAt) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import type { PlayerRefreshStatus } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  refresh: PlayerRefreshStatus;
}>();

const stateBadgeClass = computed(() => {
  switch (props.refresh.state) {
    case 'COMPLETE':
      return 'bg-[var(--lh-ok)]/15 text-[var(--lh-ok)]';
    case 'PROCESSING':
      return 'bg-[var(--lh-accent)]/15 text-[var(--lh-accent)]';
    case 'FAILED':
    case 'RATE_LIMITED':
      return 'bg-[var(--lh-bad)]/15 text-[var(--lh-bad)]';
    case 'PARTIAL':
    case 'STALE':
      return 'bg-amber-500/15 text-amber-300';
    default:
      return 'bg-white/10 text-[var(--lh-muted)]';
  }
});

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}
</script>
