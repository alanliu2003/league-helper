import { classifyBuildSampleDisplay, pickRate, winRate } from '@league-helper/match-analytics';
import {
  type ChampionBootRow,
  type ChampionBuildStaticIdentity,
  type ChampionCoreBuild,
  type ChampionRuneSetup,
  type ChampionSkillKey,
  type ChampionSkillOrderRow,
  type ChampionSpellPair,
  type ChampionStartingItemSet,
} from '@league-helper/shared';
import type { ChampionBuildAggregate } from '@prisma/client';

export type BuildStaticLookups = {
  dataDragonVersion: string | null;
  items: Map<number, { name: string }>;
  runes: Map<
    number,
    { name: string; icon: string; treeId: number | null; treeName: string | null }
  >;
  spells: Map<number, { name: string; imageFull: string | null }>;
  styleNames: Map<number, string>;
};

export type BuildIconBuilders = {
  itemIcon: (itemId: number, version: string) => string | null;
  runeIcon: (iconPath: string) => string | null;
  spellIcon: (imageFull: string, version: string) => string | null;
};

function metrics(row: ChampionBuildAggregate) {
  const display = classifyBuildSampleDisplay(row.sampleSize);
  return {
    sampleSize: row.sampleSize,
    pickRate: pickRate({ sampleSize: row.sampleSize, eligibleGames: row.eligibleGames }),
    wins: row.wins,
    winRate: display.exposeWinRate ? winRate({ sampleSize: row.sampleSize, wins: row.wins }) : null,
    lowSample: display.lowSample,
    sampleBand: display.band,
  };
}

function itemIdentity(
  itemId: number,
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionBuildStaticIdentity {
  const version = lookups.dataDragonVersion ?? '';
  const name = lookups.items.get(itemId)?.name ?? `Item ${itemId}`;
  return {
    id: itemId,
    name,
    iconUrl: version ? icons.itemIcon(itemId, version) : null,
  };
}

function runeIdentity(
  runeId: number,
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionBuildStaticIdentity {
  const meta = lookups.runes.get(runeId);
  return {
    id: runeId,
    name: meta?.name ?? `Rune ${runeId}`,
    iconUrl: meta?.icon ? icons.runeIcon(meta.icon) : null,
  };
}

function spellIdentity(
  spellId: number,
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionBuildStaticIdentity {
  const meta = lookups.spells.get(spellId);
  const version = lookups.dataDragonVersion ?? '';
  return {
    id: spellId,
    name: meta?.name ?? `Spell ${spellId}`,
    iconUrl: meta?.imageFull && version ? icons.spellIcon(meta.imageFull, version) : null,
  };
}

export function mapStartingSets(
  rows: ChampionBuildAggregate[],
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionStartingItemSet[] {
  return rows.map((row) => ({
    ...metrics(row),
    items: row.entityIds.map((id) => itemIdentity(id, lookups, icons)),
  }));
}

export function mapCoreBuilds(
  rows: ChampionBuildAggregate[],
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionCoreBuild[] {
  return rows.flatMap((row) => {
    if (row.entityIds.length !== 3 || row.entityIds.some((id) => id <= 0)) {
      return [];
    }
    return [
      {
        ...metrics(row),
        items: [
          itemIdentity(row.entityIds[0]!, lookups, icons),
          itemIdentity(row.entityIds[1]!, lookups, icons),
          itemIdentity(row.entityIds[2]!, lookups, icons),
        ],
      },
    ];
  });
}

export function mapBoots(
  rows: ChampionBuildAggregate[],
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionBootRow[] {
  return rows.flatMap((row) => {
    const itemId = row.entityIds[0];
    if (!itemId) {
      return [];
    }
    return [{ ...metrics(row), item: itemIdentity(itemId, lookups, icons) }];
  });
}

export function mapRunes(
  rows: ChampionBuildAggregate[],
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionRuneSetup[] {
  return rows.map((row) => {
    const primary = row.entityIds.slice(0, 4);
    const secondary = row.entityIds.slice(4);
    const stylesComplete = row.primaryStyleId !== null && row.secondaryStyleId !== null;
    return {
      ...metrics(row),
      keystone: primary[0] ? runeIdentity(primary[0], lookups, icons) : null,
      primaryPerks: primary.map((id) => runeIdentity(id, lookups, icons)),
      secondaryPerks: secondary.map((id) => runeIdentity(id, lookups, icons)),
      statShards: row.auxIds.map((id) => runeIdentity(id, lookups, icons)),
      primaryStyleName: row.primaryStyleId
        ? (lookups.styleNames.get(row.primaryStyleId) ?? null)
        : null,
      secondaryStyleName: row.secondaryStyleId
        ? (lookups.styleNames.get(row.secondaryStyleId) ?? null)
        : null,
      stylesComplete,
    };
  });
}

export function mapSpells(
  rows: ChampionBuildAggregate[],
  lookups: BuildStaticLookups,
  icons: BuildIconBuilders,
): ChampionSpellPair[] {
  return rows.flatMap((row) => {
    const left = row.entityIds[0];
    const right = row.entityIds[1];
    if (!left || !right) {
      return [];
    }
    return [
      {
        ...metrics(row),
        spells: [spellIdentity(left, lookups, icons), spellIdentity(right, lookups, icons)],
      },
    ];
  });
}

const SLOT_KEY: Record<number, ChampionSkillKey> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };

export function mapSkillOrder(
  maxOrderRows: ChampionBuildAggregate[],
  levelSequenceRows: ChampionBuildAggregate[],
): ChampionSkillOrderRow[] {
  const topLevelSequence =
    levelSequenceRows[0]?.entityIds
      .map((slot) => SLOT_KEY[slot])
      .filter((key): key is ChampionSkillKey => key !== undefined) ?? [];

  let attachedSequence = false;
  return maxOrderRows.flatMap((row) => {
    const maxOrder = row.entityIds
      .map((slot) => (slot === 1 ? 'Q' : slot === 2 ? 'W' : slot === 3 ? 'E' : null))
      .filter((key): key is 'Q' | 'W' | 'E' => key !== null);
    if (maxOrder.length !== 3) {
      return [];
    }
    const levelSequence = attachedSequence ? [] : topLevelSequence;
    attachedSequence = true;
    return [
      {
        ...metrics(row),
        maxOrder,
        levelSequence,
      },
    ];
  });
}

export function eligibleGamesFor(rows: ChampionBuildAggregate[]): number {
  return rows[0]?.eligibleGames ?? 0;
}
