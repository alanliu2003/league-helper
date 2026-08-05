<template>
  <article class="lh-surface flex flex-col p-5" :aria-label="`${queueLabel} ranked stats`">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-[var(--lh-text-secondary)]">
        {{ queueLabel }}
      </h3>
      <span
        v-if="rank?.hotStreak"
        class="rounded-full px-2 py-0.5 text-xs font-medium"
        style="background: rgba(61, 156, 240, 0.15); color: var(--lh-accent)"
      >
        Hot streak
      </span>
    </header>

    <template v-if="unranked || !rank">
      <p class="font-display text-2xl font-semibold text-[var(--lh-muted)]">Unranked</p>
      <p class="mt-2 text-sm text-[var(--lh-muted)]">
        No ranked games recorded for this queue yet.
      </p>
    </template>

    <template v-else>
      <p class="font-display text-3xl font-semibold tracking-tight">
        {{ tierLabel }}
        <span v-if="rank.division" class="text-xl text-[var(--lh-muted)]">{{ rank.division }}</span>
      </p>
      <p class="mt-1 text-sm text-[var(--lh-accent-gold)]">{{ rank.leaguePoints }} LP</p>

      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-[var(--lh-muted)]">Wins</dt>
          <dd class="font-medium" style="color: var(--lh-victory)">{{ rank.wins }}</dd>
        </div>
        <div>
          <dt class="text-[var(--lh-muted)]">Losses</dt>
          <dd class="font-medium" style="color: var(--lh-defeat)">{{ rank.losses }}</dd>
        </div>
      </dl>

      <p v-if="totalGames > 0" class="mt-3 text-xs text-[var(--lh-muted)]">
        Win rate {{ winRate }}% · {{ totalGames }} games
      </p>
    </template>
  </article>
</template>

<script setup lang="ts">
import type { PublicRankSummary } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  queueLabel: string;
  rank?: PublicRankSummary | null;
  unranked?: boolean;
}>();

const tierLabel = computed(() => {
  if (!props.rank) {
    return '';
  }
  const tier = props.rank.tier;
  return tier.charAt(0) + tier.slice(1).toLowerCase();
});

const totalGames = computed(() => {
  if (!props.rank) {
    return 0;
  }
  return props.rank.wins + props.rank.losses;
});

const winRate = computed(() => {
  if (!props.rank || totalGames.value === 0) {
    return '0.0';
  }
  return ((props.rank.wins / totalGames.value) * 100).toFixed(1);
});
</script>
