<template>
  <aside
    class="lh-surface-raised space-y-3 p-4 md:p-5"
    aria-labelledby="limitations-heading"
    role="note"
  >
    <h2 id="limitations-heading" class="font-display text-lg">Limitations</h2>
    <ul class="list-disc space-y-2 pl-5 text-sm text-[var(--lh-text-secondary)]">
      <li>{{ disclaimer }}</li>
      <li>
        Scope for this view:
        <span class="text-[var(--lh-text)]">{{ scopeSummary }}</span>
      </li>
      <li>
        Collection is search-driven: aggregates only include matches League Helper has ingested
        after player lookups — not a complete regional population.
      </li>
      <li v-if="showRankSemantics">{{ rankTierSemantics }}</li>
      <li>
        These figures are not official Riot statistics and do not claim global or complete coverage.
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import {
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  getMatchQueueLabel,
  getPlatformDisplayName,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    disclaimer?: string;
    rankTierSemantics?: string;
    platform?: PlatformRoute | null;
    queue?: number | null;
    patch?: string | null;
    tier?: ChampionStatsTierFilter | null;
  }>(),
  {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
  },
);

const scopeSummary = computed(() => {
  const parts: string[] = [];
  if (props.platform) {
    parts.push(getPlatformDisplayName(props.platform));
  }
  if (props.queue !== null && props.queue !== undefined) {
    parts.push(getMatchQueueLabel(props.queue));
  }
  if (props.patch) {
    parts.push(`patch ${props.patch}`);
  }
  if (props.tier) {
    parts.push(`tier ${props.tier}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'filters resolving…';
});

const showRankSemantics = computed(() => Boolean(props.tier && props.tier !== 'ALL'));
</script>
