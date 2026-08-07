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
            freshnessBanner.tone === 'accent' ? 'text-[var(--lh-accent)]' : 'text-[var(--lh-muted)]'
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
            <h2 id="detail-filters-heading" class="font-display text-lg">Context</h2>
            <p class="mt-1 text-sm text-[var(--lh-muted)]">
              Selected position and patch define the collected sample below.
            </p>
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
                class="rounded-md border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
                :class="
                  filters.position === pos
                    ? 'bg-[var(--lh-accent-gold)]/10 font-medium text-[var(--lh-text)]'
                    : 'text-[var(--lh-text-secondary)] hover:border-[var(--lh-border-strong)]'
                "
                :style="{
                  borderColor:
                    filters.position === pos ? 'var(--lh-accent-gold)' : 'var(--lh-border)',
                }"
                :aria-checked="filters.position === pos"
                :disabled="!selectedQueueSupportsPositions"
                @click="onPosition(pos)"
              >
                {{ positionLabel(pos) }}
              </button>
              <button
                type="button"
                role="radio"
                class="rounded-md border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
                :class="
                  filters.position === null
                    ? 'bg-[var(--lh-accent-gold)]/10 font-medium text-[var(--lh-text)]'
                    : 'text-[var(--lh-text-secondary)] hover:border-[var(--lh-border-strong)]'
                "
                :style="{
                  borderColor:
                    filters.position === null ? 'var(--lh-accent-gold)' : 'var(--lh-border)',
                }"
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

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label class="block space-y-1.5 text-sm">
              <span class="text-[var(--lh-muted)]">Patch</span>
              <select
                class="lh-input"
                :value="filters.patch ?? ''"
                :disabled="!filtersMeta?.availablePatches.length"
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

            <label class="block space-y-1.5 text-sm">
              <span class="text-[var(--lh-muted)]">Platform</span>
              <select class="lh-input" :value="filters.platform ?? ''" @change="onPlatform">
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
          </div>
        </section>

        <div
          aria-live="polite"
          :aria-busy="statsPending"
          class="flex min-w-0 flex-col gap-8 md:gap-10"
        >
          <PlayerErrorBanner v-if="statsError" :message="statsError" />

          <template v-else>
            <!-- Primary > Performance > Breakdown visual hierarchy -->
            <ChampionsChampionSampleOverview
              v-if="filters.position"
              :metrics="exactMetrics"
              :empty-reason="emptyReason"
              :pending="statsPending"
            />
            <ChampionsChampionSampleOverview
              v-else
              :metrics="null"
              :empty-reason="null"
              :pending="false"
            />

            <template v-if="statsResponse || !statsPending">
              <ChampionsChampionPerformanceCards v-if="filters.position" :metrics="exactMetrics" />

              <ChampionsChampionPositionBreakdown
                :entries="positionBreakdown"
                :selected-position="filters.position"
              />
            </template>
          </template>
        </div>

        <div class="min-w-0 border-t pt-6" style="border-color: var(--lh-border)">
          <ChampionsChampionLimitationsPanel
            :disclaimer="statsResponse?.disclaimer ?? filtersMeta?.disclaimer"
            :rank-tier-semantics="
              statsResponse?.rankTierSemantics ?? filtersMeta?.rankTierSemantics
            "
            :platform="filters.platform"
            :queue="filters.queue"
            :patch="filters.patch"
            :tier="filters.tier"
          />
        </div>

        <p class="text-sm">
          <NuxtLink :to="directoryBackPath" class="text-[var(--lh-accent)] hover:underline">
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
import { buildChampionsDirectoryPath } from '~/utils/champion-links';
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

/** Static identity + supported metric categories — never filter-specific rates. */
const pageDescription = computed(() => {
  if (!champion.value) {
    return 'Browse League Helper collected-sample champion statistics.';
  }
  const titlePart = champion.value.title ? `, ${champion.value.title}` : '';
  return `View collected-sample stats for ${champion.value.name}${titlePart}, including win rate, KDA, CS/min, damage, and position performance.`;
});

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
});

const directoryBackPath = computed(() =>
  buildChampionsDirectoryPath({
    platform: filters.platform,
    queue: filters.queue,
    tier: filters.tier,
    position: filters.position,
    patch: filters.patch,
  }),
);

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
  if (champion.value && next.toLowerCase() === champion.value.championKey.toLowerCase()) {
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
