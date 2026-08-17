<template>
  <section v-if="visible" class="lh-surface-raised space-y-3 p-4 md:p-5" aria-labelledby="match-damage-heading">
    <h2 id="match-damage-heading" class="font-display text-xl">Damage to champions</h2>
    <ul class="space-y-2">
      <li
        v-for="row in rows"
        :key="`${row.teamId}-${row.participantId}`"
        class="space-y-1"
        :class="row.highlighted ? 'rounded-md ring-1 ring-[var(--lh-accent)] p-1' : ''"
      >
        <div class="flex justify-between gap-2 text-sm">
          <span class="truncate">{{ row.label }}</span>
          <span class="tabular-nums text-[var(--lh-text-secondary)]">
            {{ row.damage.toLocaleString() }}
          </span>
        </div>
        <div class="h-2 overflow-hidden rounded-full" style="background: var(--lh-surface-inset)">
          <div
            class="h-full rounded-full"
            :style="{ width: `${row.widthPercent}%`, background: row.color }"
          />
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { formatRiotId, type PublicMatchIngestionStatus, type PublicMatchTeam } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  teams: PublicMatchTeam[];
  ingestionStatus: PublicMatchIngestionStatus;
  originPlayerId?: string | null;
}>();

const participants = computed(() => props.teams.flatMap((team) => team.participants));

const maxDamage = computed(() =>
  participants.value.reduce((max, participant) => Math.max(max, participant.totalDamageDealtToChampions), 0),
);

const visible = computed(
  () => !(maxDamage.value === 0 && props.ingestionStatus !== 'COMPLETED'),
);

const rows = computed(() => {
  return [...participants.value]
    .sort((a, b) => b.totalDamageDealtToChampions - a.totalDamageDealtToChampions)
    .map((participant) => ({
      participantId: participant.participantId,
      teamId: participant.teamId,
      damage: participant.totalDamageDealtToChampions,
      widthPercent: maxDamage.value === 0 ? 0 : (participant.totalDamageDealtToChampions / maxDamage.value) * 100,
      label: participant.riotId ? formatRiotId(participant.riotId) : (participant.championName ?? 'Unknown player'),
      highlighted: props.originPlayerId != null && participant.playerId === props.originPlayerId,
      color: participant.teamId === 100 ? 'var(--lh-team-blue)' : participant.teamId === 200 ? 'var(--lh-team-red)' : 'var(--lh-muted)',
    }));
});
</script>
