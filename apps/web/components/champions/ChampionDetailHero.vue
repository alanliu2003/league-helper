<template>
  <section
    class="champion-detail-hero relative overflow-hidden rounded-xl"
    style="box-shadow: var(--lh-shadow-md)"
    aria-labelledby="champion-detail-heading"
  >
    <div class="absolute inset-0" aria-hidden="true">
      <img
        v-if="champion.splashUrl && !splashFailed"
        :src="champion.splashUrl"
        alt=""
        width="1215"
        height="717"
        class="h-full w-full object-cover object-[center_20%]"
        loading="eager"
        fetchpriority="high"
        @error="splashFailed = true"
      />
      <div
        v-else
        data-testid="hero-splash-fallback"
        class="h-full w-full"
        style="
          background: linear-gradient(
            145deg,
            var(--lh-surface-inset) 0%,
            var(--lh-surface) 45%,
            var(--lh-surface-raised) 100%
          );
        "
      />
      <div
        class="absolute inset-0"
        style="
          background: linear-gradient(
            to top,
            rgba(10, 14, 20, 0.96) 0%,
            rgba(10, 14, 20, 0.72) 42%,
            rgba(10, 14, 20, 0.38) 100%
          );
        "
      />
      <div
        class="absolute inset-y-0 left-0 w-full max-w-xl"
        style="
          background: linear-gradient(
            to right,
            rgba(10, 14, 20, 0.55) 0%,
            rgba(10, 14, 20, 0.2) 55%,
            transparent 100%
          );
        "
      />
    </div>

    <div
      class="relative z-10 flex h-full min-h-[inherit] flex-col justify-end gap-3 p-4 sm:p-5 md:p-8"
    >
      <div class="flex min-w-0 items-end gap-3 sm:gap-4">
        <img
          v-if="champion.iconUrl && !iconFailed"
          :src="champion.iconUrl"
          :alt="`${champion.name} icon`"
          width="72"
          height="72"
          class="h-12 w-12 shrink-0 rounded-xl border-2 object-cover sm:h-14 sm:w-14 md:h-[4.5rem] md:w-[4.5rem]"
          style="border-color: var(--lh-accent-gold)"
          loading="eager"
          @error="iconFailed = true"
        />
        <div
          v-else
          data-testid="hero-icon-fallback"
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 text-sm font-semibold text-[var(--lh-muted)] sm:h-14 sm:w-14 md:h-[4.5rem] md:w-[4.5rem]"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
          aria-hidden="true"
        >
          {{ initials }}
        </div>

        <div class="min-w-0 flex-1 space-y-1">
          <h1
            id="champion-detail-heading"
            tabindex="-1"
            class="break-words font-display text-2xl font-semibold tracking-tight text-[var(--lh-text)] outline-none sm:text-3xl md:text-4xl"
          >
            {{ champion.name }}
          </h1>
          <p class="break-words text-sm text-[var(--lh-text-secondary)] sm:text-base">
            {{ champion.title }}
          </p>
          <p
            v-if="tagsLabel"
            class="break-words text-sm text-[var(--lh-text-secondary)]"
            aria-label="Tags"
          >
            {{ tagsLabel }}
          </p>
          <p
            v-if="contextSummary"
            class="break-words pt-0.5 text-xs uppercase tracking-[0.14em] text-[var(--lh-accent-gold)] sm:text-sm sm:normal-case sm:tracking-normal"
          >
            {{ contextSummary }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
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
  patch?: string | null;
  position?: ChampionRankingPosition | null;
  /** Retained for page wiring compatibility; not shown in the compact hero context. */
  platform?: PlatformRoute | null;
  queue?: number | null;
  tier?: ChampionStatsTierFilter | null;
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

const initials = computed(() => championInitials(props.champion.name, props.champion.championId));

const tagsLabel = computed(() => {
  if (!props.champion.tags.length) {
    return null;
  }
  return props.champion.tags.join(' · ');
});

/** Compact selected context — patch + position only to avoid filter-section duplication. */
const contextSummary = computed(() => {
  const parts: string[] = [];
  if (props.patch && props.patch !== 'unavailable') {
    parts.push(`Patch ${props.patch}`);
  } else if (props.patch === 'unavailable') {
    parts.push('Patch unavailable');
  }
  if (props.position) {
    parts.push(positionDisplayLabel(props.position));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
});
</script>

<style scoped>
.champion-detail-hero {
  min-height: 11.5rem;
}

@media (min-width: 768px) {
  .champion-detail-hero {
    min-height: 17rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .champion-detail-hero * {
    transition: none !important;
  }
}
</style>
