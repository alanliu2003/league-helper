<template>
  <p class="text-sm tabular-nums text-[var(--lh-text)]">{{ line }}</p>
</template>

<script setup lang="ts">
import type { PublicMatchKillEvent, PublicMatchTimelineParticipant } from '@league-helper/shared';
import { computed } from 'vue';
import { formatKillFeedLine } from '~/utils/match-timeline-format';

const props = defineProps<{
  kill: PublicMatchKillEvent;
  participants: PublicMatchTimelineParticipant[];
}>();

const line = computed(() => formatKillFeedLine(props.kill, props.participants));
</script>
