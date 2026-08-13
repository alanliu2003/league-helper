<template>
  <button
    type="button"
    class="champion-ability-button group relative flex flex-col items-center gap-1 rounded-md p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
    :class="selected ? 'is-selected' : ''"
    :aria-label="ariaLabel"
    :aria-expanded="selected"
    :aria-controls="selected ? controlsId : undefined"
    :data-testid="`champion-ability-button-${ability.slot}`"
  >
    <span
      class="ability-icon-frame relative h-10 w-10 overflow-hidden rounded-md border sm:h-11 sm:w-11 md:h-12 md:w-12"
      :style="frameStyle"
    >
      <img
        v-if="ability.iconUrl && !iconFailed"
        :src="ability.iconUrl"
        alt=""
        width="48"
        height="48"
        class="h-full w-full object-cover"
        @error="iconFailed = true"
      />
      <span
        v-else
        class="flex h-full w-full items-center justify-center text-xs font-semibold text-[var(--lh-muted)]"
        data-testid="ability-icon-fallback"
        aria-hidden="true"
      >
        {{ slotLabel }}
      </span>
    </span>
    <span
      class="font-display text-[0.65rem] font-semibold tracking-[0.14em] text-[var(--lh-accent-gold)] sm:text-xs"
      aria-hidden="true"
    >
      {{ slotLabel }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { type ChampionAbilitySummary } from '@league-helper/shared';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  ability: ChampionAbilitySummary;
  selected: boolean;
  controlsId?: string;
}>();

const iconFailed = ref(false);

watch(
  () => props.ability.iconUrl,
  () => {
    iconFailed.value = false;
  },
);

const slotLabel = computed(() => (props.ability.slot === 'PASSIVE' ? 'P' : props.ability.slot));

const ariaLabel = computed(() => {
  const key = props.ability.slot === 'PASSIVE' ? 'Passive' : props.ability.slot;
  return `${key}: ${props.ability.name}`;
});

const frameStyle = computed(() => ({
  borderColor: props.selected ? 'var(--lh-accent-gold)' : 'var(--lh-border-strong)',
  boxShadow: props.selected
    ? '0 0 0 1px var(--lh-accent-gold), 0 0 12px rgba(200, 170, 110, 0.28)'
    : 'none',
  background: 'var(--lh-surface-inset)',
}));
</script>

<style scoped>
.champion-ability-button .ability-icon-frame {
  transition:
    transform var(--lh-transition-fast) ease,
    box-shadow var(--lh-transition-fast) ease,
    border-color var(--lh-transition-fast) ease;
}

@media (hover: hover) and (pointer: fine) {
  .champion-ability-button:hover .ability-icon-frame {
    transform: translateY(-1px);
    border-color: var(--lh-accent-gold);
    box-shadow: 0 0 10px rgba(200, 170, 110, 0.22);
  }
}

@media (prefers-reduced-motion: reduce) {
  .champion-ability-button .ability-icon-frame {
    transition: none;
  }
}
</style>
