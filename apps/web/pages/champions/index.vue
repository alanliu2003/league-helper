<template>
  <div class="lh-container flex flex-col gap-8 py-8 md:gap-10 md:py-10">
    <header class="space-y-3">
      <p class="text-sm uppercase tracking-[0.22em] text-[var(--lh-accent-gold)]">
        Collected sample stats
      </p>
      <h1 class="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Champions</h1>
      <p class="max-w-2xl text-[var(--lh-text-secondary)]">
        Browse the static champion directory and inspect collected-sample rankings for a selected
        platform, queue, and position.
      </p>
    </header>

    <ChampionsChampionStatsDisclaimer
      :disclaimer="filtersMeta?.disclaimer"
    />

    <p
      v-if="filtersResolving"
      class="text-sm text-[var(--lh-muted)]"
      role="status"
      aria-live="polite"
    >
      Resolving filters…
    </p>

    <PlayerErrorBanner v-else-if="filtersError" :message="filtersError" />

    <template v-else-if="filtersReady && filtersMeta">
      <ChampionsChampionFilterBar
        :platforms="filtersMeta.availablePlatforms"
        :queues="rankingQueues"
        :tiers="primaryTiers"
        :patches="filtersMeta.availablePatches"
        :positions="filtersMeta.availablePositions"
        :platform="filters.platform"
        :queue="filters.queue"
        :tier="filters.tier"
        :patch="filters.patch"
        :position="filters.position"
        :search="filters.search"
        :tag="filters.tag"
        :supports-positions="selectedQueueSupportsPositions"
        @update:platform="onPlatform"
        @update:queue="onQueue"
        @update:tier="onTier"
        @update:patch="onPatch"
        @update:position="onPosition"
        @update:search="onSearch"
        @update:tag="onTag"
      />

      <ChampionsChampionPositionRequiredState
        v-if="!filters.position || !selectedQueueSupportsPositions"
        :supports-positions="selectedQueueSupportsPositions"
      />

      <ChampionsChampionRankingTable
        v-else
        :rows="rankingRows"
        :sample-scope="displayedResponse?.sampleScope"
        :freshness="displayedResponse?.freshness"
        :tier="filters.tier"
        :loading="rankingLoading"
        :is-updating="viewState.isUpdating"
        :error="rankingError"
        :empty-reason="displayedResponse?.emptyReason"
        :link-filters="aggregateLinkFilters"
      />

      <ChampionsChampionDirectoryGrid
        :champions="directoryChampions"
        :pending="directoryPending"
        :error="directoryError"
        :static-data-patch="directory?.staticDataPatch"
        :link-filters="aggregateLinkFilters"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type {
  ChampionRankingPosition,
  ChampionStatsTierFilter,
  PlatformRoute,
} from '@league-helper/shared';
import { computed, onMounted } from 'vue';
import { useChampionStatsFilters } from '~/composables/useChampionStatsFilters';

useHead({
  title: 'Champions',
});

const {
  filters,
  filtersMeta,
  filtersResolving,
  filtersReady,
  filtersError,
  viewState,
  rankingError,
  directory,
  directoryError,
  directoryPending,
  rankingPending,
  selectedQueueSupportsPositions,
  primaryTiers,
  rankingQueues,
  initialize,
  setPlatform,
  setQueue,
  setTier,
  setPosition,
  setPatch,
  setSearch,
  setTag,
} = useChampionStatsFilters();

const displayedResponse = computed(() => viewState.value.displayedResponse);
const rankingRows = computed(() => displayedResponse.value?.rows ?? []);
const rankingLoading = computed(
  () => Boolean(filters.position) && rankingPending.value && !displayedResponse.value,
);
const directoryChampions = computed(() => directory.value?.champions ?? []);

const aggregateLinkFilters = computed(() => ({
  platform: filters.platform,
  queue: filters.queue,
  tier: filters.tier,
  position: filters.position,
  patch: filters.patch,
}));

onMounted(() => {
  void initialize();
});

function onPlatform(value: PlatformRoute): void {
  void setPlatform(value);
}

function onQueue(value: number): void {
  void setQueue(value);
}

function onTier(value: ChampionStatsTierFilter): void {
  void setTier(value);
}

function onPatch(value: string): void {
  void setPatch(value);
}

function onPosition(value: ChampionRankingPosition | null): void {
  void setPosition(value);
}

function onSearch(value: string | null): void {
  void setSearch(value);
}

function onTag(value: string | null): void {
  void setTag(value);
}
</script>
