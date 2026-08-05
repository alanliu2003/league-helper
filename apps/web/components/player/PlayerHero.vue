<template>
  <section
    class="relative overflow-hidden rounded-xl"
    style="min-height: 12rem; box-shadow: var(--lh-shadow-md)"
    aria-label="Player profile"
  >
    <div class="absolute inset-0">
      <img
        v-if="splashUrl && !splashFailed"
        :src="splashUrl"
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
        aria-hidden="true"
      />
      <div
        class="absolute inset-0"
        style="
          background: linear-gradient(
            to top,
            rgba(10, 14, 20, 0.95) 0%,
            rgba(10, 14, 20, 0.6) 50%,
            rgba(10, 14, 20, 0.4) 100%
          );
        "
        aria-hidden="true"
      />
    </div>

    <div class="relative z-10 flex flex-wrap items-end justify-between gap-4 p-5 md:p-8">
      <div class="flex items-end gap-4">
        <img
          v-if="player.profileIconUrl && !profileIconFailed"
          :src="player.profileIconUrl"
          :alt="`${player.riotId.gameName} profile icon`"
          width="80"
          height="80"
          class="h-16 w-16 shrink-0 rounded-xl border-2 object-cover md:h-20 md:w-20"
          style="border-color: var(--lh-accent-gold)"
          loading="eager"
          @error="profileIconFailed = true"
        />
        <div
          v-else
          class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 text-sm text-[var(--lh-muted)] md:h-20 md:w-20"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
          aria-hidden="true"
        >
          {{ player.profileIconId ?? '—' }}
        </div>

        <div class="min-w-0 space-y-1">
          <p class="text-xs uppercase tracking-[0.18em] text-[var(--lh-accent-gold)]">
            {{ platformLabel }}
          </p>
          <h1 class="font-display text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
            {{ player.riotId.gameName }}
            <span class="text-[var(--lh-muted)]">#{{ player.riotId.tagLine }}</span>
          </h1>
          <p class="text-sm text-[var(--lh-text-secondary)]">
            Level {{ player.summonerLevel ?? '—' }}
            <span v-if="player.lastResolvedAt">
              · Updated {{ formatTimestamp(player.lastResolvedAt) }}
            </span>
          </p>
        </div>
      </div>

      <div class="flex flex-col items-end gap-2">
        <button
          type="button"
          class="lh-btn-primary"
          :disabled="refreshing || refreshState === 'PROCESSING'"
          @click="$emit('refresh')"
        >
          {{ refreshing ? 'Refreshing…' : 'Refresh matches' }}
        </button>
        <p v-if="refreshMessage" class="text-xs" :class="refreshMessageClass" role="status">
          {{ refreshMessage }}
        </p>
        <p v-if="pollTimedOut" class="text-xs text-[var(--lh-muted)]" role="status">
          Auto-refresh paused. Use refresh to check again.
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { getPlatformDisplayName, type PublicPlayer } from '@league-helper/shared';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  player: PublicPlayer;
  splashUrl?: string | null;
  refreshing?: boolean;
  refreshMessage?: string | null;
  refreshMessageClass?: string;
  refreshState?: string | null;
  pollTimedOut?: boolean;
}>();

defineEmits<{
  refresh: [];
}>();

const profileIconFailed = ref(false);
const splashFailed = ref(false);

watch(
  () => props.player.profileIconUrl,
  () => {
    profileIconFailed.value = false;
  },
);

watch(
  () => props.splashUrl,
  () => {
    splashFailed.value = false;
  },
);

const platformLabel = computed(() => getPlatformDisplayName(props.player.platform));

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}
</script>
