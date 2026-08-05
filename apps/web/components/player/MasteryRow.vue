<template>
  <li
    class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
    style="border-color: var(--lh-border); background: var(--lh-surface)"
  >
    <span
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style="background: var(--lh-surface-raised); color: var(--lh-accent)"
      aria-hidden="true"
    >
      {{ rank }}
    </span>
    <img
      v-if="entry.championIconUrl && !iconFailed"
      :src="entry.championIconUrl"
      :alt="`${displayName} icon`"
      width="32"
      height="32"
      class="h-8 w-8 shrink-0 rounded-md object-cover"
      loading="lazy"
      @error="iconFailed = true"
    />
    <div
      v-else
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-[var(--lh-muted)]"
      style="background: var(--lh-surface-raised)"
      aria-hidden="true"
    >
      {{ initials }}
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{{ displayName }}</p>
      <p class="text-xs text-[var(--lh-muted)]">
        Lv {{ entry.championLevel }} · {{ entry.championPoints.toLocaleString() }} pts
      </p>
    </div>
    <p v-if="entry.chestGranted === false" class="shrink-0 text-xs text-[var(--lh-accent-gold)]">
      Chest
    </p>
  </li>
</template>

<script setup lang="ts">
import type { PublicMasterySummary } from '@league-helper/shared';
import { computed, ref, watch } from 'vue';
import { championDisplayName, championInitials } from '~/utils/champion-display';

const props = defineProps<{
  entry: PublicMasterySummary;
  rank: number;
}>();

const iconFailed = ref(false);

watch(
  () => props.entry.championIconUrl,
  () => {
    iconFailed.value = false;
  },
);

const displayName = computed(() =>
  championDisplayName(props.entry.championName, props.entry.championId),
);

const initials = computed(() => championInitials(props.entry.championName, props.entry.championId));
</script>
