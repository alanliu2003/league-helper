<template>
  <article
    class="flex flex-col gap-3 rounded-lg border p-3 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-4"
    :class="highlighted ? 'ring-2 ring-[var(--lh-accent)]' : ''"
    style="border-color: var(--lh-border); background: var(--lh-surface-inset)"
    :aria-current="highlighted ? 'true' : undefined"
  >
    <div class="flex min-w-0 items-center gap-3">
      <NuxtLink
        v-if="participant.championKey"
        :to="`/champions/${encodeURIComponent(participant.championKey)}`"
        class="shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
      >
        <img
          v-if="participant.championIconUrl"
          :src="participant.championIconUrl"
          :alt="championLabel"
          width="40"
          height="40"
          class="h-10 w-10 rounded-md object-cover"
        />
        <span v-else class="sr-only">{{ championLabel }}</span>
      </NuxtLink>
      <img
        v-else-if="participant.championIconUrl"
        :src="participant.championIconUrl"
        :alt="championLabel"
        width="40"
        height="40"
        class="h-10 w-10 shrink-0 rounded-md object-cover"
      />

      <div class="min-w-0">
        <p class="flex flex-wrap items-center gap-2">
          <NuxtLink
            v-if="participant.playerId"
            :to="`/players/${encodeURIComponent(participant.playerId)}`"
            class="truncate font-medium text-[var(--lh-text)] hover:text-[var(--lh-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
          >
            {{ riotIdLabel }}
          </NuxtLink>
          <span v-else class="truncate font-medium">{{ riotIdLabel }}</span>
          <span v-if="highlighted" class="text-xs uppercase tracking-wide text-[var(--lh-accent)]">You</span>
        </p>
        <p class="text-xs text-[var(--lh-muted)]">{{ roleLabel }}</p>
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-2">
      <p class="text-sm">
        <span class="font-semibold tabular-nums">{{ kdaLabel }}</span>
        <span class="text-[var(--lh-muted)]"> KDA</span>
        <span class="mx-2 text-[var(--lh-muted)]">·</span>
        <span class="tabular-nums">{{ csLabel }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <ul class="flex flex-wrap gap-1" aria-label="Summoner spells and keystone">
          <li v-for="(spell, index) in participant.summonerSpells" :key="`spell-${index}`">
            <img
              v-if="spell?.iconUrl"
              :src="spell.iconUrl"
              :alt="spell.name"
              width="20"
              height="20"
              class="h-5 w-5 rounded-sm"
            />
            <span v-else-if="spell" class="text-xs text-[var(--lh-muted)]">{{ spell.name }}</span>
          </li>
          <li v-if="participant.keystone">
            <img
              v-if="participant.keystone.iconUrl"
              :src="participant.keystone.iconUrl"
              :alt="participant.keystone.name"
              width="20"
              height="20"
              class="h-5 w-5 rounded-sm"
            />
            <span v-else class="text-xs text-[var(--lh-muted)]">{{ participant.keystone.name }}</span>
          </li>
        </ul>
        <ul class="flex flex-wrap gap-1" aria-label="Items">
          <li v-for="item in participant.items" :key="item.slot">
            <img
              v-if="item.itemId > 0 && item.iconUrl"
              :src="item.iconUrl"
              :alt="item.name ?? `Item ${item.itemId}`"
              :title="item.name ?? `Item ${item.itemId}`"
              width="24"
              height="24"
              class="h-6 w-6 rounded-sm object-cover"
              :class="item.slot === 6 ? 'ring-1 ring-[var(--lh-border-strong)]' : ''"
            />
            <span
              v-else-if="item.itemId > 0"
              class="flex h-6 w-6 items-center justify-center rounded-sm text-[10px] text-[var(--lh-muted)]"
              :title="item.name ?? `Item ${item.itemId}`"
            >
              {{ item.name ?? item.itemId }}
            </span>
            <span
              v-else
              class="block h-6 w-6 rounded-sm"
              style="background: var(--lh-surface)"
              aria-label="Empty item slot"
            />
          </li>
        </ul>
      </div>
    </div>

    <dl class="grid grid-cols-3 gap-2 text-xs text-[var(--lh-muted)] lg:min-w-[10rem] lg:text-right">
      <div>
        <dt class="uppercase tracking-wide">Gold</dt>
        <dd class="tabular-nums text-[var(--lh-text)]">{{ participant.goldEarned.toLocaleString() }}</dd>
      </div>
      <div>
        <dt class="uppercase tracking-wide">Damage</dt>
        <dd class="tabular-nums text-[var(--lh-text)]">
          {{ participant.totalDamageDealtToChampions.toLocaleString() }}
          <span v-if="participant.damageShare != null">
            ({{ Math.round(participant.damageShare * 100) }}%)
          </span>
        </dd>
      </div>
      <div>
        <dt class="uppercase tracking-wide">Vision</dt>
        <dd class="tabular-nums text-[var(--lh-text)]">{{ participant.visionScore }}</dd>
      </div>
    </dl>

    <details class="lg:col-span-3">
      <summary
        class="cursor-pointer text-sm text-[var(--lh-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
      >
        More stats
      </summary>
      <dl class="mt-2 grid gap-1 text-sm text-[var(--lh-text-secondary)] sm:grid-cols-2">
        <div v-if="participant.killParticipation != null">
          <dt class="inline text-[var(--lh-muted)]">Kill participation</dt>
          <dd class="inline tabular-nums"> {{ Math.round(participant.killParticipation * 100) }}%</dd>
        </div>
        <div>
          <dt class="inline text-[var(--lh-muted)]">Damage taken</dt>
          <dd class="inline tabular-nums"> {{ participant.totalDamageTaken.toLocaleString() }}</dd>
        </div>
        <div>
          <dt class="inline text-[var(--lh-muted)]">Wards placed</dt>
          <dd class="inline tabular-nums"> {{ participant.wardsPlaced }}</dd>
        </div>
        <div>
          <dt class="inline text-[var(--lh-muted)]">Wards killed</dt>
          <dd class="inline tabular-nums"> {{ participant.wardsKilled }}</dd>
        </div>
        <div v-if="participant.controlWardsPurchased != null">
          <dt class="inline text-[var(--lh-muted)]">Control wards</dt>
          <dd class="inline tabular-nums"> {{ participant.controlWardsPurchased }}</dd>
        </div>
        <div v-for="metric in earlyMetrics" :key="metric.label">
          <dt class="inline text-[var(--lh-muted)]">{{ metric.label }}</dt>
          <dd class="inline tabular-nums"> {{ metric.value }}</dd>
        </div>
        <div v-if="participant.deathsBefore10 != null">
          <dt class="inline text-[var(--lh-muted)]">Deaths before 10</dt>
          <dd class="inline tabular-nums"> {{ participant.deathsBefore10 }}</dd>
        </div>
        <div v-if="participant.deathsBetween10And20 != null">
          <dt class="inline text-[var(--lh-muted)]">Deaths 10–20</dt>
          <dd class="inline tabular-nums"> {{ participant.deathsBetween10And20 }}</dd>
        </div>
        <div v-if="participant.statShards.length > 0">
          <dt class="text-[var(--lh-muted)]">Stat shards</dt>
          <dd>{{ participant.statShards.map((shard) => shard.name).join(', ') }}</dd>
        </div>
      </dl>
    </details>
  </article>
</template>

<script setup lang="ts">
import {
  formatRiotId,
  getNormalizedPositionLabel,
  type PublicMatchParticipant,
} from '@league-helper/shared';
import { computed } from 'vue';

const props = defineProps<{
  participant: PublicMatchParticipant;
  highlighted?: boolean;
}>();

const championLabel = computed(
  () => props.participant.championName ?? `Champion ${props.participant.championId}`,
);

const riotIdLabel = computed(() =>
  props.participant.riotId ? formatRiotId(props.participant.riotId) : 'Unknown player',
);

const roleLabel = computed(() => getNormalizedPositionLabel(props.participant.teamPosition));

const kdaLabel = computed(() => {
  const { kills, deaths, assists, kda } = props.participant;
  const ratio = kda == null ? '' : ` (${kda % 1 === 0 ? kda.toFixed(0) : kda.toFixed(2)})`;
  return `${kills}/${deaths}/${assists}${ratio}`;
});

const csLabel = computed(() => {
  if (props.participant.csPerMinute == null) {
    return `${props.participant.totalCs} CS`;
  }
  return `${props.participant.totalCs} CS (${props.participant.csPerMinute.toFixed(1)}/m)`;
});

const earlyMetrics = computed(() => {
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: number | null) => {
    if (value != null) {
      rows.push({ label, value: String(value) });
    }
  };
  add('Gold @10', props.participant.goldAt10);
  add('Gold @15', props.participant.goldAt15);
  add('CS @10', props.participant.csAt10);
  add('CS @15', props.participant.csAt15);
  add('XP @10', props.participant.xpAt10);
  add('XP @15', props.participant.xpAt15);
  add('Gold diff @10', props.participant.goldDifferenceAt10);
  add('Gold diff @15', props.participant.goldDifferenceAt15);
  add('CS diff @10', props.participant.csDifferenceAt10);
  add('CS diff @15', props.participant.csDifferenceAt15);
  add('XP diff @10', props.participant.xpDifferenceAt10);
  add('XP diff @15', props.participant.xpDifferenceAt15);
  return rows;
});
</script>
