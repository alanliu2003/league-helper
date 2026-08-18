<template>
  <section
    data-testid="match-event-stream"
    class="lh-surface-raised space-y-4 p-4 md:p-5"
    aria-labelledby="match-event-stream-heading"
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 id="match-event-stream-heading" class="font-display text-xl">Event stream</h2>
      <div role="radiogroup" aria-label="Event filters" class="flex flex-wrap gap-2">
        <button
          v-for="chip in chips"
          :key="chip.id"
          type="button"
          role="radio"
          class="rounded-md border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
          :class="
            filter === chip.id
              ? 'bg-[var(--lh-accent-gold)]/10 font-medium text-[var(--lh-text)]'
              : 'text-[var(--lh-text-secondary)] hover:border-[var(--lh-border-strong)]'
          "
          :style="{
            borderColor: filter === chip.id ? 'var(--lh-accent-gold)' : 'var(--lh-border)',
          }"
          :aria-checked="filter === chip.id"
          :data-filter="chip.id"
          @click="filter = chip.id"
        >
          {{ chip.label }}
        </button>
      </div>
    </div>

    <p v-if="emptyCopy" class="text-sm text-[var(--lh-muted)]" role="status">{{ emptyCopy }}</p>
    <ol v-else class="space-y-2">
      <li v-for="row in visibleRows" :key="row.key">
        <MatchKillFeed
          v-if="row.kind === 'kill'"
          :kill="row.kill"
          :participants="timeline.participants"
        />
        <MatchObjectiveTimeline
          v-else-if="row.kind === 'objective'"
          :objective="row.objective"
          :participants="timeline.participants"
        />
        <p v-else class="text-sm tabular-nums text-[var(--lh-text)]">{{ row.text }}</p>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import {
  mapPublicObjectiveType,
  type PublicMatchKillEvent,
  type PublicMatchObjectiveEvent,
  type PublicMatchTimelineDetail,
  type PublicMatchTimelineEvent,
} from '@league-helper/shared';
import { computed, ref } from 'vue';
import {
  findTimelineParticipant,
  formatMatchClock,
  formatParticipantActor,
  isItemTimelineEvent,
  itemEventVerb,
} from '~/utils/match-timeline-format';
import MatchKillFeed from './MatchKillFeed.vue';
import MatchObjectiveTimeline from './MatchObjectiveTimeline.vue';

type EventFilter = 'all' | 'kills' | 'objectives' | 'items' | 'skills';

type StreamRow =
  | { key: string; kind: 'kill'; kill: PublicMatchKillEvent }
  | { key: string; kind: 'objective'; objective: PublicMatchObjectiveEvent }
  | { key: string; kind: 'text'; text: string };

const props = defineProps<{
  timeline: PublicMatchTimelineDetail;
}>();

const filter = ref<EventFilter>('all');

const chips: Array<{ id: EventFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'kills', label: 'Kills' },
  { id: 'objectives', label: 'Objectives' },
  { id: 'items', label: 'Items' },
  { id: 'skills', label: 'Skills' },
];

function killFromEvent(event: PublicMatchTimelineEvent): PublicMatchKillEvent | null {
  if (event.type !== 'CHAMPION_KILL' || event.victimParticipantId == null) {
    return null;
  }
  return {
    timestampMs: event.timestampMs,
    killerKind: event.killerParticipantId ? 'CHAMPION' : 'ENVIRONMENT',
    killerParticipantId: event.killerParticipantId,
    victimParticipantId: event.victimParticipantId,
    assistingParticipantIds: event.assistingParticipantIds,
    position: event.position,
  };
}

function objectiveFromEvent(event: PublicMatchTimelineEvent): PublicMatchObjectiveEvent | null {
  const type = mapPublicObjectiveType(event);
  if (!type) {
    return null;
  }
  return (
    props.timeline.derived.objectives.find(
      (row) => row.timestampMs === event.timestampMs && row.type === type,
    ) ?? {
      timestampMs: event.timestampMs,
      type,
      killerKind: event.killerParticipantId ? 'CHAMPION' : 'ENVIRONMENT',
      killerParticipantId: event.killerParticipantId,
      assistingParticipantIds: event.assistingParticipantIds,
      ownerTeamId: event.teamId,
      killerTeamId: null,
      monsterSubType: event.monsterSubType,
      towerType: event.towerType,
      laneType: event.laneType,
      position: event.position,
    }
  );
}

