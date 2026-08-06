<template>
  <section aria-labelledby="performance-cards-heading" class="space-y-3">
    <h2 id="performance-cards-heading" class="font-display text-xl">Performance</h2>
    <p v-if="!metrics" class="text-sm text-[var(--lh-muted)]" role="status">
      Exact-position performance metrics appear when a position is selected and collected sample
      data is available.
    </p>
    <ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <li
        v-for="card in cards"
        :key="card.label"
        class="lh-surface-raised p-4"
      >
        <p class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">{{ card.label }}</p>
        <p class="mt-1 text-xl font-semibold tabular-nums" :class="card.valueClass">
          {{ card.value }}
        </p>
        <p v-if="card.hint" class="mt-1 text-xs text-[var(--lh-muted)]">{{ card.hint }}</p>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { ChampionAggregateMetrics } from '@league-helper/shared';
import { computed } from 'vue';
import { formatChampionMetric } from '~/utils/champion-metrics';

const props = defineProps<{
  metrics?: ChampionAggregateMetrics | null;
}>();

const cards = computed(() => {
  const m = props.metrics;
  if (!m) {
    return [];
  }
  return [
    {
      label: 'KDA',
      value: formatChampionMetric(m.aggregateKdaRatio, { digits: 2 }),
      hint: null as string | null,
      valueClass: '',
    },
    {
      label: 'CS / min',
      value: formatChampionMetric(m.averageCsPerMinute, { digits: 2 }),
      hint: null,
      valueClass: '',
    },
    {
      label: 'Damage / min',
      value: formatChampionMetric(m.averageDamagePerMinute, { digits: 0 }),
      hint: null,
      valueClass: '',
    },
    {
      label: 'Vision / min',
      value: formatChampionMetric(m.averageVisionScorePerMinute, { digits: 2 }),
      hint: null,
      valueClass: '',
    },
    {
      label: 'GD@10',
      value: formatChampionMetric(m.averageGoldDifferenceAt10, { digits: 0, signed: true }),
      hint: m.averageGoldDifferenceAt10 === null ? 'Timeline metric unavailable' : null,
      valueClass: '',
    },
    {
      label: 'GD@15',
      value: formatChampionMetric(m.averageGoldDifferenceAt15, { digits: 0, signed: true }),
      hint: m.averageGoldDifferenceAt15 === null ? 'Timeline metric unavailable' : null,
      valueClass: '',
    },
    {
      label: 'CSD@10',
      value: formatChampionMetric(m.averageCsDifferenceAt10, { digits: 1, signed: true }),
      hint: m.averageCsDifferenceAt10 === null ? 'Timeline metric unavailable' : null,
      valueClass: '',
    },
    {
      label: 'CSD@15',
      value: formatChampionMetric(m.averageCsDifferenceAt15, { digits: 1, signed: true }),
      hint: m.averageCsDifferenceAt15 === null ? 'Timeline metric unavailable' : null,
      valueClass: '',
    },
  ];
});
</script>
