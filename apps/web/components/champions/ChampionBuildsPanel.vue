<template>
  <div class="space-y-8" data-testid="champion-builds-panel">
    <div>
      <h2 id="builds-runes-heading" class="font-display text-xl">Builds &amp; Runes</h2>
      <p class="mt-1 text-sm text-[var(--lh-muted)]">
        Collected-sample item, rune, spell, and skill patterns. Not a recommendation engine.
      </p>
    </div>

    <p v-if="pending" class="text-sm text-[var(--lh-muted)]" role="status" aria-live="polite">
      Loading collected build data…
    </p>
    <PlayerErrorBanner v-else-if="error" :message="error" />

    <template v-else-if="response">
      <p
        v-if="response.emptyReason === 'UNKNOWN_RANK_HIDDEN'"
        class="text-sm text-[var(--lh-muted)]"
        role="status"
      >
        Build analytics are hidden for UNKNOWN rank until that aggregate debt is reconciled.
      </p>
      <p
        v-else-if="response.emptyReason === 'CHAMPION_HAS_NO_BUILDS'"
        class="text-sm text-[var(--lh-muted)]"
        role="status"
        data-testid="builds-empty"
      >
        Not enough current-patch source data for this champion and position.
      </p>

      <template v-else>
        <p
          v-if="showLowSampleBanner"
          class="rounded-md border px-3 py-2 text-sm text-[var(--lh-muted)]"
          style="border-color: var(--lh-border); background: var(--lh-surface)"
          role="status"
        >
          Sample depth is limited. Win rates below 5 games are omitted so a single game is never a
          recommendation.
        </p>

        <ChampionsChampionAiInsightPanel
          variant="builds"
          :response="insight ?? null"
          :pending="insightPending"
          :error="insightError"
        />

        <ChampionsChampionBuildSection
          heading-id="starting-items-heading"
          title="Starting items"
          :empty-text="
            emptySection(response.startingItems, 'No starting-item timeline data in this sample.')
          "
        >
          <li
            v-for="(row, index) in visibleRows(response.startingItems)"
            :key="`start-${index}`"
            class="lh-surface-raised flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex flex-wrap items-center gap-2">
              <img
                v-for="item in row.items"
                :key="`${item.id}-${item.name}`"
                :src="item.iconUrl ?? undefined"
                :alt="item.name"
                :title="item.name"
                width="36"
                height="36"
                class="h-9 w-9 rounded-md"
                @error="hideBrokenImage"
              />
            </div>
            <p class="text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatChampionRate(row.pickRate) }} pick · {{ row.sampleSize }}
              {{ row.sampleSize === 1 ? 'game' : 'games' }}
              <span v-if="row.lowSample" class="text-[var(--lh-muted)]"> · Limited sample</span>
            </p>
          </li>
        </ChampionsChampionBuildSection>

        <ChampionsChampionBuildSection
          heading-id="core-build-heading"
          title="Core build"
          description="First three completed major items, in completion order. Boots are listed separately."
          :empty-text="
            emptySection(
              completeCoreBuilds,
              'Not enough games reached a complete 3-item core build for this filter.',
            )
          "
        >
          <li
            v-for="(row, index) in visibleRows(completeCoreBuilds)"
            :key="`core-${index}`"
            class="lh-surface-raised flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex flex-wrap items-center gap-1 overflow-x-auto">
              <template v-for="(item, itemIndex) in row.items" :key="`${item.id}-${itemIndex}`">
                <span v-if="itemIndex > 0" class="px-1 text-[var(--lh-muted)]" aria-hidden="true"
                  >→</span
                >
                <img
                  :src="item.iconUrl ?? undefined"
                  :alt="item.name"
                  :title="item.name"
                  width="40"
                  height="40"
                  class="h-10 w-10 rounded-md"
                  @error="hideBrokenImage"
                />
              </template>
            </div>
            <p class="text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatChampionRate(row.pickRate) }} pick · {{ row.sampleSize }}
              {{ row.sampleSize === 1 ? 'game' : 'games' }}
              <span v-if="row.winRate !== null"> · {{ formatChampionRate(row.winRate) }} win</span>
              <span v-if="row.lowSample" class="text-[var(--lh-muted)]"> · Limited sample</span>
            </p>
          </li>
        </ChampionsChampionBuildSection>

        <ChampionsChampionBuildSection
          heading-id="boots-heading"
          title="Boots"
          :empty-text="emptySection(response.boots, 'No boots data in this sample.')"
        >
          <li
            v-for="(row, index) in visibleRows(response.boots)"
            :key="`boot-${index}`"
            class="lh-surface-raised flex min-w-0 items-center justify-between gap-3 p-3"
          >
            <div class="flex min-w-0 items-center gap-3">
              <img
                :src="row.item.iconUrl ?? undefined"
                :alt="row.item.name"
                width="36"
                height="36"
                class="h-9 w-9 rounded-md"
                @error="hideBrokenImage"
              />
              <span class="truncate text-sm">{{ row.item.name }}</span>
            </div>
            <p class="shrink-0 text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatChampionRate(row.pickRate) }} pick · {{ row.sampleSize }}
              {{ row.sampleSize === 1 ? 'game' : 'games' }}
            </p>
          </li>
        </ChampionsChampionBuildSection>

        <ChampionsChampionBuildSection
          heading-id="runes-heading"
          title="Runes"
          description="Only selections actually preserved in match source. Missing style trees are not invented."
          :empty-text="emptySection(response.runes, 'No rune selections in this sample.')"
        >
          <li
            v-for="(row, index) in visibleRows(response.runes)"
            :key="`rune-${index}`"
            class="lh-surface-raised space-y-2 p-3"
          >
            <p class="text-sm text-[var(--lh-text-secondary)]">
              <span v-if="row.stylesComplete">
                {{ row.primaryStyleName ?? 'Primary' }}
                +
                {{ row.secondaryStyleName ?? 'Secondary' }}
              </span>
              <span v-else>Perk selections (style trees not preserved)</span>
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <img
                v-for="perk in row.primaryPerks"
                :key="`p-${perk.id}`"
                :src="perk.iconUrl ?? undefined"
                :alt="perk.name"
                :title="perk.name"
                width="32"
                height="32"
                class="h-8 w-8 rounded-full"
                @error="hideBrokenImage"
              />
              <span class="text-[var(--lh-muted)]" aria-hidden="true">/</span>
              <img
                v-for="perk in row.secondaryPerks"
                :key="`s-${perk.id}`"
                :src="perk.iconUrl ?? undefined"
                :alt="perk.name"
                :title="perk.name"
                width="28"
                height="28"
                class="h-7 w-7 rounded-full"
                @error="hideBrokenImage"
              />
            </div>
            <p class="text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatChampionRate(row.pickRate) }} pick · {{ row.sampleSize }}
              {{ row.sampleSize === 1 ? 'game' : 'games' }}
              <span v-if="row.lowSample" class="text-[var(--lh-muted)]"> · Limited sample</span>
            </p>
          </li>
        </ChampionsChampionBuildSection>

        <ChampionsChampionBuildSection
          heading-id="spells-heading"
          title="Summoner spells"
          :empty-text="
            emptySection(response.summonerSpells, 'No summoner spell pairs in this sample.')
          "
        >
          <li
            v-for="(row, index) in visibleRows(response.summonerSpells)"
            :key="`spell-${index}`"
            class="lh-surface-raised flex min-w-0 items-center justify-between gap-3 p-3"
          >
            <div class="flex items-center gap-2">
              <img
                v-for="spell in row.spells"
                :key="spell.id"
                :src="spell.iconUrl ?? undefined"
                :alt="spell.name"
                :title="spell.name"
                width="36"
                height="36"
                class="h-9 w-9 rounded-md"
                @error="hideBrokenImage"
              />
            </div>
            <p class="text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatChampionRate(row.pickRate) }} pick · {{ row.sampleSize }}
              {{ row.sampleSize === 1 ? 'game' : 'games' }}
            </p>
          </li>
        </ChampionsChampionBuildSection>

        <ChampionsChampionBuildSection
          heading-id="skill-order-heading"
          title="Skill order"
          description="Most common basic ability leveling priority."
          :empty-text="emptySection(completeSkillOrder, 'No skill-order data in this sample.')"
        >
          <li
            v-for="(row, index) in visibleRows(completeSkillOrder)"
            :key="`skill-${index}`"
            class="lh-surface-raised flex min-w-0 flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p class="font-display text-lg tracking-wide">{{ row.maxOrder.join(' > ') }}</p>
              <p v-if="row.levelSequence.length > 0" class="text-xs text-[var(--lh-muted)]">
                Common leveling sequence {{ row.levelSequence.slice(0, 12).join(' ') }}
              </p>
            </div>
            <p class="text-sm tabular-nums text-[var(--lh-text-secondary)]">
              {{ formatChampionRate(row.pickRate) }} pick · {{ row.sampleSize }}
              {{ row.sampleSize === 1 ? 'game' : 'games' }}
              <span v-if="row.lowSample" class="text-[var(--lh-muted)]"> · Limited sample</span>
            </p>
          </li>
        </ChampionsChampionBuildSection>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import type {
  ChampionAiInsightsResponse,
  ChampionBuildRowMetrics,
  ChampionBuildsResponse,
  ChampionCoreBuild,
  ChampionSkillOrderRow,
} from '@league-helper/shared';
import { computed } from 'vue';
import { formatChampionRate } from '~/utils/champion-metrics';

