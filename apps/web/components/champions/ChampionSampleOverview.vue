<template>
  <section aria-labelledby="sample-overview-heading" class="space-y-3">
    <h2 id="sample-overview-heading" class="font-display text-xl">Sample overview</h2>
    <p v-if="!metrics" class="text-sm text-[var(--lh-muted)]" role="status">
      {{ emptyMessage }}
    </p>
    <dl
      v-else
      class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div class="lh-surface-raised p-4">
        <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Sample size</dt>
        <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ metrics.sampleSize }}</dd>
      </div>
      <div class="lh-surface-raised p-4">
        <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Record</dt>
        <dd class="mt-1 text-2xl font-semibold tabular-nums">
          {{ metrics.wins }}W – {{ losses }}L
        </dd>
      </div>
      <div class="lh-surface-raised p-4">
        <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Win rate</dt>
        <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ winRateLabel }}</dd>
      </div>
      <div class="lh-surface-raised p-4">
        <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Confidence</dt>
        <dd class="mt-1 text-2xl font-semibold">
          <ChampionsChampionConfidenceIndicator :confidence="metrics.sampleConfidence" />
        </dd>
      </div>
      <div class="lh-surface-raised p-4 sm:col-span-2">
        <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Wilson interval</dt>
        <dd class="mt-1 text-lg tabular-nums text-[var(--lh-text-secondary)]">
          {{ wilsonLabel }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { ChampionAggregateMetrics, ChampionStatsEmptyReason } from '@league-helper/shared';
import { computed } from 'vue';
import {
  deriveLosses,
  formatChampionRate,
  formatWilsonInterval,
} from '~/utils/champion-metrics';

const props = defineProps<{
  metrics?: ChampionAggregateMetrics | null;
  emptyReason?: ChampionStatsEmptyReason | null;
}>();

const losses = computed(() =>
  props.metrics ? deriveLosses(props.metrics.sampleSize, props.metrics.wins) : 0,
);

const winRateLabel = computed(() => formatChampionRate(props.metrics?.winRate ?? null));

const wilsonLabel = computed(() => formatWilsonInterval(props.metrics?.wilsonInterval ?? null));

const emptyMessage = computed(() => {
  switch (props.emptyReason) {
    case 'BELOW_MINIMUM_SAMPLE':
      return 'Not enough collected matches meet the minimum sample size for these filters.';
    case 'NO_MATCHING_AGGREGATES':
    case 'CHAMPION_HAS_NO_STATS':
      return 'No collected-sample statistics for this champion with the selected filters. Choose a position to inspect exact-position metrics when available.';
    case 'FILTERS_EXCLUDED_ALL_ROWS':
      return 'Filters excluded all matching statistics for this champion.';
    default:
      return 'Select a position to load exact-position collected-sample statistics. Role breakdown below stays available without inventing an overall win rate.';
  }
});
</script>
