<template>
  <section class="space-y-4" data-testid="player-playstyle" aria-labelledby="playstyle-heading">
    <h2 id="playstyle-heading" class="font-display text-xl">Your playstyle</h2>

    <p v-if="insufficient" class="text-sm text-[var(--lh-text-secondary)]" role="status">
      Not enough recent Ranked Solo games for a playstyle profile.
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="rounded-full border px-2.5 py-0.5 text-xs font-medium text-[var(--lh-text-secondary)]"
          style="border-color: var(--lh-border)"
        >
          {{ sampleBandLabel }}
        </span>
        <span
          class="rounded-full border px-2.5 py-0.5 text-xs text-[var(--lh-muted)]"
          style="border-color: var(--lh-border)"
        >
          Ranked Solo, last {{ playstyle.sampleScope.matchWindow }}
        </span>
        <span
          class="rounded-full border px-2.5 py-0.5 text-xs text-[var(--lh-muted)]"
          style="border-color: var(--lh-border)"
        >
          {{ playstyle.sampleScope.comparableMatchCount }} comparable
        </span>
      </div>

      <ul v-if="playstyle.mix.length > 0" class="flex flex-wrap gap-2" aria-label="Champion mix">
        <li
          v-for="entry in playstyle.mix"
          :key="`${entry.championKey}-${entry.position}`"
          class="rounded-full border px-2.5 py-0.5 text-xs text-[var(--lh-text-secondary)]"
          style="border-color: var(--lh-border)"
        >
          {{ entry.championName }} · {{ positionDisplayLabel(entry.position) }} ·
          {{ entry.matchCount }}
        </li>
      </ul>

      <div
        data-testid="player-playstyle-overall"
        class="rounded-lg border p-4 md:p-5"
        style="border-color: var(--lh-border); background: var(--lh-surface)"
      >
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <section
            v-for="group in overallGroups"
            :key="group.id"
            class="min-w-0 space-y-3"
            :aria-labelledby="`playstyle-overall-${group.id}`"
          >
            <h3
              :id="`playstyle-overall-${group.id}`"
              class="text-xs font-medium uppercase tracking-[0.14em] text-[var(--lh-muted)]"
            >
              {{ group.title }}
            </h3>
            <dl class="space-y-2.5">
              <div
                v-for="row in group.rows"
                :key="row.metric"
                class="flex min-w-0 items-baseline justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                style="border-color: var(--lh-border)"
              >
                <dt class="min-w-0 shrink text-sm text-[var(--lh-text-secondary)]">
                  {{ metricLabel(row.metric) }}
                </dt>
                <dd class="min-w-0 shrink-0 text-right">
                  <p class="text-sm font-medium" :style="{ color: directionColor(row.direction) }">
                    {{ directionLabel(row.direction) }}
                  </p>
                  <p class="mt-0.5 text-xs text-[var(--lh-muted)]">
                    {{ row.comparableMatchCount }} comparable
                  </p>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <div v-if="playstyle.championSlices.length > 0" class="space-y-4">
        <article
          v-for="slice in playstyle.championSlices"
          :key="`${slice.championKey}-${slice.position}`"
          class="space-y-3 rounded-lg border p-4 md:p-5"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
        >
          <header class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="font-display text-lg">
              {{ slice.championName }}
              <span class="text-sm font-normal text-[var(--lh-muted)]">
                {{ positionDisplayLabel(slice.position) }} · {{ slice.matchCount }} games
              </span>
            </h3>
            <span class="text-xs text-[var(--lh-muted)]">{{
              sampleBandText(slice.sampleBand)
            }}</span>
          </header>

          <div class="space-y-5">
            <section
              v-for="group in sliceGroups(slice.comparisons)"
              :key="`${slice.championKey}-${group.id}`"
              class="min-w-0 space-y-2"
            >
              <h4 class="text-xs font-medium uppercase tracking-[0.14em] text-[var(--lh-muted)]">
                {{ group.title }}
              </h4>
              <div class="-mx-1 overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <caption class="sr-only">
                    {{
                      slice.championName
                    }}
                    {{
                      group.title
                    }}
                    compared with matched baselines
                  </caption>
                  <thead>
                    <tr class="text-xs text-[var(--lh-muted)]">
                      <th scope="col" class="py-1 pr-3 font-medium">Metric</th>
                      <th scope="col" class="py-1 pr-3 font-medium">You</th>
                      <th scope="col" class="py-1 pr-3 font-medium">Baseline</th>
                      <th scope="col" class="py-1 pr-3 font-medium">Δ</th>
                      <th scope="col" class="py-1 pr-3 font-medium">Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in group.rows"
                      :key="row.metric"
                      class="border-t"
                      style="border-color: var(--lh-border)"
                    >
                      <th scope="row" class="py-2 pr-3 font-normal text-[var(--lh-text-secondary)]">
                        {{ metricLabel(row.metric) }}
                      </th>
                      <td class="py-2 pr-3 tabular-nums">
                        {{ formatSliceNumber(row.playerValue) }}
                      </td>
                      <td class="py-2 pr-3 tabular-nums">
                        {{ formatSliceNumber(row.baseline?.value ?? null) }}
                      </td>
                      <td class="py-2 pr-3 tabular-nums">{{ formatSliceDelta(row.delta) }}</td>
                      <td class="py-2 pr-3" :style="{ color: directionColor(row.direction) }">
                        {{ directionLabel(row.direction) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p
                v-for="row in group.rows"
                :key="`${row.metric}-n`"
                class="text-xs text-[var(--lh-muted)]"
              >
                {{ metricLabel(row.metric) }}: {{ row.comparableMatchCount }} comparable · baseline
                n={{ row.baseline?.sampleSize ?? 0 }}
              </p>
            </section>
          </div>
        </article>
      </div>
    </template>

    <aside class="space-y-2 text-xs text-[var(--lh-muted)]" role="note">
      <p>{{ playstyle.disclaimer }}</p>
      <p>{{ playstyle.rankSemantics }}</p>
    </aside>

    <PlayerPlaystyleAiPanel
      v-if="!insufficient"
      :ai="playstyle.ai"
      :ai-disclaimer="playstyle.aiDisclaimer"
      :pending="pending"
    />
  </section>
</template>

<script setup lang="ts">
import type {
  PlayerMetricComparison,
  PlayerPlaystyleDirection,
  PlayerPlaystyleMetricId,
  PlayerPlaystyleResponse,
  PlayerPlaystyleSampleBand,
} from '@league-helper/shared';
import { computed } from 'vue';
import { formatChampionMetric, positionDisplayLabel } from '~/utils/champion-metrics';
import PlayerPlaystyleAiPanel from '~/components/player/PlayerPlaystyleAiPanel.vue';

const METRIC_LABELS: Record<PlayerPlaystyleMetricId, string> = {
  CS_PER_MIN: 'CS/min',
  GOLD_PER_MIN: 'Gold/min',
  DAMAGE_PER_MIN: 'Damage/min',
  VISION_PER_MIN: 'Vision/min',
  KILLS_PER_GAME: 'Kills/game',
  DEATHS_PER_GAME: 'Deaths/game',
  ASSISTS_PER_GAME: 'Assists/game',
  KDA: 'KDA',
  GOLD_DIFF_AT_10: 'Gold diff @10',
  GOLD_DIFF_AT_15: 'Gold diff @15',
  CS_DIFF_AT_10: 'CS diff @10',
  CS_DIFF_AT_15: 'CS diff @15',
};

const DIRECTION_LABELS: Record<PlayerPlaystyleDirection, string> = {
  ABOVE_BASELINE: 'Above baseline',
  NEAR_BASELINE: 'Near baseline',
  BELOW_BASELINE: 'Below baseline',
  NOT_COMPARABLE: 'Not comparable',
};

const OVERALL_GROUP_DEFS = [
  { id: 'farming', title: 'Farming', metrics: ['CS_PER_MIN', 'GOLD_PER_MIN'] },
  {
    id: 'combat',
    title: 'Combat',
    metrics: ['KILLS_PER_GAME', 'DEATHS_PER_GAME', 'ASSISTS_PER_GAME', 'DAMAGE_PER_MIN'],
  },
  { id: 'vision', title: 'Vision', metrics: ['VISION_PER_MIN'] },
  {
    id: 'early',
    title: 'Early lane',
    metrics: ['GOLD_DIFF_AT_10', 'GOLD_DIFF_AT_15', 'CS_DIFF_AT_10', 'CS_DIFF_AT_15'],
  },
] as const;

const SLICE_GROUP_DEFS = [
  { id: 'farming', title: 'Farming', metrics: ['CS_PER_MIN', 'GOLD_PER_MIN'] },
  {
    id: 'combat',
    title: 'Combat',
    metrics: ['KILLS_PER_GAME', 'DEATHS_PER_GAME', 'ASSISTS_PER_GAME', 'DAMAGE_PER_MIN', 'KDA'],
  },
  { id: 'vision', title: 'Vision', metrics: ['VISION_PER_MIN'] },
  {
    id: 'early',
    title: 'Early lane',
    metrics: ['GOLD_DIFF_AT_10', 'GOLD_DIFF_AT_15', 'CS_DIFF_AT_10', 'CS_DIFF_AT_15'],
  },
] as const;

const props = withDefaults(
  defineProps<{
    playstyle: PlayerPlaystyleResponse;
    pending?: boolean;
  }>(),
  {
    pending: false,
  },
);

const insufficient = computed(
  () => props.playstyle.sampleScope.playerSampleBand === 'INSUFFICIENT',
);

const sampleBandLabel = computed(() =>
  sampleBandText(props.playstyle.sampleScope.playerSampleBand),
);

type MetricGroup = {
  id: string;
  title: string;
  rows: PlayerMetricComparison[];
};

function rowsForMetrics(
  comparisons: PlayerMetricComparison[],
  metricIds: readonly PlayerPlaystyleMetricId[],
): PlayerMetricComparison[] {
  const byMetric = new Map(comparisons.map((row) => [row.metric, row]));
  const rows: PlayerMetricComparison[] = [];
  for (const metric of metricIds) {
    const row = byMetric.get(metric);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

const overallGroups = computed((): MetricGroup[] => {
  return OVERALL_GROUP_DEFS.flatMap((group) => {
    const rows = rowsForMetrics(props.playstyle.overall.comparisons, group.metrics);
    return rows.length > 0 ? [{ id: group.id, title: group.title, rows }] : [];
  });
});

function sliceGroups(comparisons: PlayerMetricComparison[]): MetricGroup[] {
  return SLICE_GROUP_DEFS.flatMap((group) => {
    const rows = rowsForMetrics(comparisons, group.metrics);
    return rows.length > 0 ? [{ id: group.id, title: group.title, rows }] : [];
  });
}

function metricLabel(metric: PlayerPlaystyleMetricId): string {
  return METRIC_LABELS[metric];
}

function directionLabel(direction: PlayerPlaystyleDirection): string {
  return DIRECTION_LABELS[direction];
}

function directionColor(direction: PlayerPlaystyleDirection): string {
  switch (direction) {
    case 'ABOVE_BASELINE':
      return 'var(--lh-victory)';
    case 'BELOW_BASELINE':
      return 'var(--lh-defeat)';
    default:
      return 'var(--lh-muted)';
  }
}

function sampleBandText(band: PlayerPlaystyleSampleBand): string {
  switch (band) {
    case 'INSUFFICIENT':
      return 'Insufficient';
    case 'EXPLORATORY':
      return 'Exploratory';
    case 'CREDIBLE':
      return 'Credible';
    case 'STRONG':
      return 'Strong';
    default:
      return band;
  }
}

function formatSliceNumber(value: number | null): string {
  return formatChampionMetric(value, { digits: 1 });
}

function formatSliceDelta(value: number | null): string {
  return formatChampionMetric(value, { digits: 1, signed: true });
}
</script>
