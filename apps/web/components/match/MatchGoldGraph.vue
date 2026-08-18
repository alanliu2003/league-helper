<template>
  <section
    v-if="timeline.coverage.frames"
    data-testid="match-gold-graph"
    class="lh-surface-raised space-y-3 p-4 md:p-5"
    aria-labelledby="match-gold-heading"
  >
    <h2 id="match-gold-heading" class="font-display text-xl">Team gold</h2>
    <svg
      v-if="hasSeries"
      class="h-auto w-full"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      role="img"
      aria-label="Team gold over time"
    >
      <line
        :x1="PAD"
        :y1="zeroY"
        :x2="WIDTH - PAD"
        :y2="zeroY"
        stroke="var(--lh-border-strong)"
        stroke-width="1"
      />
      <polyline
        v-if="bluePoints"
        fill="none"
        stroke="var(--lh-team-blue)"
        stroke-width="2"
        :points="bluePoints"
      />
      <polyline
        v-if="redPoints"
        fill="none"
        stroke="var(--lh-team-red)"
        stroke-width="2"
        :points="redPoints"
      />
      <polyline
        v-if="diffPoints"
        fill="none"
        stroke="var(--lh-muted)"
        stroke-width="1.5"
        stroke-dasharray="4 3"
        :points="diffPoints"
      />
    </svg>
    <p v-else class="text-sm text-[var(--lh-muted)]" role="status">No gold frames to graph.</p>
    <ul class="flex flex-wrap gap-4 text-sm" aria-label="Gold graph series">
      <li class="flex items-center gap-2">
        <span
          class="inline-block h-0.5 w-4"
          style="background: var(--lh-team-blue)"
          aria-hidden="true"
        />
        <span>Blue</span>
      </li>
      <li class="flex items-center gap-2">
        <span
          class="inline-block h-0.5 w-4"
          style="background: var(--lh-team-red)"
          aria-hidden="true"
        />
        <span>Red</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { PublicMatchTimelineDetail } from '@league-helper/shared';
import { computed } from 'vue';

const WIDTH = 640;
const HEIGHT = 240;
const PAD = 36;

const props = defineProps<{
  timeline: PublicMatchTimelineDetail;
}>();

const gold = computed(() => props.timeline.derived.gold);

const hasSeries = computed(() => gold.value.timestampsMs.length > 0 && gold.value.teams.length > 0);

const yDomain = computed(() => {
  const values = [
    ...gold.value.teams.flatMap((team) => team.gold),
    ...(gold.value.difference ?? []),
    0,
  ];
  return {
    min: Math.min(...values),
    max: Math.max(...values, 1),
  };
});

function seriesPoints(values: number[]): string {
  const timestamps = gold.value.timestampsMs;
  const xMax = timestamps[timestamps.length - 1] ?? 1;
  const { min, max } = yDomain.value;
  const span = max - min || 1;
  const innerW = WIDTH - PAD * 2;
  const innerH = HEIGHT - PAD * 2;
  return timestamps
    .map((timestamp, index) => {
      const value = values[index] ?? min;
      const x = PAD + (timestamp / (xMax || 1)) * innerW;
      const y = PAD + (1 - (value - min) / span) * innerH;
      return `${x},${y}`;
    })
    .join(' ');
}

const bluePoints = computed(() => {
  const team = gold.value.teams.find((row) => row.side === 'BLUE');
  return team ? seriesPoints(team.gold) : '';
});

const redPoints = computed(() => {
  const team = gold.value.teams.find((row) => row.side === 'RED');
  return team ? seriesPoints(team.gold) : '';
});

const diffPoints = computed(() => {
  if (!gold.value.difference) {
    return '';
  }
  return seriesPoints(gold.value.difference);
});

const zeroY = computed(() => {
  const { min, max } = yDomain.value;
  const span = max - min || 1;
  const innerH = HEIGHT - PAD * 2;
  return PAD + (1 - (0 - min) / span) * innerH;
});
</script>
