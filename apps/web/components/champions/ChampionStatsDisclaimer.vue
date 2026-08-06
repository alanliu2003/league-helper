<template>
  <aside
    class="rounded-lg border px-4 py-3 text-sm text-[var(--lh-text-secondary)]"
    style="border-color: var(--lh-border); background: var(--lh-surface)"
    role="note"
  >
    <p>{{ disclaimer }}</p>
  </aside>
</template>

<script setup lang="ts">
import { CHAMPION_STATS_DISCLAIMER } from '@league-helper/shared';

withDefaults(
  defineProps<{
    disclaimer?: string;
  }>(),
  {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
  },
);
</script>
