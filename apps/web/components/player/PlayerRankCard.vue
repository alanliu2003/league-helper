<template>
  <article
    class="rounded-xl border border-white/10 bg-[var(--lh-bg)]/50 p-4"
    :aria-label="`${queueLabel} ranked stats`"
  >
    <header class="mb-3 flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ queueLabel }}</h3>
      <span
        v-if="rank.hotStreak"
        class="rounded-full bg-[var(--lh-accent)]/20 px-2 py-0.5 text-xs font-medium text-[var(--lh-accent)]"
      >
        Hot streak
      </span>
    </header>

    <p class="text-2xl font-semibold tracking-tight">
      {{ tierLabel }}
      <span v-if="rank.division" class="text-lg text-[var(--lh-muted)]">{{ rank.division }}</span>
    </p>
    <p class="mt-1 text-sm text-[var(--lh-muted)]">{{ rank.leaguePoints }} LP</p>

    <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt class="text-[var(--lh-muted)]">Wins</dt>
        <dd class="font-medium text-[var(--lh-ok)]">{{ rank.wins }}</dd>
      </div>
      <div>
        <dt class="text-[var(--lh-muted)]">Losses</dt>
        <dd class="font-medium text-[var(--lh-bad)]">{{ rank.losses }}</dd>
      </div>
    </dl>

    <p class="mt-3 text-xs text-[var(--lh-muted)]">
      Win rate {{ winRate }}% · {{ rank.wins + rank.losses }} games
    </p>
  </article>
</template>

<script setup lang="ts">
import type { PublicRankSummary, QueueType } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  rank: PublicRankSummary;
}>();

const QUEUE_LABELS: Record<QueueType, string> = {
  RANKED_SOLO_5x5: 'Solo/Duo',
  RANKED_FLEX_SR: 'Flex',
  RANKED_FLEX_TT: 'Flex TT',
  CHERRY: 'Arena',
  STRAWBERRY: 'Strawberry',
  NORMAL: 'Normal',
  ARAM: 'ARAM',
  UNKNOWN: 'Unknown',
};

const queueLabel = computed(() => QUEUE_LABELS[props.rank.queueType] ?? props.rank.queueType);

const tierLabel = computed(() => {
  const tier = props.rank.tier.charAt(0) + props.rank.tier.slice(1).toLowerCase();
  return tier;
});

const winRate = computed(() => {
  const total = props.rank.wins + props.rank.losses;
  if (total === 0) {
    return '0.0';
  }
  return ((props.rank.wins / total) * 100).toFixed(1);
});
</script>
