<template>
  <span :class="toneClass" :aria-label="`Sample confidence ${confidence}`">
    {{ confidence }}
  </span>
</template>

<script setup lang="ts">
import type { SampleConfidence } from '@league-helper/shared';
import { computed } from 'vue';
import { confidenceToneClass } from '~/utils/champion-metrics';

const props = defineProps<{
  confidence: SampleConfidence;
}>();

const toneClass = computed(() => confidenceToneClass(props.confidence));
</script>
