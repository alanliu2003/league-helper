<template>
  <p class="text-sm tabular-nums text-[var(--lh-text)]">{{ line }}</p>
</template>

<script setup lang="ts">
import type {
  PublicMatchObjectiveEvent,
  PublicMatchTimelineParticipant,
} from '@league-helper/shared';
import { computed } from 'vue';
import { formatObjectiveLine } from '~/utils/match-timeline-format';

const props = defineProps<{
  objective: PublicMatchObjectiveEvent;
  participants: PublicMatchTimelineParticipant[];
}>();

const line = computed(() => formatObjectiveLine(props.objective, props.participants));
</script>