function actorLabel(participantId: number | null): string {
  const participant = findTimelineParticipant(props.timeline.participants, participantId);
  return participant ? formatParticipantActor(participant) : 'Unknown';
}

function itemRowText(event: PublicMatchTimelineEvent): string {
  const clock = formatMatchClock(event.timestampMs);
  const actor = actorLabel(event.participantId);
  const verb = itemEventVerb(event.type);
  const itemName = event.item?.name?.trim();
  return itemName ? `${clock} ${actor} ${verb} ${itemName}` : `${clock} ${actor} ${verb}`;
}

function skillRowText(event: PublicMatchTimelineEvent): string {
  const clock = formatMatchClock(event.timestampMs);
  const actor = actorLabel(event.participantId);
  const parts = [event.skillLabel, event.levelUpType === 'EVOLVE' ? 'EVOLVE' : null].filter(
    Boolean,
  );
  const detail = parts.length > 0 ? parts.join(' · ') : 'skill';
  return `${clock} ${actor} ${detail}`;
}

function genericEventText(event: PublicMatchTimelineEvent): string {
  const clock = formatMatchClock(event.timestampMs);
  if (event.type === 'ELITE_MONSTER_KILL') {
    return `${clock} Elite monster kill`;
  }
  if (event.type === 'BUILDING_KILL') {
    return `${clock} Building kill`;
  }
  return `${clock} ${event.type}`;
}

function rowFromEvent(event: PublicMatchTimelineEvent): StreamRow {
  const key = `${event.eventIndex}-${event.timestampMs}-${event.type}`;
  if (event.type === 'CHAMPION_KILL') {
    const kill = killFromEvent(event);
    if (kill) {
      return { key, kind: 'kill', kill };
    }
  }
  if (event.type === 'ELITE_MONSTER_KILL' || event.type === 'BUILDING_KILL') {
    const objective = objectiveFromEvent(event);
    if (objective) {
      return { key, kind: 'objective', objective };
    }
    return { key, kind: 'text', text: genericEventText(event) };
  }
  if (isItemTimelineEvent(event.type)) {
    return { key, kind: 'text', text: itemRowText(event) };
  }
  if (event.type === 'SKILL_LEVEL_UP') {
    return { key, kind: 'text', text: skillRowText(event) };
  }
  return { key, kind: 'text', text: genericEventText(event) };
}

const visibleRows = computed((): StreamRow[] => {
  switch (filter.value) {
    case 'kills':
      return props.timeline.derived.kills.map((kill, index) => ({
        key: `kill-${kill.timestampMs}-${kill.victimParticipantId}-${index}`,
        kind: 'kill' as const,
        kill,
      }));
    case 'objectives':
      return props.timeline.derived.objectives.map((objective, index) => ({
        key: `objective-${objective.timestampMs}-${objective.type}-${index}`,
        kind: 'objective' as const,
        objective,
      }));
    case 'items':
      return props.timeline.events
        .filter((event) => isItemTimelineEvent(event.type))
        .map(rowFromEvent);
    case 'skills':
      return props.timeline.events
        .filter((event) => event.type === 'SKILL_LEVEL_UP')
        .map(rowFromEvent);
    default:
      return props.timeline.events.map(rowFromEvent);
  }
});

const emptyCopy = computed(() => {
  if (filter.value === 'kills' && !props.timeline.coverage.kills) {
    return 'Kill timeline was not stored for this match.';
  }
  if (filter.value === 'objectives' && !props.timeline.coverage.objectives) {
    return 'Objective timeline was not stored for this match.';
  }
  if (filter.value === 'items' && !props.timeline.coverage.items) {
    return 'Item timeline was not stored for this match.';
  }
  if (filter.value === 'skills' && !props.timeline.coverage.skills) {
    return 'Skill timeline was not stored for this match.';
  }
  if (visibleRows.value.length === 0) {
    return 'No timeline events were stored for this match.';
  }
  return null;
});
</script>
