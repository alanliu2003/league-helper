<template>
  <section
    v-if="timeline.coverage.skills"
    data-testid="match-skill-progression"
    class="lh-surface-raised space-y-4 p-4 md:p-5"
    aria-labelledby="match-skill-progression-heading"
  >
    <h2 id="match-skill-progression-heading" class="font-display text-xl">Skill Progression</h2>
    <p v-if="groups.length === 0" class="text-sm text-[var(--lh-muted)]" role="status">
      No skill timeline events were stored for this match.
    </p>
    <div v-for="group in groups" :key="group.participant.participantId" class="space-y-2">
      <h3 class="text-sm font-medium text-[var(--lh-text)]">
        {{ group.participant.championName ?? 'Unknown champion' }}
      </h3>
      <ol class="flex flex-wrap gap-2">
        <li
          v-for="event in group.events"
          :key="`${event.eventIndex}-${event.timestampMs}`"
          class="rounded-md border px-2 py-1 text-sm tabular-nums"
          style="border-color: var(--lh-border)"
        >
          <span class="text-[var(--lh-muted)]">{{ formatMatchClock(event.timestampMs) }}</span>
          <span v-if="event.skillLabel" class="ml-2 font-medium">{{ event.skillLabel }}</span>
          <span v-if="event.levelUpType === 'EVOLVE'" class="ml-2">EVOLVE</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PublicMatchTimelineDetail } from '@league-helper/shared';
import { computed } from 'vue';
import { formatMatchClock, orderTimelineParticipants } from '~/utils/match-timeline-format';

const props = defineProps<{
  timeline: PublicMatchTimelineDetail;
  originPlayerId?: string | null;
}>();

const groups = computed(() => {
  const skillEvents = props.timeline.events.filter((event) => event.type === 'SKILL_LEVEL_UP');
  return orderTimelineParticipants(props.timeline.participants, props.originPlayerId)
    .map((participant) => ({
      participant,
      events: skillEvents.filter((event) => event.participantId === participant.participantId),
    }))
    .filter((group) => group.events.length > 0);
});
</script>
