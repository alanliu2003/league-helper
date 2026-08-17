<template>
  <section v-if="visible" class="lh-surface-raised space-y-3 p-4 md:p-5" aria-labelledby="match-early-heading">
    <h2 id="match-early-heading" class="font-display text-xl">Early game</h2>
    <p v-if="processing" class="text-sm text-[var(--lh-muted)]" role="status">
      Early-game stats are still processing.
    </p>
    <dl v-else class="grid gap-2 text-sm sm:grid-cols-2">
      <div v-for="metric in metrics" :key="metric.label">
        <dt class="text-[var(--lh-muted)]">{{ metric.label }}</dt>
        <dd class="tabular-nums">{{ metric.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { PublicMatchDetail, PublicMatchParticipant, PublicMatchTeam } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  teams: PublicMatchTeam[];
  originPlayerId?: string | null;
  timeline: PublicMatchDetail['timeline'];
}>();

const origin = computed((): PublicMatchParticipant | null => {
  if (!props.originPlayerId) {
    return null;
  }
  return (
    props.teams.flatMap((team) => team.participants).find((participant) => participant.playerId === props.originPlayerId) ??
    null
  );
});

const metrics = computed(() => {
  const participant = origin.value;
  if (!participant) {
    return [];
  }
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: number | null) => {
    if (value != null) {
      rows.push({ label, value: String(value) });
    }
  };
  add('Gold @10', participant.goldAt10);
  add('Gold @15', participant.goldAt15);
  add('CS @10', participant.csAt10);
  add('CS @15', participant.csAt15);
  add('XP @10', participant.xpAt10);
  add('XP @15', participant.xpAt15);
  add('Gold diff @10', participant.goldDifferenceAt10);
  add('Gold diff @15', participant.goldDifferenceAt15);
  add('CS diff @10', participant.csDifferenceAt10);
  add('CS diff @15', participant.csDifferenceAt15);
  add('XP diff @10', participant.xpDifferenceAt10);
  add('XP diff @15', participant.xpDifferenceAt15);
  return rows;
});

const processing = computed(
  () => props.timeline.status === 'PENDING' && !props.timeline.metricsAvailable,
);

const visible = computed(() => {
  if (!origin.value) {
    return false;
  }
  return processing.value || metrics.value.length > 0;
});
</script>
