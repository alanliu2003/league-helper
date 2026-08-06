<template>
  <section aria-labelledby="position-breakdown-heading" class="space-y-3">
    <div>
      <h2 id="position-breakdown-heading" class="font-display text-xl">Position breakdown</h2>
      <p class="mt-1 text-sm text-[var(--lh-muted)]">
        Five standard roles from one collected-sample response. Missing roles show no data — never
        a fabricated 0% win rate.
      </p>
    </div>

    <p v-if="!entries.length" class="text-sm text-[var(--lh-muted)]" role="status">
      Position breakdown is unavailable until statistics load.
    </p>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[28rem] border-collapse text-left text-sm">
        <thead>
          <tr
            class="border-b text-xs uppercase tracking-wide text-[var(--lh-muted)]"
            style="border-color: var(--lh-border)"
          >
            <th scope="col" class="px-3 py-2 font-medium">Position</th>
            <th scope="col" class="px-3 py-2 font-medium">Sample</th>
            <th scope="col" class="px-3 py-2 font-medium">Win rate</th>
            <th scope="col" class="px-3 py-2 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.position"
            class="border-b"
            style="border-color: var(--lh-border)"
            :class="row.position === selectedPosition ? 'bg-[var(--lh-accent)]/10' : ''"
          >
            <td class="px-3 py-2.5 font-medium">{{ row.label }}</td>
            <td class="px-3 py-2.5 tabular-nums text-[var(--lh-text-secondary)]">
              {{ row.sampleLabel }}
            </td>
            <td class="px-3 py-2.5 tabular-nums">{{ row.winRateLabel }}</td>
            <td class="px-3 py-2.5">
              <ChampionsChampionConfidenceIndicator
                v-if="row.confidence"
                :confidence="row.confidence"
              />
              <span v-else class="text-[var(--lh-muted)]">No data</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import type {
  ChampionPositionBreakdownEntry,
  ChampionRankingPosition,
  SampleConfidence,
} from '@league-helper/shared';
import { computed } from 'vue';
import { formatChampionRate, positionDisplayLabel } from '~/utils/champion-metrics';

const props = defineProps<{
  entries: ChampionPositionBreakdownEntry[];
  selectedPosition?: ChampionRankingPosition | null;
}>();

const rows = computed(() =>
  props.entries.map((entry) => {
    const metrics = entry.metrics;
    const confidence: SampleConfidence | null = metrics?.sampleConfidence ?? null;
    return {
      position: entry.position,
      label: positionDisplayLabel(entry.position),
      sampleLabel: metrics ? String(metrics.sampleSize) : 'No data',
      // Missing role → "No data", never 0%.
      winRateLabel: metrics ? formatChampionRate(metrics.winRate) : 'No data',
      confidence,
    };
  }),
);
</script>
