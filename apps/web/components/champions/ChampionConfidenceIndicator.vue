<template>
  <span :class="toneClass" :aria-label="`Sample confidence ${displayLabel}`">
    {{ displayLabel }}
  </span>
</template>

<script setup lang="ts">
import type { SampleConfidence } from '@league-helper/shared';
import { computed } from 'vue';
import { confidenceToneClass } from '~/utils/champion-metrics';

const props = defineProps<{
  confidence: SampleConfidence;
}>();

const displayLabel = computed(() =>
  props.confidence === 'INSUFFICIENT' ? 'Limited sample' : props.confidence,
);

const toneClass = computed(() => confidenceToneClass(props.confidence));
</script>
