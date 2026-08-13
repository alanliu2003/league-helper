import { describe, expect, it } from 'vitest';
import type { ChampionBuildAggregate } from '@prisma/client';
import {
  mapBoots,
  mapCoreBuilds,
  mapRunes,
  mapSkillOrder,
  mapSpells,
  mapStartingSets,
  type BuildIconBuilders,
  type BuildStaticLookups,
} from './champion-builds.mapper';

function row(
  overrides: Partial<ChampionBuildAggregate> &
    Pick<ChampionBuildAggregate, 'category' | 'signature'>,
): ChampionBuildAggregate {
  return {
    id: overrides.id ?? overrides.signature,
    patch: '16.15',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    rankTier: 'ALL',
    teamPosition: 'MIDDLE',
    championId: 103,
    entityIds: [],
    auxIds: [],
    primaryStyleId: null,
    secondaryStyleId: null,
    sampleSize: 24,
    wins: 14,
    eligibleGames: 40,
    aggregationVersion: '1',
    latestEligibleMatchAt: null,
    calculatedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceNormalizationVersion: '1',
    ...overrides,
  };
}

const lookups: BuildStaticLookups = {
  dataDragonVersion: '16.15.1',
    items: new Map([
      [1056, { name: "Doran's Ring" }],
      [3006, { name: "Berserker's Greaves" }],
      [3116, { name: "Rylai's Crystal Scepter" }],
      [3089, { name: "Rabadon's Deathcap" }],
      [3135, { name: 'Void Staff' }],
    ]),
  runes: new Map([
    [
      8112,
      {
        name: 'Electrocute',
        icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
        treeId: 8100,
        treeName: 'Domination',
      },
    ],
  ]),
  spells: new Map([
    [4, { name: 'Flash', imageFull: 'SummonerFlash.png' }],
    [12, { name: 'Teleport', imageFull: 'SummonerTeleport.png' }],
  ]),
  styleNames: new Map([
    [8100, 'Domination'],
    [8200, 'Sorcery'],
  ]),
};

const icons: BuildIconBuilders = {
  itemIcon: (itemId, version) => `https://cdn.test/item/${version}/${itemId}.png`,
  runeIcon: (iconPath) => `https://cdn.test/${iconPath}`,
  spellIcon: (imageFull, version) => `https://cdn.test/spell/${version}/${imageFull}`,
};

describe('champion-builds mapper', () => {
  it('omits winRate below the exploratory sample floor', () => {
    const mapped = mapBoots(
      [row({ category: 'BOOTS', signature: '3006', entityIds: [3006], sampleSize: 3, wins: 3 })],
      lookups,
      icons,
    );
    expect(mapped[0]?.winRate).toBeNull();
    expect(mapped[0]?.lowSample).toBe(true);
    expect(mapped[0]?.item.iconUrl).toBe('https://cdn.test/item/16.15.1/3006.png');
  });

  it('maps starting items, core, runes, spells, and skill order with static identity', () => {
    expect(
      mapStartingSets(
        [row({ category: 'STARTING_ITEMS', signature: '1056', entityIds: [1056] })],
        lookups,
        icons,
      )[0]?.items[0],
    ).toMatchObject({ id: 1056, name: "Doran's Ring" });

    expect(
      mapCoreBuilds(
        [
          row({
            category: 'CORE_BUILD',
            signature: '3116>3089>3135',
            entityIds: [3116, 3089, 3135],
          }),
        ],
        lookups,
        icons,
      )[0]?.items.map((entry) => entry.id),
    ).toEqual([3116, 3089, 3135]);
    expect(
      mapCoreBuilds(
        [
          row({ category: 'CORE_BUILD', signature: '3116', entityIds: [3116] }),
          row({ category: 'CORE_BUILD', signature: '3116>3089', entityIds: [3116, 3089] }),
        ],
        lookups,
        icons,
      ),
    ).toEqual([]);

    const runes = mapRunes(
      [
        row({
          category: 'RUNES',
          signature: '8112',
          entityIds: [8112],
          primaryStyleId: 8100,
          secondaryStyleId: 8200,
        }),
      ],
      lookups,
      icons,
    );
    expect(runes[0]?.keystone?.name).toBe('Electrocute');
    expect(runes[0]?.stylesComplete).toBe(true);
    expect(runes[0]?.primaryStyleName).toBe('Domination');

    const spells = mapSpells(
      [row({ category: 'SUMMONER_SPELLS', signature: '4-12', entityIds: [4, 12] })],
      lookups,
      icons,
    );
    expect(spells[0]?.spells[0]?.name).toBe('Flash');
    expect(spells[0]?.spells[1]?.iconUrl).toContain('SummonerTeleport.png');

    const skills = mapSkillOrder(
      [row({ category: 'SKILL_PRIORITY', signature: 'Q>E>W', entityIds: [1, 3, 2] })],
      [row({ category: 'SKILL_SEQUENCE', signature: 'seq', entityIds: [1, 2, 3, 1] })],
    );
    expect(skills[0]?.maxOrder).toEqual(['Q', 'E', 'W']);
    expect(skills[0]?.levelSequence).toEqual(['Q', 'W', 'E', 'Q']);
  });

  it('does not treat first-learned E>W>Q as ability max priority', () => {
    const skills = mapSkillOrder(
      [row({ category: 'SKILL_PRIORITY', signature: 'W>E>Q', entityIds: [2, 3, 1] })],
      [row({ category: 'SKILL_SEQUENCE', signature: 'E-W-Q', entityIds: [3, 2, 1, 2, 2, 4] })],
    );
    expect(skills[0]?.maxOrder).toEqual(['W', 'E', 'Q']);
    expect(skills[0]?.levelSequence).toEqual(['E', 'W', 'Q', 'W', 'W', 'R']);
    expect(skills[0]?.maxOrder.join('>')).not.toBe('E>W>Q');
  });

  it('omits partial Q / Q>W priority rows from the product mapping', () => {
    const skills = mapSkillOrder(
      [
        row({ category: 'SKILL_PRIORITY', signature: 'Q', entityIds: [1] }),
        row({ category: 'SKILL_PRIORITY', signature: 'Q>W', entityIds: [1, 2] }),
        row({ category: 'SKILL_PRIORITY', signature: 'Q>W>E', entityIds: [1, 2, 3] }),
      ],
      [],
    );
    expect(skills).toHaveLength(1);
    expect(skills[0]?.maxOrder).toEqual(['Q', 'W', 'E']);
  });
});
