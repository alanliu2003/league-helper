<template>
  <section aria-labelledby="ranks-heading" class="space-y-4">
    <h2 id="ranks-heading" class="font-display text-xl">Ranked</h2>
    <div class="grid gap-4 sm:grid-cols-2">
      <PlayerRankCard queue-label="Solo/Duo" :rank="soloRank" :unranked="!soloRank" />
      <PlayerRankCard queue-label="Flex" :rank="flexRank" :unranked="!flexRank" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PublicRankSummary } from '@league-helper/shared';
import { computed } from 'vue';
import PlayerRankCard from '~/components/player/PlayerRankCard.vue';

const props = defineProps<{
  ranks: PublicRankSummary[];
}>();

const soloRank = computed(() => props.ranks.find((r) => r.queueType === 'RANKED_SOLO_5x5') ?? null);

const flexRank = computed(() => props.ranks.find((r) => r.queueType === 'RANKED_FLEX_SR') ?? null);
</script>
