<template>
  <section
    v-if="showPanel"
    class="space-y-3 rounded-lg border p-4 md:p-5"
    style="border-color: var(--lh-border); background: var(--lh-surface)"
    data-testid="player-playstyle-ai"
    :aria-labelledby="availableInsight ? headingId : undefined"
  >
    <p v-if="statusMessage" class="text-sm text-[var(--lh-muted)]" role="status" aria-live="polite">
      {{ statusMessage }}
    </p>

    <template v-else-if="availableInsight">
      <h3 :id="headingId" class="font-display text-lg">Playstyle summary</h3>
      <p class="text-sm text-[var(--lh-text-secondary)]">{{ availableInsight.summary }}</p>

      <template v-if="availableInsight.economy">
        <h4 class="font-display text-base">Economy</h4>
        <p class="text-sm text-[var(--lh-text-secondary)]">{{ availableInsight.economy }}</p>
      </template>

      <template v-if="availableInsight.combat">
        <h4 class="font-display text-base">Combat</h4>
        <p class="text-sm text-[var(--lh-text-secondary)]">{{ availableInsight.combat }}</p>
      </template>

      <template v-if="availableInsight.strengths.length > 0">
        <h4 class="font-display text-base">Strengths</h4>
        <ul class="space-y-1.5">
          <li
            v-for="line in availableInsight.strengths"
            :key="line"
            class="text-sm text-[var(--lh-text-secondary)]"
          >
            {{ line }}
          </li>
        </ul>
      </template>

      <template v-if="availableInsight.tradeoffs.length > 0">
        <h4 class="font-display text-base">Tradeoffs</h4>
        <ul class="space-y-1.5">
          <li
            v-for="line in availableInsight.tradeoffs"
            :key="line"
            class="text-sm text-[var(--lh-text-secondary)]"
          >
            {{ line }}
          </li>
        </ul>
      </template>

      <template v-if="availableInsight.championTendencies.length > 0">
        <h4 class="font-display text-base">Champion tendencies</h4>
        <ul class="space-y-2">
          <li
            v-for="tendency in availableInsight.championTendencies"
            :key="`${tendency.championKey}-${tendency.position}`"
            class="text-sm text-[var(--lh-text-secondary)]"
          >
            <span class="font-medium text-[var(--lh-text)]">
              {{ tendency.championKey }}
              ({{ positionDisplayLabel(tendency.position) }})
            </span>
            {{ tendency.text }}
          </li>
        </ul>
      </template>

      <p class="text-xs text-[var(--lh-muted)]">{{ disclaimer }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  type PlayerPlaystyleResponse,
} from '@league-helper/shared';
import { computed } from 'vue';
import { positionDisplayLabel } from '~/utils/champion-metrics';

const props = withDefaults(
  defineProps<{
    ai: PlayerPlaystyleResponse['ai'] | null;
    aiDisclaimer?: string;
    pending?: boolean;
    error?: string | null;
  }>(),
  {
    pending: false,
    error: null,
    aiDisclaimer: PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  },
);

const headingId = 'player-playstyle-ai-heading';

const disclaimer = computed(() => props.aiDisclaimer ?? PLAYER_PLAYSTYLE_AI_DISCLAIMER);

const availableInsight = computed(() => {
  if (props.pending || props.ai?.status !== 'AVAILABLE' || !props.ai.insight) {
    return null;
  }
  return props.ai.insight;
});

const statusMessage = computed(() => {
  if (availableInsight.value) {
    return null;
  }
  if (props.pending || props.ai?.status === 'PENDING') {
    return 'Generating AI playstyle analysis…';
  }
  if (props.ai?.status === 'LOW_CONFIDENCE') {
    return 'Not enough collected-sample evidence for an AI playstyle analysis.';
  }
  if (props.error || props.ai?.status === 'UNAVAILABLE' || props.ai?.status === 'AVAILABLE') {
    return 'AI playstyle analysis unavailable.';
  }
  return null;
});

const showPanel = computed(() => {
  if (props.pending || props.error) {
    return true;
  }
  const status = props.ai?.status;
  if (!status || status === 'DISABLED') {
    return false;
  }
  return true;
});
</script>
