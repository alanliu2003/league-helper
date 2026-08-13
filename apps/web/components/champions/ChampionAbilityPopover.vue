<template>
  <div
    :id="panelId"
    class="champion-ability-popover rounded-lg border p-3 sm:p-4"
    role="region"
    :aria-labelledby="headingId"
    data-testid="champion-ability-popover"
    :style="panelStyle"
  >
    <div class="flex items-start gap-3">
      <img
        v-if="ability.iconUrl && !iconFailed"
        :src="ability.iconUrl"
        alt=""
        width="40"
        height="40"
        class="h-10 w-10 shrink-0 rounded-md border object-cover"
        style="border-color: var(--lh-accent-gold)"
        @error="iconFailed = true"
      />
      <div
        v-else
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-xs font-semibold text-[var(--lh-muted)]"
        style="border-color: var(--lh-border); background: var(--lh-surface-inset)"
        aria-hidden="true"
      >
        {{ slotLabel }}
      </div>
      <div class="min-w-0 flex-1">
        <p
          class="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--lh-accent-gold)]"
        >
          {{ slotTitle }}
        </p>
        <h3
          :id="headingId"
          class="font-display text-base font-semibold text-[var(--lh-text)] sm:text-lg"
        >
          {{ ability.name }}
        </h3>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--lh-muted)] hover:text-[var(--lh-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
        data-testid="champion-ability-popover-close"
        aria-label="Close ability details"
        @click="$emit('close')"
      >
        Close
      </button>
    </div>

    <p
      v-if="ability.description"
      class="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--lh-text-secondary)]"
    >
      {{ ability.description }}
    </p>

    <dl v-if="metaRows.length" class="mt-3 grid gap-1 text-sm">
      <div v-for="row in metaRows" :key="row.label" class="flex gap-2">
        <dt class="w-20 shrink-0 text-[var(--lh-muted)]">{{ row.label }}</dt>
        <dd class="min-w-0 text-[var(--lh-text)]">{{ row.value }}</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { type ChampionAbilitySummary } from '@league-helper/shared';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  ability: ChampionAbilitySummary;
  panelId: string;
}>();

defineEmits<{
  close: [];
}>();

const iconFailed = ref(false);

watch(
  () => props.ability.iconUrl,
  () => {
    iconFailed.value = false;
  },
);

const slotLabel = computed(() => (props.ability.slot === 'PASSIVE' ? 'P' : props.ability.slot));
const slotTitle = computed(() =>
  props.ability.slot === 'PASSIVE' ? 'Passive' : props.ability.slot,
);
const headingId = computed(() => `${props.panelId}-heading`);

const metaRows = computed(() => {
  const rows: Array<{ label: string; value: string }> = [];
  if (props.ability.cooldown) {
    rows.push({ label: 'Cooldown', value: props.ability.cooldown });
  }
  if (props.ability.cost) {
    rows.push({ label: 'Cost', value: props.ability.cost });
  }
  if (props.ability.range) {
    rows.push({ label: 'Range', value: props.ability.range });
  }
  return rows;
});

const panelStyle = {
  borderColor: 'rgba(200, 170, 110, 0.28)',
  background: 'rgba(18, 26, 36, 0.94)',
  boxShadow: 'var(--lh-shadow-md)',
  backdropFilter: 'blur(10px)',
};
</script>
