<template>
  <section
    class="lh-surface-raised space-y-5 p-4 md:p-5"
    aria-labelledby="champion-filters-heading"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="champion-filters-heading" class="font-display text-lg">Filters</h2>
        <p class="mt-1 text-sm text-[var(--lh-muted)]">
          URL is the source of truth. Aggregate filters apply to ranking; search and tag apply to the
          directory only.
        </p>
      </div>
      <div
        v-if="platform && queue !== null"
        class="rounded-md border px-3 py-2 text-sm"
        style="border-color: var(--lh-border-strong); background: var(--lh-surface-inset)"
      >
        <span class="text-[var(--lh-muted)]">Scope</span>
        <p class="font-medium text-[var(--lh-text)]">
          {{ platformLabel }} · {{ queueLabel }}
        </p>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label class="block space-y-1.5 text-sm">
        <span class="text-[var(--lh-muted)]">Platform</span>
        <select
          class="lh-input"
          :value="platform ?? ''"
          :disabled="disabled"
          @change="onPlatform"
        >
          <option v-for="p in platforms" :key="p" :value="p">
            {{ displayPlatform(p) }}
          </option>
        </select>
      </label>

      <label class="block space-y-1.5 text-sm">
        <span class="text-[var(--lh-muted)]">Queue</span>
        <select class="lh-input" :value="queue ?? ''" :disabled="disabled" @change="onQueue">
          <option v-for="q in queues" :key="q.queueId" :value="q.queueId">
            {{ q.label }}
          </option>
        </select>
      </label>

      <label class="block space-y-1.5 text-sm">
        <span class="text-[var(--lh-muted)]">Tier</span>
        <select class="lh-input" :value="tier ?? 'ALL'" :disabled="disabled" @change="onTier">
          <option v-for="t in tiers" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>

      <label class="block space-y-1.5 text-sm">
        <span class="text-[var(--lh-muted)]">Patch</span>
        <select
          class="lh-input"
          :value="patch ?? ''"
          :disabled="disabled || patches.length === 0"
          @change="onPatch"
        >
          <option v-if="patch === 'unavailable' || patches.length === 0" value="unavailable">
            Unavailable
          </option>
          <option v-for="p in patches" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </div>

    <div class="space-y-2">
      <p id="position-label" class="text-sm text-[var(--lh-muted)]">Position</p>
      <div
        role="radiogroup"
        aria-labelledby="position-label"
        class="flex flex-wrap gap-2"
      >
        <button
          v-for="pos in positions"
          :key="pos"
          type="button"
          role="radio"
          class="rounded-md border px-3 py-1.5 text-sm transition"
          :class="
            position === pos
              ? 'border-[var(--lh-accent)] bg-[var(--lh-accent)]/15 text-[var(--lh-text)]'
              : 'text-[var(--lh-text-secondary)] hover:border-[var(--lh-border-strong)]'
          "
          style="border-color: var(--lh-border)"
          :aria-checked="position === pos"
          :disabled="disabled || !supportsPositions"
          @click="emit('update:position', pos)"
        >
          {{ positionLabel(pos) }}
        </button>
        <button
          type="button"
          role="radio"
          class="rounded-md border px-3 py-1.5 text-sm text-[var(--lh-text-secondary)] transition hover:border-[var(--lh-border-strong)]"
          style="border-color: var(--lh-border)"
          :aria-checked="position === null"
          :disabled="disabled"
          @click="emit('update:position', null)"
        >
          None
        </button>
      </div>
      <p v-if="!supportsPositions" class="text-xs text-[var(--lh-muted)]">
        This queue does not support standard role ranking. Browse the directory instead.
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block space-y-1.5 text-sm">
        <span class="text-[var(--lh-muted)]">Directory search</span>
        <input
          class="lh-input"
          type="search"
          :value="search ?? ''"
          :disabled="disabled"
          placeholder="Search champion name"
          autocomplete="off"
          @input="onSearchInput"
        />
      </label>
      <label class="block space-y-1.5 text-sm">
        <span class="text-[var(--lh-muted)]">Directory tag</span>
        <input
          class="lh-input"
          type="text"
          :value="tag ?? ''"
          :disabled="disabled"
          placeholder="e.g. Mage"
          autocomplete="off"
          @change="onTagChange"
        />
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  getMatchQueueLabel,
  getPlatformDisplayName,
  type ChampionRankingPosition,
  type ChampionStatsFilterQueue,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  platforms: PlatformRoute[];
  queues: ChampionStatsFilterQueue[];
  tiers: ChampionStatsTierFilter[];
  patches: string[];
  positions: ChampionRankingPosition[];
  platform: PlatformRoute | null;
  queue: number | null;
  tier: ChampionStatsTierFilter | null;
  patch: string | null;
  position: ChampionRankingPosition | null;
  search: string | null;
  tag: string | null;
  supportsPositions: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:platform': [value: PlatformRoute];
  'update:queue': [value: number];
  'update:tier': [value: ChampionStatsTierFilter];
  'update:patch': [value: string];
  'update:position': [value: ChampionRankingPosition | null];
  'update:search': [value: string | null];
  'update:tag': [value: string | null];
}>();

const platformLabel = computed(() =>
  props.platform ? getPlatformDisplayName(props.platform) : '—',
);

const queueLabel = computed(() =>
  props.queue !== null ? getMatchQueueLabel(props.queue) : '—',
);

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function displayPlatform(platform: PlatformRoute): string {
  return getPlatformDisplayName(platform);
}

function positionLabel(position: ChampionRankingPosition): string {
  switch (position) {
    case 'TOP':
      return 'Top';
    case 'JUNGLE':
      return 'Jungle';
    case 'MIDDLE':
      return 'Mid';
    case 'BOTTOM':
      return 'Bot';
    case 'SUPPORT':
      return 'Support';
    default:
      return position;
  }
}

function onPlatform(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as PlatformRoute;
  emit('update:platform', value);
}

function onQueue(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  emit('update:queue', value);
}

function onTier(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ChampionStatsTierFilter;
  emit('update:tier', value);
}

function onPatch(event: Event): void {
  emit('update:patch', (event.target as HTMLSelectElement).value);
}

function onSearchInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    emit('update:search', value.trim() || null);
  }, 250);
}

function onTagChange(event: Event): void {
  const value = (event.target as HTMLInputElement).value.trim();
  emit('update:tag', value || null);
}
</script>
