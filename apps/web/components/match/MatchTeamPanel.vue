<template>
  <section class="lh-surface-raised space-y-4 p-4 md:p-5" :aria-labelledby="headingId">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 :id="headingId" class="font-display text-xl" :style="{ color: sideColor }">
        {{ heading }}
        <span v-if="resultLabel" class="ml-2 text-base font-sans font-semibold">{{ resultLabel }}</span>
      </h2>
      <p class="text-sm text-[var(--lh-text-secondary)]">
        {{ team.totals.kills }} kills · {{ team.totals.goldEarned.toLocaleString() }} gold ·
        {{ team.totals.damageDealtToChampions.toLocaleString() }} damage
      </p>
    </header>

    <ul v-if="team.bans.length > 0" class="flex flex-wrap gap-1" aria-label="Bans">
      <li v-for="ban in team.bans" :key="ban.id">
        <img
          v-if="ban.iconUrl"
          :src="ban.iconUrl"
          :alt="`Banned ${ban.name}`"
          width="24"
          height="24"
          class="h-6 w-6 rounded-sm"
        />
        <span v-else class="text-xs text-[var(--lh-muted)]">{{ ban.name }}</span>
      </li>
    </ul>

    <MatchObjectiveSummary :objectives="team.objectives" />

    <div class="flex flex-col gap-2">
      <MatchParticipantRow
        v-for="participant in team.participants"
        :key="participant.participantId"
        :participant="participant"
        :highlighted="originPlayerId != null && participant.playerId === originPlayerId"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PublicMatchTeam } from '@league-helper/shared';
import { computed } from 'vue';
import MatchObjectiveSummary from './MatchObjectiveSummary.vue';
import MatchParticipantRow from './MatchParticipantRow.vue';

const props = defineProps<{
  team: PublicMatchTeam;
  remake?: boolean;
  originPlayerId?: string | null;
}>();

const headingId = computed(() => `match-team-${props.team.teamId}`);

const heading = computed(() => {
  if (props.team.side === 'BLUE') return 'Blue Team';
  if (props.team.side === 'RED') return 'Red Team';
  return `Team ${props.team.teamId}`;
});

const resultLabel = computed(() => {
  if (props.remake) {
    return 'Remake';
  }
  return props.team.win ? 'Victory' : 'Defeat';
});

const sideColor = computed(() => {
  if (props.team.side === 'BLUE') return 'var(--lh-team-blue)';
  if (props.team.side === 'RED') return 'var(--lh-team-red)';
  return 'var(--lh-text)';
});
</script>
