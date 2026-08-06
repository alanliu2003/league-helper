<template>
  <section
    class="relative overflow-hidden rounded-xl"
    style="min-height: 12rem; box-shadow: var(--lh-shadow-md)"
    aria-labelledby="champion-detail-heading"
  >
    <div class="absolute inset-0" aria-hidden="true">
      <img
        v-if="champion.splashUrl && !splashFailed"
        :src="champion.splashUrl"
        alt=""
        width="1215"
        height="717"
        class="h-full w-full object-cover object-top"
        loading="eager"
        fetchpriority="high"
        @error="splashFailed = true"
      />
      <div
        v-else
        class="h-full w-full"
        style="
          background: linear-gradient(135deg, var(--lh-surface-inset), var(--lh-surface-raised));
        "
      />
      <div
        class="absolute inset-0"
        style="
          background: linear-gradient(
            to top,
            rgba(10, 14, 20, 0.95) 0%,
            rgba(10, 14, 20, 0.55) 55%,
            rgba(10, 14, 20, 0.35) 100%
          );
        "
      />
    </div>

    <div class="relative z-10 flex flex-wrap items-end justify-between gap-4 p-5 md:p-8">
      <div class="flex items-end gap-4">
        <img
          v-if="champion.iconUrl && !iconFailed"
          :src="champion.iconUrl"
          :alt="`${champion.name} icon`"
          width="72"
          height="72"
          class="h-14 w-14 shrink-0 rounded-xl border-2 object-cover md:h-[4.5rem] md:w-[4.5rem]"
          style="border-color: var(--lh-accent-gold)"
          loading="eager"
          @error="iconFailed = true"
        />
        <div
          v-else
          class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 text-sm font-semibold text-[var(--lh-muted)] md:h-[4.5rem] md:w-[4.5rem]"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
          aria-hidden="true"
        >
          {{ initials }}
        </div>

        <div class="min-w-0 space-y-1">
          <p class="text-xs uppercase tracking-[0.18em] text-[var(--lh-accent-gold)]">
            Collected sample
          </p>
          <h1
            id="champion-detail-heading"
            tabindex="-1"
            class="font-display text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl outline-none"
          >
            {{ champion.name }}
          </h1>
          <p class="text-sm text-[var(--lh-text-secondary)]">{{ champion.title }}</p>
          <ul v-if="champion.tags.length" class="mt-2 flex flex-wrap gap-2" aria-label="Tags">
            <li
              v-for="tag in champion.tags"
              :key="tag"
              class="rounded border px-2 py-0.5 text-xs text-[var(--lh-text-secondary)]"
              style="border-color: var(--lh-border)"
            >
              {{ tag }}
            </li>
          </ul>
        </div>
      </div>

      <div
        v-if="filterSummary"
        class="max-w-sm rounded-md border px-3 py-2 text-sm"
        style="border-color: var(--lh-border-strong); background: rgba(10, 14, 20, 0.55)"
      >
        <p class="text-xs uppercase tracking-wide text-[var(--lh-muted)]">Selected filters</p>
        <p class="mt-1 text-[var(--lh-text)]">{{ filterSummary }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  getMatchQueueLabel,
  getPlatformDisplayName,
  type ChampionDetail,
  type ChampionRankingPosition,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import { computed, ref, watch } from 'vue';
import { championInitials } from '~/utils/champion-display';
import { positionDisplayLabel } from '~/utils/champion-metrics';

const props = defineProps<{
  champion: ChampionDetail;
  platform?: PlatformRoute | null;
  queue?: number | null;
  tier?: ChampionStatsTierFilter | null;
  patch?: string | null;
  position?: ChampionRankingPosition | null;
}>();

const splashFailed = ref(false);
const iconFailed = ref(false);

watch(
  () => props.champion.splashUrl,
  () => {
    splashFailed.value = false;
  },
);

watch(
  () => props.champion.iconUrl,
  () => {
    iconFailed.value = false;
  },
);

const initials = computed(() =>
  championInitials(props.champion.name, props.champion.championId),
);

const filterSummary = computed(() => {
  const parts: string[] = [];
  if (props.platform) {
    parts.push(getPlatformDisplayName(props.platform));
  }
  if (props.queue !== null && props.queue !== undefined) {
    parts.push(getMatchQueueLabel(props.queue));
  }
  if (props.tier) {
    parts.push(props.tier);
  }
  if (props.patch) {
    parts.push(`Patch ${props.patch}`);
  }
  if (props.position) {
    parts.push(positionDisplayLabel(props.position));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
});
</script>
