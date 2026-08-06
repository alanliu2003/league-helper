<template>
  <div class="lh-container flex flex-col gap-8 py-8 md:gap-10 md:py-10">
    <ChampionsChampionNotFound v-if="notFound" />

    <template v-else>
      <p
        v-if="filtersResolving || metadataPending"
        class="text-sm text-[var(--lh-muted)]"
        role="status"
        aria-live="polite"
      >
        Loading champion…
      </p>

      <PlayerErrorBanner v-else-if="filtersError" :message="filtersError" />
      <PlayerErrorBanner v-else-if="metadataError" :message="metadataError" />

      <template v-else-if="champion && filtersReady">
        <ChampionsChampionDetailHero
          :champion="champion"
          :platform="filters.platform"
          :queue="filters.queue"
          :tier="filters.tier"
          :patch="filters.patch"
          :position="filters.position"
        />

        <p
          v-if="freshnessBanner"
          class="rounded-md border px-3 py-2 text-sm"
          :class="
            freshnessBanner.tone === 'accent'
              ? 'text-[var(--lh-accent)]'
              : 'text-[var(--lh-muted)]'
          "
          :style="
            freshnessBanner.tone === 'accent'
              ? {
                  borderColor: 'rgba(94, 176, 255, 0.35)',
                  background: 'rgba(94, 176, 255, 0.08)',
                }
              : {
                  borderColor: 'var(--lh-border)',
                  background: 'var(--lh-surface)',
                }
          "
          role="status"
          aria-live="polite"
        >
          {{ freshnessBanner.text }}
        </p>

        <section
          class="lh-surface-raised space-y-4 p-4 md:p-5"
          aria-labelledby="detail-filters-heading"
        >
          <div>
            <h2 id="detail-filters-heading" class="font-display text-lg">Aggregate filters</h2>
            <p class="mt-1 text-sm text-[var(--lh-muted)]">
              URL is authoritative. Directory search and tag are not carried onto this page.
            </p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label class="block space-y-1.5 text-sm">
              <span class="text-[var(--lh-muted)]">Platform</span>
              <select
                class="lh-input"
                :value="filters.platform ?? ''"
                @change="onPlatform"
              >
                <option v-for="p in filtersMeta?.availablePlatforms ?? []" :key="p" :value="p">
                  {{ displayPlatform(p) }}
                </option>
              </select>
            </label>

            <label class="block space-y-1.5 text-sm">
              <span class="text-[var(--lh-muted)]">Queue</span>
              <select class="lh-input" :value="filters.queue ?? ''" @change="onQueue">
                <option v-for="q in rankingQueues" :key="q.queueId" :value="q.queueId">
                  {{ q.label }}
                </option>
              </select>
            </label>

            <label class="block space-y-1.5 text-sm">
              <span class="text-[var(--lh-muted)]">Tier</span>
              <select class="lh-input" :value="filters.tier ?? 'ALL'" @change="onTier">
                <option v-for="t in primaryTiers" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>

            <label class="block space-y-1.5 text-sm">
              <span class="text-[var(--lh-muted)]">Patch</span>
              <select
                class="lh-input"
                :value="filters.patch ?? ''"
                :disabled="!(filtersMeta?.availablePatches.length)"
                @change="onPatch"
              >
                <option
                  v-if="filters.patch === 'unavailable' || !filtersMeta?.availablePatches.length"
                  value="unavailable"
                >
                  Unavailable
                </option>
                <option v-for="p in filtersMeta?.availablePatches ?? []" :key="p" :value="p">
                  {{ p }}
                </option>
              </select>
            </label>
          </div>

          <div class="space-y-2">
            <p id="detail-position-label" class="text-sm text-[var(--lh-muted)]">Position</p>
            <div
              role="radiogroup"
              aria-labelledby="detail-position-label"
              class="flex flex-wrap gap-2"
            >
              <button
                v-for="pos in filtersMeta?.availablePositions ?? []"
                :key="pos"
                type="button"
                role="radio"
                class="rounded-md border px-3 py-1.5 text-sm transition"
                :class="
                  filters.position === pos
                    ? 'border-[var(--lh-accent)] bg-[var(--lh-accent)]/15 text-[var(--lh-text)]'
                    : 'text-[var(--lh-text-secondary)] hover:border-[var(--lh-border-strong)]'
                "
                style="border-color: var(--lh-border)"
                :aria-checked="filters.position === pos"
                :disabled="!selectedQueueSupportsPositions"
                @click="onPosition(pos)"
              >
                {{ positionLabel(pos) }}
              </button>
              <button
                type="button"
                role="radio"
                class="rounded-md border px-3 py-1.5 text-sm text-[var(--lh-text-secondary)] transition hover:border-[var(--lh-border-strong)]"
                style="border-color: var(--lh-border)"
                :aria-checked="filters.position === null"
                @click="onPosition(null)"
              >
                None
              </button>
            </div>
            <p v-if="!selectedQueueSupportsPositions" class="text-xs text-[var(--lh-muted)]">
              This queue does not support standard role ranking.
            </p>
          </div>
        </section>

        <div aria-live="polite" class="space-y-8">
          <p
            v-if="statsPending && !statsResponse"
            class="text-sm text-[var(--lh-muted)]"
            role="status"
          >
            Loading collected sample statistics…
          </p>
          <PlayerErrorBanner v-else-if="statsError" :message="statsError" />

          <template v-else-if="statsResponse || !statsPending">
            <template v-if="filters.position">
              <ChampionsChampionSampleOverview
                :metrics="exactMetrics"
                :empty-reason="emptyReason"
              />
              <ChampionsChampionPerformanceCards :metrics="exactMetrics" />
            </template>
            <ChampionsChampionSampleOverview
              v-else
              :metrics="null"
              :empty-reason="null"
            />

            <ChampionsChampionPositionBreakdown
              :entries="positionBreakdown"
              :selected-position="filters.position"
            />
          </template>
        </div>

        <ChampionsChampionLimitationsPanel
          :disclaimer="statsResponse?.disclaimer ?? filtersMeta?.disclaimer"
          :rank-tier-semantics="statsResponse?.rankTierSemantics ?? filtersMeta?.rankTierSemantics"
          :platform="filters.platform"
          :queue="filters.queue"
          :patch="filters.patch"
          :tier="filters.tier"
        />

        <p class="text-sm">
          <NuxtLink to="/champions" class="text-[var(--lh-accent)] hover:underline">
            ← Back to champions directory
          </NuxtLink>
        </p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  getPlatformDisplayName,
  type ChampionRankingPosition,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import { computed, onMounted, watch } from 'vue';
