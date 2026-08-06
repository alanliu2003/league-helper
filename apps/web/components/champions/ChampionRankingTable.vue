<template>
  <section aria-labelledby="collected-sample-ranking-heading" class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="collected-sample-ranking-heading" class="font-display text-xl">
          Collected sample ranking
        </h2>
        <p class="mt-1 text-sm text-[var(--lh-muted)]">
          Sorted by collected-sample win rate for the selected filters. Not a tier list.
        </p>
      </div>
      <div
        v-if="sampleScope"
        class="text-right text-xs text-[var(--lh-muted)]"
        aria-live="polite"
      >
        <p>
          <span class="text-[var(--lh-text-secondary)]">{{ platformLabel }}</span>
          ·
          <span class="text-[var(--lh-text-secondary)]">{{ queueLabel }}</span>
        </p>
        <p>Patch {{ sampleScope.patch }} · {{ freshnessLabel }}</p>
      </div>
    </div>

    <p
      v-if="tierWarning"
      class="rounded-md border px-3 py-2 text-xs text-[var(--lh-warning)]"
      style="border-color: rgba(230, 168, 23, 0.35); background: rgba(230, 168, 23, 0.08)"
      role="note"
    >
      {{ tierWarning }}
    </p>

    <p
      v-if="isUpdating"
      class="text-sm text-[var(--lh-accent)]"
      role="status"
      aria-live="polite"
    >
      Updating ranking…
    </p>
    <p v-if="error" class="text-sm text-[var(--lh-warning)]" role="status" aria-live="polite">
      {{ error }} Showing the previous result when available.
    </p>
    <p v-if="loading && !rows.length" class="text-sm text-[var(--lh-muted)]" role="status">
      Loading collected sample ranking…
    </p>
    <p
      v-else-if="!loading && !rows.length && !error"
      class="text-sm text-[var(--lh-muted)]"
      role="status"
    >
      {{ emptyLabel }}
    </p>

    <!-- Desktop table -->
    <div v-if="rows.length > 0" class="hidden overflow-x-auto md:block">
      <table class="w-full min-w-[40rem] border-collapse text-left text-sm">
        <thead>
          <tr class="border-b text-xs uppercase tracking-wide text-[var(--lh-muted)]" style="border-color: var(--lh-border)">
            <th scope="col" class="px-3 py-2 font-medium">Champion</th>
            <th scope="col" class="px-3 py-2 font-medium">Sample</th>
            <th scope="col" class="px-3 py-2 font-medium">Win rate</th>
            <th scope="col" class="px-3 py-2 font-medium">Wilson 95%</th>
            <th scope="col" class="px-3 py-2 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.champion.championId"
            class="border-b"
            style="border-color: var(--lh-border)"
          >
            <td class="px-3 py-2.5">
              <NuxtLink
                :to="linkFor(row.champion.championKey)"
                class="flex items-center gap-2 text-[var(--lh-text)] no-underline hover:text-[var(--lh-accent)]"
              >
                <img
                  v-if="row.champion.iconUrl"
                  :src="row.champion.iconUrl"
                  :alt="`${row.champion.name} icon`"
                  width="32"
                  height="32"
                  class="h-8 w-8 rounded object-cover"
                  style="background: var(--lh-surface-inset)"
                  loading="lazy"
                />
                <span class="font-medium">{{ row.champion.name }}</span>
              </NuxtLink>
            </td>
            <td class="px-3 py-2.5 tabular-nums">{{ row.metrics.sampleSize }}</td>
            <td class="px-3 py-2.5 tabular-nums">{{ formatRate(row.metrics.winRate) }}</td>
            <td class="px-3 py-2.5 tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatWilson(row.metrics.wilsonInterval) }}
            </td>
            <td class="px-3 py-2.5">
              <span :class="confidenceClass(row.metrics.sampleConfidence)">
                {{ row.metrics.sampleConfidence }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <ul v-if="rows.length > 0" class="space-y-2 md:hidden">
      <li
        v-for="row in rows"
        :key="row.champion.championId"
        class="rounded-lg border px-3 py-3"
        style="border-color: var(--lh-border); background: var(--lh-surface)"
      >
        <NuxtLink
          :to="linkFor(row.champion.championKey)"
          class="flex items-center gap-3 text-[var(--lh-text)] no-underline"
        >
          <img
            v-if="row.champion.iconUrl"
            :src="row.champion.iconUrl"
            :alt="`${row.champion.name} icon`"
            width="40"
            height="40"
            class="h-10 w-10 rounded-md object-cover"
            style="background: var(--lh-surface-inset)"
            loading="lazy"
          />
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ row.champion.name }}</p>
            <p class="mt-0.5 text-xs text-[var(--lh-muted)]">
              n={{ row.metrics.sampleSize }} · WR {{ formatRate(row.metrics.winRate) }} ·
              {{ row.metrics.sampleConfidence }}
            </p>
            <p class="text-xs text-[var(--lh-muted)]">
              Wilson {{ formatWilson(row.metrics.wilsonInterval) }}
            </p>
          </div>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import {
  RANK_TIER_SEMANTICS,
  getMatchQueueLabel,
  getPlatformDisplayName,
  type ChampionAggregateRow,
  type ChampionStatsFreshness,
  type ChampionStatsTierFilter,
  type ConfidenceInterval,
  type PlatformRoute,
  type SampleConfidence,
  type SampleScope,
} from '@league-helper/shared';
import { computed } from 'vue';
import { buildChampionPath, type ChampionAggregateLinkFilters } from '~/utils/champion-links';

