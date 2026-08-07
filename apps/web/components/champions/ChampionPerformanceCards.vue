<template>
  <section aria-labelledby="performance-cards-heading" class="space-y-3">
    <div>
      <h2
        id="performance-cards-heading"
        class="font-display text-lg text-[var(--lh-text-secondary)]"
      >
        Performance
      </h2>
      <p class="mt-1 text-sm text-[var(--lh-muted)]">
        Secondary collected-sample averages for the selected position.
      </p>
    </div>

    <p v-if="!metrics" class="text-sm text-[var(--lh-muted)]" role="status">
      Exact-position performance metrics appear when a position is selected and collected sample
      data is available.
    </p>

    <div
      v-else
      class="rounded-lg border p-4 md:p-5"
      style="border-color: var(--lh-border); background: var(--lh-surface)"
      data-testid="performance-panel"
    >
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <section
          v-for="group in groups"
          :key="group.id"
          class="min-w-0 space-y-3"
          :aria-labelledby="`performance-group-${group.id}`"
        >
          <h3
            :id="`performance-group-${group.id}`"
            class="text-xs font-medium uppercase tracking-[0.14em] text-[var(--lh-muted)]"
          >
            {{ group.title }}
          </h3>
          <dl class="space-y-2.5">
            <div
              v-for="metric in group.metrics"
              :key="metric.label"
              class="flex min-w-0 items-baseline justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0"
              style="border-color: var(--lh-border)"
            >
              <dt class="min-w-0 shrink text-sm text-[var(--lh-text-secondary)]">
                {{ metric.label }}
              </dt>
              <dd class="min-w-0 shrink-0 text-right">
                <p
                  class="break-all tabular-nums"
                  :class="
                    metric.emphasis
                      ? 'text-xl font-semibold text-[var(--lh-text)]'
                      : 'text-base font-medium text-[var(--lh-text)]'
                  "
                  :style="metric.toneStyle"
                >
                  {{ metric.value }}
                </p>
                <p v-if="metric.hint" class="mt-0.5 text-xs text-[var(--lh-muted)]">
                  {{ metric.hint }}
                </p>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ChampionAggregateMetrics } from '@league-helper/shared';
import { computed } from 'vue';
import { formatChampionMetric } from '~/utils/champion-metrics';

const props = defineProps<{
  metrics?: ChampionAggregateMetrics | null;
}>();

type MetricRow = {
  label: string;
  value: string;
  hint: string | null;
  emphasis?: boolean;
  toneStyle?: Record<string, string> | undefined;
};

type MetricGroup = {
  id: string;
  title: string;
  metrics: MetricRow[];
};

function signedTone(value: number | null | undefined): Record<string, string> | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return undefined;
  }
  if (value > 0) {
    return { color: 'var(--lh-victory)' };
  }
  return { color: 'var(--lh-defeat)' };
}

function formatOrUnavailable(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): { value: string; hint: string | null } {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { value: 'Unavailable', hint: 'No timeline sample' };
  }
  return {
    value: formatChampionMetric(value, options),
    hint: null,
  };
}

const groups = computed((): MetricGroup[] => {
  const m = props.metrics;
  if (!m) {
    return [];
  }

  const gd10 = formatOrUnavailable(m.averageGoldDifferenceAt10, { digits: 0, signed: true });
  const gd15 = formatOrUnavailable(m.averageGoldDifferenceAt15, { digits: 0, signed: true });
  const csd10 = formatOrUnavailable(m.averageCsDifferenceAt10, { digits: 1, signed: true });
  const csd15 = formatOrUnavailable(m.averageCsDifferenceAt15, { digits: 1, signed: true });

  return [
    {
      id: 'combat',
      title: 'Combat',
      metrics: [
        {
          label: 'KDA',
          value: formatChampionMetric(m.aggregateKdaRatio, { digits: 2 }),
          hint: null,
          emphasis: true,
        },
        {
          label: 'Damage / min',
          value: formatChampionMetric(m.averageDamagePerMinute, { digits: 0 }),
          hint: null,
        },
      ],
    },
    {
      id: 'farming',
      title: 'Farming',
      metrics: [
        {
          label: 'CS / min',
          value: formatChampionMetric(m.averageCsPerMinute, { digits: 1 }),
          hint: null,
          emphasis: true,
        },
      ],
    },
    {
      id: 'vision',
      title: 'Vision',
      metrics: [
        {
          label: 'Vision / min',
          value: formatChampionMetric(m.averageVisionScorePerMinute, { digits: 2 }),
          hint: null,
        },
      ],
    },
    {
      id: 'lane',
      title: 'Lane advantage',
      metrics: [
        {
          label: 'Gold @ 10',
          value: gd10.value,
          hint: gd10.hint,
          toneStyle: signedTone(m.averageGoldDifferenceAt10),
        },
        {
          label: 'Gold @ 15',
          value: gd15.value,
          hint: gd15.hint,
          toneStyle: signedTone(m.averageGoldDifferenceAt15),
        },
        {
          label: 'CS @ 10',
          value: csd10.value,
          hint: csd10.hint,
          toneStyle: signedTone(m.averageCsDifferenceAt10),
        },
        {
          label: 'CS @ 15',
          value: csd15.value,
          hint: csd15.hint,
          toneStyle: signedTone(m.averageCsDifferenceAt15),
        },
      ],
    },
  ];
});
</script>
