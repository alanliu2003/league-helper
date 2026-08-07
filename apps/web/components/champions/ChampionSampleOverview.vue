<template>
  <section aria-labelledby="primary-stats-heading" class="space-y-4">
    <h2 id="primary-stats-heading" class="font-display text-xl">Primary stats</h2>

    <p v-if="pending" class="text-sm text-[var(--lh-muted)]" role="status" aria-live="polite">
      Loading collected sample statistics…
    </p>

    <p
      v-else-if="!metrics"
      class="text-sm text-[var(--lh-muted)]"
      role="status"
      data-testid="primary-stats-empty"
    >
      {{ emptyMessage }}
    </p>

    <div
      v-else
      data-testid="primary-stats-metrics"
      class="lh-surface-raised grid min-w-0 gap-5 p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:items-end sm:p-5 md:gap-8 md:p-6"
    >
      <div class="min-w-0 space-y-2">
        <p class="text-xs uppercase tracking-[0.16em] text-[var(--lh-muted)]">Win rate</p>
        <p
          class="break-words font-display text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl"
          style="color: var(--lh-text)"
        >
          {{ winRateLabel }}
        </p>
        <p class="text-base tabular-nums text-[var(--lh-text)]">
          <span class="font-semibold">{{ metrics.sampleSize }}</span>
          {{ metrics.sampleSize === 1 ? 'game' : 'games' }}
        </p>
      </div>

      <dl class="grid min-w-0 gap-4 sm:justify-items-start">
        <div class="min-w-0">
          <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">W–L</dt>
          <dd class="mt-1 text-2xl font-semibold tabular-nums text-[var(--lh-text)]">
            <span class="sr-only">Wins and losses </span>{{ winsLossesLabel }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Confidence</dt>
          <dd class="mt-1">
            <p v-if="isLimitedSample" class="text-sm font-medium text-[var(--lh-muted)]">
              Limited sample
            </p>
            <ChampionsChampionConfidenceIndicator v-else :confidence="metrics.sampleConfidence" />
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ChampionAggregateMetrics, ChampionStatsEmptyReason } from '@league-helper/shared';
import { computed } from 'vue';
import { deriveLosses, formatChampionRate } from '~/utils/champion-metrics';

const props = withDefaults(
  defineProps<{
    metrics?: ChampionAggregateMetrics | null;
    emptyReason?: ChampionStatsEmptyReason | null;
    pending?: boolean;
  }>(),
  {
    metrics: null,
    emptyReason: null,
    pending: false,
  },
);

const losses = computed(() =>
  props.metrics ? deriveLosses(props.metrics.sampleSize, props.metrics.wins) : 0,
);

const winRateLabel = computed(() => formatChampionRate(props.metrics?.winRate ?? null));

const winsLossesLabel = computed(() => {
  if (!props.metrics) {
    return '';
  }
  return `${props.metrics.wins}–${losses.value}`;
});

const isLimitedSample = computed(() => props.metrics?.sampleConfidence === 'INSUFFICIENT');

const emptyMessage = computed(() => {
  switch (props.emptyReason) {
    case 'NO_MATCHING_AGGREGATES':
    case 'CHAMPION_HAS_NO_STATS':
      return 'No collected-sample statistics for this champion with the selected filters.';
    case 'FILTERS_EXCLUDED_ALL_ROWS':
      return 'Filters excluded all matching statistics for this champion.';
    case 'BELOW_MINIMUM_SAMPLE':
      // Detail reads no longer use ranking-floor empty for 1–29; keep honest fallback.
      return 'No collected-sample statistics are available for these filters.';
    default:
      return 'Select a position to load exact-position collected-sample statistics.';
  }
});
</script>
