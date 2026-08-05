<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="matches-heading" class="font-display text-xl">Match history</h2>
    <div class="flex flex-wrap items-center gap-3">
      <p v-if="lastUpdated" class="text-xs text-[var(--lh-muted)]">Updated {{ lastUpdated }}</p>
      <button
        v-if="showRefresh"
        type="button"
        class="text-sm text-[var(--lh-accent)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="refreshing"
        @click="$emit('refresh')"
      >
        {{ refreshing ? 'Refreshing…' : 'Refresh matches' }}
      </button>
    </div>
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
          : 'text-[var(--lh-muted)] hover:border-[var(--lh-border-strong)]'
      "
      :style="queueCategory !== option.value ? { borderColor: 'var(--lh-border)' } : undefined"
      :aria-pressed="queueCategory === option.value"
      @click="$emit('update:queueCategory', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { PlayerMatchQueueCategory } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  queueCategory?: PlayerMatchQueueCategory;
  refreshing?: boolean;
  showRefresh?: boolean;
  lastUpdated?: string | null;
}>();

defineEmits<{
  refresh: [];
  'update:queueCategory': [PlayerMatchQueueCategory];
}>();

const queueCategory = computed(() => props.queueCategory ?? 'all');

const filterOptions: Array<{ value: PlayerMatchQueueCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ranked_solo', label: 'Solo/Duo' },
  { value: 'ranked_flex', label: 'Flex' },
  { value: 'normal', label: 'Normal' },
  { value: 'aram', label: 'ARAM' },
  { value: 'other', label: 'Other' },
];
</script>
