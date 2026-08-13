<template>
  <div ref="rootEl" class="champion-ability-bar" data-testid="champion-ability-bar">
    <div
      role="toolbar"
      aria-label="Champion abilities"
      class="flex flex-wrap items-end gap-2 sm:gap-3"
    >
      <ChampionAbilityButton
        v-for="ability in abilities"
        :key="ability.slot"
        :ability="ability"
        :selected="openSlot === ability.slot"
        :controls-id="openSlot === ability.slot ? panelId : undefined"
        @mouseenter="onHover(ability.slot)"
        @mouseleave="onLeaveTrigger"
        @click="onClick(ability.slot)"
      />
    </div>

    <div
      v-if="openAbility"
      class="mt-3 max-w-xl"
      @mouseenter="onEnterPanel"
      @mouseleave="onLeaveTrigger"
    >
      <ChampionAbilityPopover
        :ability="openAbility"
        :panel-id="panelId"
        @close="closeFromPanel"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type ChampionAbilitySlot, type ChampionAbilitySummary } from '@league-helper/shared';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import ChampionAbilityButton from './ChampionAbilityButton.vue';
import ChampionAbilityPopover from './ChampionAbilityPopover.vue';

const props = defineProps<{
  abilities: ChampionAbilitySummary[];
}>();

const openSlot = ref<ChampionAbilitySlot | null>(null);
const pinned = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const panelId = 'champion-ability-detail';
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const openAbility = computed(
  () => props.abilities.find((ability) => ability.slot === openSlot.value) ?? null,
);

function clearCloseTimer(): void {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function close(options: { restoreFocus?: boolean } = {}): void {
  const slot = openSlot.value;
  clearCloseTimer();
  openSlot.value = null;
  pinned.value = false;
  if (options.restoreFocus && slot) {
    void nextTick(() => {
      const button = rootEl.value?.querySelector(
        `[data-testid="champion-ability-button-${slot}"]`,
      );
      if (button instanceof HTMLButtonElement) {
        button.focus();
      }
    });
  }
}

function closeFromPanel(): void {
  close({ restoreFocus: true });
}

function open(slot: ChampionAbilitySlot, nextPinned: boolean): void {
  clearCloseTimer();
  openSlot.value = slot;
  pinned.value = nextPinned;
}

function onHover(slot: ChampionAbilitySlot): void {
  if (!canHover() || pinned.value) {
    return;
  }
  open(slot, false);
}

function onClick(slot: ChampionAbilitySlot): void {
  if (openSlot.value === slot && pinned.value) {
    close({ restoreFocus: true });
    return;
  }
  open(slot, true);
}

function onEnterPanel(): void {
  clearCloseTimer();
}

function onLeaveTrigger(): void {
  if (pinned.value) {
    return;
  }
  clearCloseTimer();
  closeTimer = setTimeout(() => {
    if (!pinned.value) {
      openSlot.value = null;
    }
  }, 160);
}

function canHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (rootEl.value && !rootEl.value.contains(target)) {
    close();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && openSlot.value) {
    event.preventDefault();
    close({ restoreFocus: true });
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  clearCloseTimer();
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>