const props = defineProps<{
  rows: ChampionAggregateRow[];
  sampleScope?: SampleScope | null;
  freshness?: ChampionStatsFreshness | null;
  tier?: ChampionStatsTierFilter | null;
  loading?: boolean;
  isUpdating?: boolean;
  error?: string | null;
  emptyReason?: string | null;
  linkFilters?: ChampionAggregateLinkFilters;
}>();

const platformLabel = computed(() => {
  if (!props.sampleScope) {
    return '';
  }
  return getPlatformDisplayName(props.sampleScope.platform as PlatformRoute);
});

const queueLabel = computed(() => {
  if (!props.sampleScope) {
    return '';
  }
  return getMatchQueueLabel(props.sampleScope.queueId);
});

const freshnessLabel = computed(() => {
  switch (props.freshness) {
    case 'CURRENT':
      return 'Current';
    case 'RECALCULATION_PENDING':
      return 'Recalculation pending';
    case 'UNKNOWN':
      return 'Freshness unknown';
    default:
      return '';
  }
});

const tierWarning = computed(() => {
  if (!props.tier || props.tier === 'ALL') {
    return null;
  }
  return RANK_TIER_SEMANTICS;
});

const emptyLabel = computed(() => {
  switch (props.emptyReason) {
    case 'BELOW_MINIMUM_SAMPLE':
      return 'No champions meet the minimum sample size for these filters.';
    case 'FILTERS_EXCLUDED_ALL_ROWS':
      return 'Filters excluded all ranking rows.';
    case 'NO_MATCHING_AGGREGATES':
    default:
      return 'No collected-sample ranking rows for these filters.';
  }
});

function linkFor(championKey: string): string {
  return buildChampionPath(championKey, props.linkFilters ?? {});
}

function formatRate(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatWilson(interval: ConfidenceInterval | null): string {
  if (!interval) {
    return '—';
  }
  return `${(interval.lowerBound * 100).toFixed(1)}–${(interval.upperBound * 100).toFixed(1)}%`;
}

function confidenceClass(confidence: SampleConfidence): string {
  switch (confidence) {
    case 'HIGH':
      return 'text-[var(--lh-victory)]';
    case 'MEDIUM':
      return 'text-[var(--lh-accent)]';
    case 'LOW':
      return 'text-[var(--lh-warning)]';
    case 'INSUFFICIENT':
    default:
      return 'text-[var(--lh-muted)]';
  }
}
</script>
