<template>
  <article
    class="rounded-xl border border-white/10 bg-[var(--lh-bg)]/40 px-4 py-3"
    :aria-label="`${resultLabel} as ${championDisplayName}`"
  >
    <div class="flex flex-wrap items-start gap-3">
      <img
        v-if="match.championIconUrl && !championImageFailed"
        :src="match.championIconUrl"
        :alt="`${championDisplayName} icon`"
        width="48"
        height="48"
        class="h-12 w-12 shrink-0 rounded-md bg-[var(--lh-surface)] object-cover"
        loading="lazy"
        @error="championImageFailed = true"
      />
      <div
        v-else
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--lh-surface)] text-xs font-semibold text-[var(--lh-muted)]"
        aria-hidden="true"
      >
        {{ championInitials }}
      </div>

      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-semibold uppercase tracking-wide" :class="resultClass">
            {{ resultLabel }}
          </span>
          <span class="truncate font-medium">{{ championDisplayName }}</span>
          <span v-if="roleLabel" :class="roleLabelClass">{{ roleLabel }}</span>
        </div>

        <p class="text-sm">
          <span class="font-semibold tabular-nums">{{ kdaLabel }}</span>
          <span class="text-[var(--lh-muted)]"> KDA</span>
          <span class="mx-2 text-[var(--lh-muted)]">·</span>
          <span class="tabular-nums">{{ csLabel }}</span>
          <span v-if="kpLabel" class="text-[var(--lh-muted)]">
            <span class="mx-2">·</span>{{ kpLabel }} KP
          </span>
        </p>

        <ul v-if="visibleItems.length > 0" class="flex flex-wrap gap-1" aria-label="Items">
          <li v-for="(item, index) in visibleItems" :key="`${item.id}-${index}`">
            <img
              v-if="item.iconUrl"
              :src="item.iconUrl"
              :alt="`Item ${item.id}`"
              width="24"
              height="24"
              class="h-6 w-6 rounded-sm bg-[var(--lh-surface)] object-cover"
              loading="lazy"
            />
            <span
              v-else
              class="flex h-6 w-6 items-center justify-center rounded-sm bg-[var(--lh-surface)] text-[10px] text-[var(--lh-muted)]"
              :title="`Item ${item.id}`"
            >
              {{ item.id }}
            </span>
          </li>
        </ul>
      </div>

      <div class="ml-auto space-y-1 text-right text-xs text-[var(--lh-muted)]">
        <p>{{ queueLabel }}</p>
        <p>{{ durationLabel }}</p>
        <p>{{ relativeTimeLabel }}</p>
        <p v-if="patchLabel">Patch {{ patchLabel }}</p>
        <p :class="match.timelineMetricsAvailable ? 'text-[var(--lh-ok)]' : ''">
          {{ match.timelineMetricsAvailable ? 'Timeline metrics' : 'No timeline metrics' }}
        </p>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import {
  getMatchQueueLabel,
  getNormalizedPositionLabel,
  type PublicMatchSummary,
} from '@league-helper/shared';
import { computed, ref } from 'vue';

const props = defineProps<{
  match: PublicMatchSummary;
}>();

const championImageFailed = ref(false);

const championDisplayName = computed(() => {
  return props.match.championName?.trim() || `Champion #${props.match.championId ?? '?'}`;
});

const championInitials = computed(() => {
  const name = championDisplayName.value;
  if (name.startsWith('Champion #')) {
    return '?';
  }
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
});

const resultLabel = computed(() => {
  switch (props.match.result) {
    case 'victory':
      return 'Victory';
    case 'defeat':
      return 'Defeat';
    case 'remake':
      return 'Remake';
    default:
      return 'Unknown';
  }
});

const resultClass = computed(() => {
  switch (props.match.result) {
    case 'victory':
      return 'text-[var(--lh-ok)]';
    case 'defeat':
      return 'text-[var(--lh-bad)]';
    case 'remake':
      return 'text-[var(--lh-muted)]';
    default:
      return 'text-[var(--lh-muted)]';
  }
});

const roleLabel = computed(() => {
  const position = props.match.role ?? props.match.teamPosition;
  if (!position) {
    return getNormalizedPositionLabel('UNKNOWN');
  }
  return getNormalizedPositionLabel(position);
});

const roleLabelClass = computed(() =>
  (props.match.role ?? props.match.teamPosition) === 'UNKNOWN'
    ? 'text-xs text-[var(--lh-muted)]/70'
    : 'text-xs text-[var(--lh-muted)]',
);

const kdaLabel = computed(() => {
  const { kills, deaths, assists, kda } = props.match;
  if (kills == null || deaths == null || assists == null) {
    return '—';
  }
  const ratio = kda == null ? '' : ` (${kda % 1 === 0 ? kda.toFixed(0) : kda.toFixed(2)})`;
  return `${kills}/${deaths}/${assists}${ratio}`;
});

const csLabel = computed(() => {
  if (props.match.totalCs == null) {
    return 'CS —';
  }
  if (props.match.csPerMinute == null) {
    return `${props.match.totalCs} CS`;
  }
  return `${props.match.totalCs} CS (${props.match.csPerMinute.toFixed(1)}/m)`;
});

const kpLabel = computed(() => {
  if (props.match.killParticipation == null) {
    return null;
  }
  return `${Math.round(props.match.killParticipation * 100)}%`;
});

const visibleItems = computed(() => {
  return props.match.itemIds
    .map((id, index) => ({
      id,
      iconUrl: props.match.itemIconUrls[index] ?? null,
    }))
    .filter((item) => item.id > 0);
});

const queueLabel = computed(() => getMatchQueueLabel(props.match.queueId));

const durationLabel = computed(() => {
  const total = props.match.gameDurationSeconds;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

const relativeTimeLabel = computed(() => formatRelativeTime(props.match.gameCreation));

const patchLabel = computed(
  () =>
    props.match.normalizedPatch?.trim() || props.match.gameVersion.split('.').slice(0, 2).join('.'),
);

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}
</script>
