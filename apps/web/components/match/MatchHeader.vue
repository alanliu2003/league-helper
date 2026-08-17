<template>
  <header class="lh-surface-raised space-y-3 p-4 md:p-5">
    <h1 class="font-display text-2xl md:text-3xl" :style="{ color: headingColor }">
      {{ heading }}
    </h1>
    <p class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--lh-text-secondary)]">
      <span>{{ match.queueLabel }}</span>
      <span>Patch {{ patchLabel }}</span>
      <span>{{ durationLabel }}</span>
      <time :datetime="match.gameCreation">{{ dateLabel }}</time>
      <span v-if="platformLabel">{{ platformLabel }}</span>
      <span v-if="match.gameMode">{{ match.gameMode }}</span>
    </p>
  </header>
</template>

<script setup lang="ts">
import { getPlatformDisplayName, type PublicMatchDetail } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  match: PublicMatchDetail['match'];
}>();

const heading = computed(() => {
  if (props.match.remake) {
    return 'Remake';
  }
  switch (props.match.winningSide) {
    case 'BLUE':
      return 'Blue Team Victory';
    case 'RED':
      return 'Red Team Victory';
    default:
      return 'Unknown result';
  }
});

const headingColor = computed(() => {
  if (props.match.remake) {
    return 'var(--lh-remake)';
  }
  if (props.match.winningSide === 'BLUE') {
    return 'var(--lh-team-blue)';
  }
  if (props.match.winningSide === 'RED') {
    return 'var(--lh-team-red)';
  }
  return 'var(--lh-text)';
});

const patchLabel = computed(
  () =>
    props.match.normalizedPatch?.trim() ||
    props.match.gameVersion.split('.').slice(0, 2).join('.'),
);

const durationLabel = computed(() => {
  const minutes = Math.floor(props.match.gameDurationSeconds / 60);
  const seconds = props.match.gameDurationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

const dateLabel = computed(() => new Date(props.match.gameCreation).toLocaleString());

const platformLabel = computed(() =>
  props.match.platform ? getPlatformDisplayName(props.match.platform) : null,
);
</script>
