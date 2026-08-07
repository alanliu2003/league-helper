<template>
  <section aria-labelledby="position-breakdown-heading" class="space-y-3">
    <div>
      <h2
        id="position-breakdown-heading"
        class="font-display text-lg text-[var(--lh-text-secondary)]"
      >
        Position breakdown
      </h2>
      <p class="mt-1 text-sm text-[var(--lh-muted)]">
        Where this champion appears in the collected sample, by role.
      </p>
    </div>

    <p v-if="!entries.length" class="text-sm text-[var(--lh-muted)]" role="status">
      Position breakdown is unavailable until statistics load.
    </p>

    <p
      v-else-if="allMissing"
      class="rounded-lg border px-4 py-3 text-sm text-[var(--lh-muted)]"
      style="border-color: var(--lh-border); background: var(--lh-surface)"
      role="status"
      data-testid="position-breakdown-empty"
    >
      No position breakdown data for these filters.
    </p>

    <template v-else>
      <!-- Desktop: semantic table -->
      <div
        class="hidden md:block overflow-x-auto rounded-lg border"
        style="border-color: var(--lh-border)"
      >
        <table class="w-full border-collapse text-left text-sm">
          <thead>
            <tr
              class="border-b text-xs uppercase tracking-wide text-[var(--lh-muted)]"
              style="border-color: var(--lh-border); background: var(--lh-surface)"
            >
              <th scope="col" class="px-3 py-2.5 font-medium">Position</th>
              <th scope="col" class="px-3 py-2.5 font-medium">Games</th>
              <th scope="col" class="px-3 py-2.5 font-medium">Win rate</th>
              <th scope="col" class="px-3 py-2.5 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="`desktop-${row.position}`"
              class="border-b last:border-b-0"
              style="border-color: var(--lh-border)"
              :class="row.position === selectedPosition ? 'bg-[var(--lh-accent)]/10' : ''"
            >
              <th scope="row" class="px-3 py-2.5 font-medium text-[var(--lh-text)]">
                {{ row.label }}
              </th>
              <td class="px-3 py-2.5 tabular-nums text-[var(--lh-text-secondary)]">
                {{ row.gamesLabel }}
              </td>
              <td class="px-3 py-2.5 tabular-nums text-[var(--lh-text)]">
                {{ row.winRateLabel }}
              </td>
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

      <!-- Mobile: stacked rows (display:none on md+ removes from a11y tree) -->
      <ul
        class="space-y-2 md:hidden"
        data-testid="position-breakdown-mobile"
        aria-labelledby="position-breakdown-heading"
      >
        <li
          v-for="row in rows"
          :key="`mobile-${row.position}`"
          data-testid="position-breakdown-row"
          class="rounded-lg border px-3 py-3"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
          :class="row.position === selectedPosition ? 'ring-1 ring-[var(--lh-accent-gold)]/40' : ''"
        >
          <p class="font-medium text-[var(--lh-text)]">{{ row.label }}</p>
          <template v-if="row.hasData">
            <p class="mt-1 text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ row.gamesLabel }}
            </p>
            <p class="mt-0.5 text-sm tabular-nums text-[var(--lh-text)]">
              {{ row.winRateLabel }} WR
            </p>
            <p class="mt-1 text-sm">
              <ChampionsChampionConfidenceIndicator
                v-if="row.confidence"
                :confidence="row.confidence"
              />
            </p>
          </template>
          <p v-else class="mt-1 text-sm text-[var(--lh-muted)]">No data</p>
        </li>
      </ul>
    </template>
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

const allMissing = computed(
  () => props.entries.length > 0 && props.entries.every((entry) => entry.metrics == null),
);

const rows = computed(() =>
  props.entries.map((entry) => {
    const metrics = entry.metrics;
    const confidence: SampleConfidence | null = metrics?.sampleConfidence ?? null;
    const hasData = metrics != null;
    return {
      position: entry.position,
      label: positionDisplayLabel(entry.position),
      hasData,
      gamesLabel: hasData
        ? `${metrics.sampleSize} ${metrics.sampleSize === 1 ? 'game' : 'games'}`
        : 'No data',
      // Missing role → "No data", never 0%.
      winRateLabel: hasData ? formatChampionRate(metrics.winRate) : 'No data',
      confidence,
    };
  }),
);
</script>
