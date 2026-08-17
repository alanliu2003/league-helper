<template>
  <div class="lh-container flex flex-col gap-8 py-8 md:gap-10 md:py-10">
    <p
      v-if="pending"
      class="text-sm text-[var(--lh-muted)]"
      role="status"
      aria-live="polite"
    >
      Loading match…
    </p>

    <MatchNotFound v-else-if="notFound" />

    <PlayerErrorBanner v-else-if="errorMessage" :message="errorMessage" show-home-link />

    <template v-else-if="detail">
      <p
        v-if="detail.match.ingestionStatus !== 'COMPLETED'"
        class="rounded-md border px-3 py-2 text-sm text-[var(--lh-warning)]"
        style="border-color: rgba(230, 168, 23, 0.35); background: rgba(230, 168, 23, 0.08)"
        role="status"
      >
        Match ingestion is {{ detail.match.ingestionStatus.toLowerCase().replace('_', ' ') }}. Some
        participants or stats may still be missing.
      </p>

      <p
        v-if="detail.match.remake"
        class="rounded-md border px-3 py-2 text-sm text-[var(--lh-remake)]"
        style="border-color: var(--lh-border); background: var(--lh-surface)"
        role="status"
      >
        This game was a remake. Stats are shown without a winning side.
      </p>

      <MatchHeader :match="detail.match" />

      <div class="flex flex-col gap-6">
        <MatchTeamPanel
          v-for="team in detail.teams"
          :key="team.teamId"
          :team="team"
          :remake="detail.match.remake"
          :origin-player-id="originPlayerId"
        />
      </div>

      <MatchDamageSection
        :teams="detail.teams"
        :ingestion-status="detail.match.ingestionStatus"
        :origin-player-id="originPlayerId"
      />

      <MatchEarlyGameSection
        :teams="detail.teams"
        :origin-player-id="originPlayerId"
        :timeline="detail.timeline"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import MatchDamageSection from '~/components/match/MatchDamageSection.vue';
import MatchEarlyGameSection from '~/components/match/MatchEarlyGameSection.vue';
import MatchHeader from '~/components/match/MatchHeader.vue';
import MatchNotFound from '~/components/match/MatchNotFound.vue';
import MatchTeamPanel from '~/components/match/MatchTeamPanel.vue';
import PlayerErrorBanner from '~/components/player/PlayerErrorBanner.vue';
import { useMatchDetailPage } from '~/composables/useMatchDetailPage';

const route = useRoute();
const { detail, pending, notFound, errorMessage, originPlayerId, load } = useMatchDetailPage();

onMounted(() => {
  void load();
});

watch(
  () => route.fullPath,
  () => {
    void load();
  },
);
</script>
