<template>
  <ul v-if="visible.length > 0" class="flex flex-wrap gap-2 text-sm" aria-label="Team objectives">
    <li v-for="objective in visible" :key="objective.type">
      <span>{{ labelFor(objective.type) }} {{ objective.kills }}</span>
      <span v-if="objective.first === true" class="sr-only"> first</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { PublicMatchObjective } from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  objectives: PublicMatchObjective[];
}>();

const OBJECTIVE_LABELS: Record<Exclude<PublicMatchObjective['type'], 'champion'>, string> = {
  dragon: 'Dragon',
  baron: 'Baron',
  riftHerald: 'Rift Herald',
  tower: 'Towers',
  inhibitor: 'Inhibitors',
};

const visible = computed(() => props.objectives.filter((objective) => objective.type !== 'champion'));

function labelFor(type: PublicMatchObjective['type']): string {
  if (type === 'champion') {
    return 'Kills';
  }
  return OBJECTIVE_LABELS[type];
}
</script>
