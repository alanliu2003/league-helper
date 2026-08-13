<template>
  <div
    role="tablist"
    aria-label="Champion sections"
    class="flex flex-wrap gap-2 border-b pb-px"
    style="border-color: var(--lh-border)"
  >
    <button
      v-for="tab in tabs"
      :id="`champion-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      role="tab"
      class="rounded-t-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
      :class="
        modelValue === tab.id
          ? 'font-medium text-[var(--lh-text)]'
          : 'text-[var(--lh-text-secondary)] hover:text-[var(--lh-text)]'
      "
      :style="
        modelValue === tab.id
          ? { borderBottom: '2px solid var(--lh-accent-gold)', marginBottom: '-1px' }
          : { borderBottom: '2px solid transparent', marginBottom: '-1px' }
      "
      :aria-selected="modelValue === tab.id"
      :aria-controls="`champion-tabpanel-${tab.id}`"
      :tabindex="modelValue === tab.id ? 0 : -1"
      @click="$emit('update:modelValue', tab.id)"
      @keydown="onTabKeydown($event, tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
export type ChampionDetailTabId = 'overview' | 'builds' | 'matchups';

defineProps<{
  modelValue: ChampionDetailTabId;
}>();

const emit = defineEmits<{
  'update:modelValue': [ChampionDetailTabId];
}>();

const tabs: Array<{ id: ChampionDetailTabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'builds', label: 'Builds & Runes' },
  { id: 'matchups', label: 'Matchups' },
];

function onTabKeydown(event: KeyboardEvent, current: ChampionDetailTabId): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return;
  }
  event.preventDefault();
  const index = tabs.findIndex((tab) => tab.id === current);
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(index + delta + tabs.length) % tabs.length];
  if (next) {
    emit('update:modelValue', next.id);
  }
}
</script>
