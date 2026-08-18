<template>
  <p
    v-if="pending || timeline?.status === 'PENDING'"
    class="text-sm text-[var(--lh-muted)]"
    role="status"
    aria-live="polite"
  >
    Timeline is still processing.
  </p>
  <p
    v-else-if="errorMessage || !timeline || timeline.status === 'UNAVAILABLE'"
    class="text-sm text-[var(--lh-muted)]"
    role="status"
  >
    Timeline is not available for this match.
  </p>
  <div v-else class="flex flex-col gap-6">
    <MatchGoldGraph :timeline="timeline" />
    <MatchEventStream :timeline="timeline" />
    <MatchItemProgression :timeline="timeline" :origin-player-id="originPlayerId" />
    <MatchSkillProgression :timeline="timeline" :origin-player-id="originPlayerId" />
  </div>
</template>

<script setup lang="ts">
import type { PublicMatchTimelineDetail } from '@league-helper/shared';
import MatchEventStream from './MatchEventStream.vue';
import MatchGoldGraph from './MatchGoldGraph.vue';
import MatchItemProgression from './MatchItemProgression.vue';
import MatchSkillProgression from './MatchSkillProgression.vue';

defineProps<{
  timeline: PublicMatchTimelineDetail | null;
  pending: boolean;
  errorMessage: string | null;
  originPlayerId?: string | null;
}>();
</script>
