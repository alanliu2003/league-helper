<template>
  <section
    v-if="showPanel"
    class="space-y-3 rounded-lg border p-4 md:p-5"
    style="border-color: var(--lh-border); background: var(--lh-surface)"
    data-testid="champion-ai-insight"
    :aria-labelledby="availableCopy ? headingId : undefined"
  >
    <p v-if="statusMessage" class="text-sm text-[var(--lh-muted)]" role="status" aria-live="polite">
      {{ statusMessage }}
    </p>

    <template v-else-if="availableCopy">
      <h2 :id="headingId" class="font-display text-lg">{{ heading }}</h2>
      <p class="text-sm text-[var(--lh-text-secondary)]">{{ availableCopy }}</p>
      <ul v-if="claimLines.length > 0" class="space-y-1.5">
        <li v-for="line in claimLines" :key="line" class="text-sm text-[var(--lh-text-secondary)]">
          {{ line }}
        </li>
      </ul>
      <p class="text-xs text-[var(--lh-muted)]">{{ disclaimer }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { CHAMPION_AI_DISCLAIMER, type ChampionAiInsightsResponse } from '@league-helper/shared';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    response: ChampionAiInsightsResponse | null;
    pending?: boolean;
    error?: string | null;
    variant: 'overview' | 'builds';
  }>(),
  {
    pending: false,
    error: null,
  },
);

const insight = computed(() => props.response?.insight ?? null);

const heading = computed(() => (props.variant === 'builds' ? 'AI explanation' : 'AI Insight'));

const headingId = computed(() =>
  props.variant === 'builds' ? 'champion-ai-build-heading' : 'champion-ai-insight-heading',
);

const disclaimer = computed(() => props.response?.aiDisclaimer ?? CHAMPION_AI_DISCLAIMER);

const availableCopy = computed(() => {
  if (props.pending || props.response?.status !== 'AVAILABLE' || !insight.value) {
    return null;
  }
  if (props.variant === 'builds') {
    return insight.value.buildInsight;
  }
  return insight.value.summary;
});

const claimLines = computed(() => {
  if (props.variant !== 'overview' || !availableCopy.value || !insight.value) {
    return [];
  }
  return [...insight.value.strengths.slice(0, 2), ...insight.value.weaknesses.slice(0, 2)];
});

const statusMessage = computed(() => {
  if (availableCopy.value) {
    return null;
  }
  if (props.pending || props.response?.status === 'PENDING') {
    return 'Generating AI insight…';
  }
  if (props.response?.status === 'LOW_CONFIDENCE') {
    return 'Not enough collected-sample evidence for an AI explanation.';
  }
  if (
    props.error ||
    props.response?.status === 'UNAVAILABLE' ||
    props.response?.status === 'AVAILABLE'
  ) {
    return 'AI insight unavailable.';
  }
  return null;
});

const showPanel = computed(() => {
  if (props.pending || props.error) {
    return true;
  }
  const status = props.response?.status;
  if (!status || status === 'DISABLED') {
    return false;
  }
  if (props.variant === 'builds' && status === 'AVAILABLE' && !insight.value?.buildInsight) {
    return false;
  }
  return true;
});
</script>