import { useChampionDetailPage } from '~/composables/useChampionDetailPage';
import { championFreshnessBanner } from '~/utils/champion-freshness';
import { positionDisplayLabel } from '~/utils/champion-metrics';

const route = useRoute();

const routeKey = computed(() => String(route.params.championKey ?? ''));

const {
  filters,
  filtersMeta,
  filtersResolving,
  filtersReady,
  filtersError,
  notFound,
  champion,
  metadataPending,
  metadataError,
  statsResponse,
  statsPending,
  statsError,
  emptyReason,
  positionBreakdown,
  freshness,
  primaryTiers,
  rankingQueues,
  selectedQueueSupportsPositions,
  initialize,
  reload,
  setPlatform,
  setQueue,
  setTier,
  setPosition,
  setPatch,
} = useChampionDetailPage(() => routeKey.value);

const exactMetrics = computed(() => statsResponse.value?.stats?.metrics ?? null);

const pageTitle = computed(() =>
  champion.value ? `${champion.value.name} · Champions` : 'Champion',
);

useHead({
  title: pageTitle,
});

const freshnessBanner = computed(() =>
  championFreshnessBanner(freshness.value, {
    calculatedAt: statsResponse.value?.stats?.metrics.calculatedAt,
  }),
);

onMounted(() => {
  void initialize();
});

watch(routeKey, async (next, prev) => {
  if (!next || next === prev) {
    return;
  }
  // Canonical case replace (ahri → Ahri) should not restart the whole page load.
  if (
    champion.value &&
    next.toLowerCase() === champion.value.championKey.toLowerCase()
  ) {
    if (import.meta.client) {
      document.getElementById('champion-detail-heading')?.focus();
    }
    return;
  }
  await reload();
  if (import.meta.client) {
    document.getElementById('champion-detail-heading')?.focus();
  }
});

function displayPlatform(platform: PlatformRoute): string {
  return getPlatformDisplayName(platform);
}

function positionLabel(position: ChampionRankingPosition): string {
  return positionDisplayLabel(position);
}

function onPlatform(event: Event): void {
  void setPlatform((event.target as HTMLSelectElement).value as PlatformRoute);
}

function onQueue(event: Event): void {
  void setQueue(Number((event.target as HTMLSelectElement).value));
}

function onTier(event: Event): void {
  void setTier((event.target as HTMLSelectElement).value as ChampionStatsTierFilter);
}

function onPatch(event: Event): void {
  void setPatch((event.target as HTMLSelectElement).value);
}

function onPosition(position: ChampionRankingPosition | null): void {
  void setPosition(position);
}
</script>
