<template>
  <div class="lh-container flex flex-col gap-8 py-8 md:gap-10 md:py-10">
    <template v-if="pending">
      <PlayerHeroSkeleton />
      <PlayerRankedOverviewSkeleton />
      <PlayerMasteryShowcaseSkeleton />
      <p class="text-sm text-[var(--lh-muted)]" role="status">Loading player…</p>
    </template>

    <template v-else-if="loadError">
      <PlayerErrorBanner :message="loadError" show-home-link />
    </template>

    <template v-else-if="profileMeta && refreshStatus">
      <PlayerHero
        :player="profileMeta.player"
        :splash-url="heroSplashUrl"
        :refreshing="refreshing"
        :refresh-message="refreshMessage"
        :refresh-message-class="refreshMessageClass"
        :refresh-state="refreshStatus.state"
        :poll-timed-out="pollTimedOut"
        @refresh="onRefresh"
      />

      <PlayerRankedOverview :ranks="profileMeta.ranks" />

      <PlayerErrorBanner v-if="playstyleError" :message="playstyleError" variant="info" />

      <div
        v-if="playstylePending && !playstyle"
        class="lh-skeleton h-48"
        role="status"
        aria-label="Loading playstyle"
      />

      <PlayerPlaystylePanel v-else-if="playstyle" :playstyle="playstyle" />

      <PlayerMasteryShowcase :mastery="profileMeta.mastery" />

      <PlayerMatchList
        :matches="matches"
        :refresh="refreshStatus"
        :refreshing="refreshing"
        :matches-error="matchesError"
        :matches-loading="matchesLoading"
        :queue-category="queueCategory"
        :show-manual-refresh="pollTimedOut || !isPolling"
        :last-updated="profileMeta.player.lastResolvedAt"
        :player-id="playerId"
        @refresh="onRefresh"
        @update:queue-category="onQueueCategory"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  PlayerMatchQueueCategorySchema,
  type PlayerMatchQueueCategory,
} from '@league-helper/shared';
import { usePlayerApi } from '../../composables/usePlayerApi';
import { createPlayerProfilePageController } from '../../composables/usePlayerProfilePage';

const route = useRoute();
const router = useRouter();
const playerId = computed(() => String(route.params.playerId));
const api = usePlayerApi();

const {
  profileMeta,
  matches,
  refreshStatus,
  pending,
  loadError,
  matchesError,
  refreshing,
  refreshMessage,
  refreshMessageClass,
  isPolling,
  pollTimedOut,
  queueCategory,
  matchesLoading,
  playstyle,
  playstyleError,
  playstylePending,
  loadProfile,
  onRefresh,
  setQueueCategory,
  stopPolling,
} = createPlayerProfilePageController(() => playerId.value, api);

const heroSplashUrl = computed(() => profileMeta.value?.mastery[0]?.championSplashUrl ?? null);

function parseQueueFromQuery(): PlayerMatchQueueCategory {
  const q = route.query.queue;
  if (typeof q === 'string') {
    const parsed = PlayerMatchQueueCategorySchema.safeParse(q);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return 'all';
}

async function onQueueCategory(category: PlayerMatchQueueCategory): Promise<void> {
  await setQueueCategory(category);
  const query = { ...route.query };
  if (category === 'all') {
    delete query.queue;
  } else {
    query.queue = category;
  }
  await router.replace({ query });
}

watch(playerId, () => {
  queueCategory.value = parseQueueFromQuery();
  void loadProfile();
});

onMounted(() => {
  queueCategory.value = parseQueueFromQuery();
  void loadProfile();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>