const props = defineProps<{
  response: ChampionBuildsResponse | null;
  pending?: boolean;
  error?: string | null;
  insight?: ChampionAiInsightsResponse | null;
  insightPending?: boolean;
  insightError?: string | null;
}>();

const EXPLORATORY_MIN = 5;

const completeSkillOrder = computed((): ChampionSkillOrderRow[] =>
  (props.response?.skillOrder ?? []).filter((row) => row.maxOrder.length === 3),
);

const completeCoreBuilds = computed((): ChampionCoreBuild[] =>
  (props.response?.coreBuilds ?? []).filter((row) => row.items.length === 3),
);

const showLowSampleBanner = computed(() => {
  if (!props.response) {
    return false;
  }
  const rows = [
    ...props.response.startingItems,
    ...props.response.coreBuilds,
    ...props.response.boots,
    ...props.response.runes,
    ...props.response.summonerSpells,
    ...props.response.skillOrder,
  ];
  return rows.some((row) => row.lowSample) && rows.length > 0;
});

function visibleRows<T extends ChampionBuildRowMetrics>(rows: T[]): T[] {
  const credible = rows.filter((row) => row.sampleSize >= EXPLORATORY_MIN);
  return credible.length > 0 ? credible : rows;
}

function emptySection(rows: ChampionBuildRowMetrics[], message: string): string | null {
  return rows.length === 0 ? message : null;
}

function hideBrokenImage(event: Event): void {
  const image = event.target as HTMLImageElement;
  image.style.visibility = 'hidden';
}
</script>
