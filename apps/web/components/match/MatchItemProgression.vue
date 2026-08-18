<template>
  <section
    v-if="timeline.coverage.items"
    data-testid="match-item-progression"
    class="lh-surface-raised space-y-4 p-4 md:p-5"
    aria-labelledby="match-item-progression-heading"
  >
    <h2 id="match-item-progression-heading" class="font-display text-xl">Build Progression</h2>
    <p v-if="groups.length === 0" class="text-sm text-[var(--lh-muted)]" role="status">
      No item timeline events were stored for this match.
    </p>
    <div v-for="group in groups" :key="group.participant.participantId" class="space-y-2">
      <h3 class="text-sm font-medium text-[var(--lh-text)]">
        {{ group.participant.championName ?? 'Unknown champion' }}
      </h3>
      <ol class="space-y-2">
        <li
          v-for="event in group.events"
          :key="`${event.eventIndex}-${event.timestampMs}`"
          class="flex items-center gap-2 text-sm tabular-nums"
        >
          <span class="text-[var(--lh-muted)]">{{ formatMatchClock(event.timestampMs) }}</span>
          <img
            v-if="event.item?.iconUrl"
            :src="event.item.iconUrl"
            :alt="event.item.name"
            width="24"
            height="24"
            class="h-6 w-6 rounded-sm object-cover"
            style="background: var(--lh-surface-inset)"
          />
          <span>{{ itemEventVerb(event.type) }}</span>
          <span>{{ event.item?.name ?? 'item' }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PublicMatchTimelineDetail } from '@league-helper/shared';
import { computed } from 'vue';
import {
  formatMatchClock,
  isItemTimelineEvent,
  itemEventVerb,
  orderTimelineParticipants,
} from '~/utils/match-timeline-format';

const props = defineProps<{
  timeline: PublicMatchTimelineDetail;
  originPlayerId?: string | null;
}>();

const groups = computed(() => {
  const itemEvents = props.timeline.events.filter((event) => isItemTimelineEvent(event.type));
  return orderTimelineParticipants(props.timeline.participants, props.originPlayerId)
    .map((participant) => ({
      participant,
      events: itemEvents.filter((event) => event.participantId === participant.participantId),
    }))
    .filter((group) => group.events.length > 0);
});
</script>
