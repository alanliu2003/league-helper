<template>
  <article
    class="relative overflow-hidden rounded-xl"
    style="min-height: 14rem; box-shadow: var(--lh-shadow-sm)"
    :aria-label="`${displayName} mastery`"
  >
    <div class="absolute inset-0">
      <img
        v-if="entry.championSplashUrl && !splashFailed"
        :src="entry.championSplashUrl"
        alt=""
        width="1215"
        height="717"
        class="h-full w-full object-cover object-top"
        :loading="lazy ? 'lazy' : 'eager'"
        @error="splashFailed = true"
      />
      <div
        v-else
        class="h-full w-full"
        style="background: linear-gradient(135deg, var(--lh-surface-inset), var(--lh-surface))"
        aria-hidden="true"
      />
      <div
        class="absolute inset-0"
        style="
          background: linear-gradient(
            to top,
            rgba(10, 14, 20, 0.95) 0%,
            rgba(10, 14, 20, 0.35) 100%
          );
        "
        aria-hidden="true"
      />
    </div>

    <div class="relative z-10 flex h-full flex-col justify-end p-4">
      <div class="mb-2 flex items-center gap-2">
        <img
          v-if="entry.championIconUrl && !iconFailed"
          :src="entry.championIconUrl"
          :alt="`${displayName} icon`"
          width="40"
          height="40"
          class="h-10 w-10 shrink-0 rounded-md object-cover"
          style="border: 1px solid var(--lh-border)"
          :loading="lazy ? 'lazy' : 'eager'"
          @error="iconFailed = true"
        />
        <div
          v-else
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-[var(--lh-muted)]"
          style="background: var(--lh-surface-raised)"
          aria-hidden="true"
        >
          {{ initials }}
        </div>
        <div class="min-w-0">
          <p class="truncate font-display text-lg font-semibold">{{ displayName }}</p>
          <p class="text-xs text-[var(--lh-accent-gold)]">#{{ rank }} mastery</p>
        </div>
      </div>
      <p class="text-sm text-[var(--lh-text-secondary)]">
        Level {{ entry.championLevel }} · {{ entry.championPoints.toLocaleString() }} pts
      </p>
      <p v-if="entry.lastPlayTime" class="mt-1 text-xs text-[var(--lh-muted)]">
        Last played {{ formatDate(entry.lastPlayTime) }}
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { PublicMasterySummary } from '@league-helper/shared';
import { computed, ref, watch } from 'vue';
import { championDisplayName, championInitials } from '~/utils/champion-display';

const props = defineProps<{
  entry: PublicMasterySummary;
  rank: number;
  lazy?: boolean;
}>();

const splashFailed = ref(false);
const iconFailed = ref(false);

watch(
  () => props.entry.championSplashUrl,
  () => {
    splashFailed.value = false;
  },
);

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
</script>
