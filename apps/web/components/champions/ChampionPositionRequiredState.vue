<template>
  <div class="lh-surface-raised px-6 py-10 text-center" role="status">
    <h2 class="font-display text-xl text-[var(--lh-text)]">{{ title }}</h2>
    <p class="mx-auto mt-3 max-w-md text-sm text-[var(--lh-text-secondary)]">
      {{ description }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** When false, the selected queue cannot use standard role ranking. */
    supportsPositions?: boolean;
  }>(),
  {
    supportsPositions: true,
  },
);

const title = computed(() =>
  props.supportsPositions ? 'Select a position' : 'Role ranking unavailable',
);

const description = computed(() =>
  props.supportsPositions
    ? 'Collected sample ranking requires a lane position. The champion directory below stays available without a position.'
    : 'This queue does not support standard lane positions for collected sample ranking. Browse the champion directory below instead.',
);
</script>
