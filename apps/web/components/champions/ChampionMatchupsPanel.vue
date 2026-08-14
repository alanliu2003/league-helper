<template>
  <div class="space-y-8" data-testid="champion-matchups-panel">
    <div>
      <h2 id="matchups-heading" class="font-display text-xl">Matchups</h2>
      <p class="mt-1 text-sm text-[var(--lh-muted)]">
        Same-lane collected-sample counters for
        {{ positionLabel }}. Not a recommendation engine.
      </p>
    </div>

    <p v-if="pending" class="text-sm text-[var(--lh-muted)]" role="status" aria-live="polite">
      Loading collected matchup data…
    </p>
    <PlayerErrorBanner v-else-if="error" :message="error" />

    <template v-else-if="response">
      <p
        v-if="response.emptyReason === 'UNKNOWN_RANK_HIDDEN'"
        class="text-sm text-[var(--lh-muted)]"
        role="status"
      >
        Matchup analytics are hidden for UNKNOWN rank until that aggregate debt is reconciled.
      </p>
      <p
        v-else-if="response.emptyReason === 'NO_ELIGIBLE_MATCHUPS'"
        class="text-sm text-[var(--lh-muted)]"
        role="status"
        data-testid="matchups-empty"
      >
        Not enough matchup data yet for reliable counter analysis in this filter.
      </p>

      <template v-else>
        <p class="text-sm text-[var(--lh-muted)]">
          Display floor {{ response.displayFloor }} games. Ranked by Wilson lower bound, not raw win
          rate.
        </p>

        <section aria-labelledby="weak-against-heading" data-testid="weak-against">
          <h3 id="weak-against-heading" class="font-display text-lg">Weak Against</h3>
          <p v-if="response.weakAgainst.length === 0" class="mt-2 text-sm text-[var(--lh-muted)]">
            No eligible losing matchups in this sample.
          </p>
          <ul v-else class="mt-3 space-y-2">
            <li v-for="row in response.weakAgainst" :key="row.opponent.championKey">
              <NuxtLink
                :to="opponentPath(row.opponent.championKey)"
                class="lh-surface-raised flex min-w-0 items-center gap-3 p-3 hover:border-[var(--lh-border-strong)]"
              >
                <img
                  v-if="row.opponent.iconUrl"
                  :src="row.opponent.iconUrl"
                  :alt="row.opponent.name"
                  width="40"
                  height="40"
                  class="h-10 w-10 shrink-0 rounded-md"
                  @error="hideBrokenImage"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-[var(--lh-text)]">{{ row.opponent.name }}</p>
                  <p class="text-xs text-[var(--lh-muted)]">{{ positionLabel }}</p>
                </div>
                <div class="shrink-0 text-right text-sm tabular-nums">
                  <p>{{ formatChampionRate(row.winRate) }}</p>
                  <p class="text-[var(--lh-text-secondary)]">
                    {{ row.sampleSize }} {{ row.sampleSize === 1 ? 'game' : 'games' }}
                  </p>
                  <p
                    :class="
                      row.lowSample
                        ? 'text-[var(--lh-muted)]'
                        : confidenceToneClass(row.sampleConfidence)
                    "
                  >
                    {{ row.lowSample ? 'Limited sample' : row.sampleConfidence }}
                  </p>
                </div>
              </NuxtLink>
              <ChampionsChampionAiMatchupWhy
                v-if="whyByOpponent[row.opponent.championKey]"
                :text="whyByOpponent[row.opponent.championKey] ?? ''"
              />
            </li>
          </ul>
        </section>

        <section aria-labelledby="strong-against-heading" data-testid="strong-against">
          <h3 id="strong-against-heading" class="font-display text-lg">Strong Against</h3>
          <p v-if="response.strongAgainst.length === 0" class="mt-2 text-sm text-[var(--lh-muted)]">
            No eligible winning matchups in this sample.
          </p>
          <ul v-else class="mt-3 space-y-2">
            <li v-for="row in response.strongAgainst" :key="row.opponent.championKey">
              <NuxtLink
                :to="opponentPath(row.opponent.championKey)"
                class="lh-surface-raised flex min-w-0 items-center gap-3 p-3 hover:border-[var(--lh-border-strong)]"
              >
                <img
                  v-if="row.opponent.iconUrl"
                  :src="row.opponent.iconUrl"
                  :alt="row.opponent.name"
                  width="40"
                  height="40"
                  class="h-10 w-10 shrink-0 rounded-md"
                  @error="hideBrokenImage"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-[var(--lh-text)]">{{ row.opponent.name }}</p>
                  <p class="text-xs text-[var(--lh-muted)]">{{ positionLabel }}</p>
                </div>
                <div class="shrink-0 text-right text-sm tabular-nums">
                  <p>{{ formatChampionRate(row.winRate) }}</p>
                  <p class="text-[var(--lh-text-secondary)]">
                    {{ row.sampleSize }} {{ row.sampleSize === 1 ? 'game' : 'games' }}
                  </p>
                  <p
                    :class="
                      row.lowSample
                        ? 'text-[var(--lh-muted)]'
                        : confidenceToneClass(row.sampleConfidence)
                    "
                  >
                    {{ row.lowSample ? 'Limited sample' : row.sampleConfidence }}
                  </p>
                </div>
              </NuxtLink>
              <ChampionsChampionAiMatchupWhy
                v-if="whyByOpponent[row.opponent.championKey]"
                :text="whyByOpponent[row.opponent.championKey] ?? ''"
              />
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import type {
  ChampionAiPublicInsight,
  ChampionMatchupsResponse,
  ChampionRankingPosition,
} from '@league-helper/shared';
import { computed } from 'vue';
import { buildChampionPath } from '~/utils/champion-links';
import {
  confidenceToneClass,
  formatChampionRate,
  positionDisplayLabel,
} from '~/utils/champion-metrics';

const props = defineProps<{
  response: ChampionMatchupsResponse | null;
  pending: boolean;
  error: string | null;
  position: ChampionRankingPosition;
  platform?: string | null;
  queue?: number | null;
  tier?: string | null;
  patch?: string | null;
  matchupInsights?: ChampionAiPublicInsight['matchupInsights'];
}>();

const positionLabel = computed(() => positionDisplayLabel(props.position));

const whyByOpponent = computed((): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const entry of props.matchupInsights ?? []) {
    map[entry.opponentChampionKey] = entry.text;
  }
  return map;
});

function opponentPath(championKey: string): string {
  return buildChampionPath(championKey, {
    platform: props.platform,
    queue: props.queue,
    tier: props.tier,
    position: props.position,
    patch: props.patch,
  });
}

function hideBrokenImage(event: Event): void {
  const image = event.target;
  if (image instanceof HTMLImageElement) {
    image.style.display = 'none';
  }
}
</script>
