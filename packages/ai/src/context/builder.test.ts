import { describe, expect, it } from 'vitest';
import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionBootRow,
  ChampionCoreBuild,
  ChampionMatchupRow,
  ChampionRuneSetup,
  ChampionSkillOrderRow,
  ChampionSpellPair,
  ChampionStartingItemSet,
  SampleConfidence,
} from '@league-helper/shared';
import { buildChampionInsightContext, listEvidenceIds } from './builder';
import type { ChampionInsightContext, ChampionInsightContextInput } from './types';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function metrics(
  overrides: Partial<ChampionAggregateMetrics> = {},
): ChampionAggregateMetrics {
  return {
    sampleSize: 120,
    wins: 65,
    winRate: 0.5417,
    wilsonInterval: {
      lowerBound: 0.45,
      upperBound: 0.63,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'MEDIUM',
    aggregateKdaRatio: 3.1,
    averageCsPerMinute: 7.4,
    averageDamagePerMinute: 580,
    averageVisionScorePerMinute: 1.1,
    averageGoldDifferenceAt10: 80,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function coreBuild(
  names: [string, string, string],
  sampleBand: ChampionCoreBuild['sampleBand'],
  overrides: Partial<ChampionCoreBuild> = {},
): ChampionCoreBuild {
  const lowSample = sampleBand === 'BELOW_DISPLAY' || sampleBand === 'EXPLORATORY';
  return {
    items: [item(3001, names[0]), item(3002, names[1]), item(3003, names[2])],
    sampleSize: sampleBand === 'BELOW_DISPLAY' ? 2 : sampleBand === 'EXPLORATORY' ? 6 : 40,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample,
    sampleBand,
    ...overrides,
  };
}

function startingSet(
  names: string[],
  sampleBand: ChampionStartingItemSet['sampleBand'] = 'CREDIBLE',
): ChampionStartingItemSet {
  return {
    items: names.map((name, index) => item(1000 + index, name)),
    sampleSize: 30,
    pickRate: 0.4,
    wins: 16,
    winRate: 0.53,
    lowSample: false,
    sampleBand,
  };
}

function bootRow(name: string, sampleBand: ChampionBootRow['sampleBand'] = 'CREDIBLE'): ChampionBootRow {
  return {
    item: item(3111, name),
    sampleSize: 30,
    pickRate: 0.6,
    wins: 18,
    winRate: 0.6,
    lowSample: false,
    sampleBand,
  };
}

function runePage(sampleBand: ChampionRuneSetup['sampleBand'] = 'CREDIBLE'): ChampionRuneSetup {
  return {
    keystone: item(8010, 'Conqueror'),
    primaryPerks: [item(9101, 'Absorb Life')],
    secondaryPerks: [item(8226, 'Manaflow Band')],
    statShards: [item(5008, 'Adaptive Force')],
    primaryStyleName: 'Precision',
    secondaryStyleName: 'Sorcery',
    stylesComplete: true,
    sampleSize: 28,
    pickRate: 0.55,
    wins: 16,
    winRate: 0.57,
    lowSample: false,
    sampleBand,
  };
}

function spellPair(sampleBand: ChampionSpellPair['sampleBand'] = 'CREDIBLE'): ChampionSpellPair {
  return {
    spells: [item(4, 'Flash'), item(14, 'Ignite')],
    sampleSize: 40,
    pickRate: 0.7,
    wins: 22,
    winRate: 0.55,
    lowSample: false,
    sampleBand,
  };
}

function skillOrder(sampleBand: ChampionSkillOrderRow['sampleBand'] = 'CREDIBLE'): ChampionSkillOrderRow {
  return {
    maxOrder: ['Q', 'W', 'E'],
    levelSequence: ['Q', 'W', 'E', 'Q', 'Q', 'R'],
    sampleSize: 25,
    pickRate: 0.8,
    wins: 14,
    winRate: 0.56,
    lowSample: false,
    sampleBand,
  };
}

function matchup(
  championKey: string,
  name: string,
  overrides: Partial<Omit<ChampionMatchupRow, 'opponent'>> & { championId?: number } = {},
): ChampionMatchupRow {
  const { championId, ...row } = overrides;
  return {
    opponent: {
      championId: championId ?? 134,
      championKey,
      name,
      iconUrl: 'https://example.com/champ.png',
    },
    position: 'MIDDLE',
    sampleSize: 40,
    wins: 24,
    losses: 16,
    winRate: 0.6,
    wilsonInterval: { lowerBound: 0.44, upperBound: 0.74, confidenceLevel: 0.95 },
    sampleConfidence: 'MEDIUM',
    lowSample: false,
    averageGoldDifferenceAt10: 50,
    averageGoldDifferenceAt15: 90,
    averageCsDifferenceAt10: 2,
    averageCsDifferenceAt15: 4,
    ...row,
  };
}

function ability(
  slot: ChampionAbilitySummary['slot'],
  name: string,
  description: string,
): ChampionAbilitySummary {
  return {
    slot,
    name,
    description,
    iconUrl: 'https://example.com/ability.png',
    cooldown: '12/11/10',
    cost: '70/75/80',
    range: '900',
  };
}

const AHRI_ABILITIES: ChampionAbilitySummary[] = [
  ability('PASSIVE', 'Essence Theft', 'Ahri heals when she hits champions with her abilities.'),
  ability('Q', 'Orb of Deception', 'Ahri sends out and pulls back her orb, dealing magic then true damage.'),
  ability('W', 'Fox-Fire', 'Ahri releases fox-fires that lock onto nearby enemies.'),
  ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.'),
  ability('R', 'Spirit Rush', 'Ahri dashes and fires essence bolts at nearby enemies.'),
];

function emptyBuilds(): ChampionInsightContextInput['builds'] {
  return {
    coreBuilds: [],
    startingItems: [],
    boots: [],
    runes: [],
    summonerSpells: [],
    skillOrder: [],
  };
}

function baseInput(
  overrides: Partial<ChampionInsightContextInput> = {},
): ChampionInsightContextInput {
  return {
    champion: {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      position: 'MIDDLE',
    },
    scope: {
      patch: '16.15',
      platform: 'na1',
      queueId: 420,
      tier: 'GOLD',
      kind: 'COLLECTED_SAMPLE',
    },
    stats: metrics(),
    builds: {
      coreBuilds: [
        coreBuild(["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"], 'CREDIBLE'),
      ],
      startingItems: [startingSet(['Doran\'s Ring', 'Health Potion'])],
      boots: [bootRow('Sorcerer\'s Shoes')],
      runes: [runePage()],
      summonerSpells: [spellPair()],
      skillOrder: [skillOrder()],
    },
    matchups: {
      strongAgainst: [matchup('Syndra', 'Syndra', { championId: 134 })],
      weakAgainst: [matchup('Yasuo', 'Yasuo', { championId: 157, wins: 14, losses: 26, winRate: 0.35 })],
    },
    abilities: AHRI_ABILITIES,
    opponentAbilities: [
      {
        championKey: 'Syndra',
        abilities: [ability('E', 'Scatter the Weak', 'Syndra knocks enemies away and stuns those hitting a dark sphere.')],
      },
    ],
    ...overrides,
  };
}

function catalogEntry(context: ChampionInsightContext, id: string) {
  return context.evidenceCatalog.find((entry) => entry.id === id);
}

describe('buildChampionInsightContext', () => {
  it('copies sampleSize, wins, winRate, and sampleConfidence without inventing pick or ban rate', () => {
    const context = buildChampionInsightContext(baseInput());

    expect(context.performance.sampleSize).toBe(120);
    expect(context.performance.wins).toBe(65);
    expect(context.performance.winRate).toBe(0.5417);
    expect(context.performance.sampleConfidence).toBe('MEDIUM');
    expect(context.performance).not.toHaveProperty('pickRate');
    expect(context.performance).not.toHaveProperty('banRate');
    expect(JSON.stringify(context)).not.toContain('banRate');
  });

  it('omits iconUrl and splash from context', () => {
    const context = buildChampionInsightContext(baseInput());
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('iconUrl');
    expect(serialized).not.toContain('splashUrl');
    expect(serialized).not.toContain('https://example.com');
  });

  it('omits BELOW_DISPLAY core builds', () => {
    const context = buildChampionInsightContext(
      baseInput({
        builds: {
          ...emptyBuilds(),
          coreBuilds: [
            coreBuild(['Hidden A', 'Hidden B', 'Hidden C'], 'BELOW_DISPLAY'),
            coreBuild(["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"], 'CREDIBLE'),
          ],
        },
      }),
    );

    expect(context.builds.coreBuilds).toHaveLength(1);
    expect(context.builds.coreBuilds[0]?.name).toBe(
      "Rylai's Crystal Scepter / Liandry's Torment / Zhonya's Hourglass",
    );
    expect(context.builds.coreBuilds[0]?.sampleBand).toBe('CREDIBLE');
  });

  it('marks EXPLORATORY builds and lowSample matchups as interpretationAllowed false', () => {
    const context = buildChampionInsightContext(
      baseInput({
        builds: {
          ...emptyBuilds(),
          coreBuilds: [coreBuild(['Exploratory A', 'Exploratory B', 'Exploratory C'], 'EXPLORATORY')],
        },
        matchups: {
          strongAgainst: [
            matchup('Neeko', 'Neeko', {
              championId: 518,
              lowSample: true,
              sampleConfidence: 'INSUFFICIENT' as SampleConfidence,
              sampleSize: 6,
            }),
          ],
          weakAgainst: [],
        },
      }),
    );

    expect(context.builds.coreBuilds[0]?.sampleBand).toBe('EXPLORATORY');
    expect(context.builds.coreBuilds[0]?.interpretationAllowed).toBe(false);
    expect(context.matchups.strongAgainst[0]?.lowSample).toBe(true);
    expect(context.matchups.strongAgainst[0]?.interpretationAllowed).toBe(false);
    expect(catalogEntry(context, 'BUILD_CORE_PRIMARY')?.interpretationAllowed).toBe(false);
    expect(catalogEntry(context, 'MATCHUP_STRONG_Neeko')?.interpretationAllowed).toBe(false);
  });

  it('is not generation eligible when stats are INSUFFICIENT and no allowed build or matchup exists', () => {
    const context = buildChampionInsightContext(
      baseInput({
        stats: metrics({ sampleConfidence: 'INSUFFICIENT', sampleSize: 8, wins: 3, winRate: 0.375 }),
        builds: {
          ...emptyBuilds(),
          coreBuilds: [coreBuild(['Thin A', 'Thin B', 'Thin C'], 'EXPLORATORY')],
        },
        matchups: {
          strongAgainst: [
            matchup('Neeko', 'Neeko', {
              championId: 518,
              lowSample: true,
              sampleSize: 4,
              sampleConfidence: 'INSUFFICIENT',
            }),
          ],
          weakAgainst: [],
        },
      }),
    );

    expect(context.performance.interpretationAllowed).toBe(false);
    expect(context.performanceConclusionsAllowed).toBe(false);
    expect(context.buildInsightAllowed).toBe(false);
    expect(context.matchupExplanationsAllowed).toBe(false);
    expect(context.generationEligible).toBe(false);
  });

  it('allows partial eligibility for an INSUFFICIENT sample with one CREDIBLE core', () => {
    const context = buildChampionInsightContext(
      baseInput({
        stats: metrics({ sampleConfidence: 'INSUFFICIENT', sampleSize: 8, wins: 3, winRate: 0.375 }),
        builds: {
          ...emptyBuilds(),
          coreBuilds: [
            coreBuild(["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"], 'CREDIBLE'),
          ],
        },
        matchups: { strongAgainst: [], weakAgainst: [] },
        opponentAbilities: [],
      }),
    );

    expect(context.generationEligible).toBe(true);
    expect(context.performanceConclusionsAllowed).toBe(false);
    expect(context.buildInsightAllowed).toBe(true);
    expect(context.matchupExplanationsAllowed).toBe(false);
    expect(catalogEntry(context, 'CHAMPION_WIN_RATE')?.interpretationAllowed).toBe(false);
    expect(catalogEntry(context, 'BUILD_CORE_PRIMARY')?.interpretationAllowed).toBe(true);
  });

  it('includes stable evidence ids for performance, builds, matchups, and abilities', () => {
    const context = buildChampionInsightContext(baseInput());
    const ids = listEvidenceIds(context);

    expect(ids).toEqual(expect.arrayContaining([
      'CHAMPION_WIN_RATE',
      'BUILD_CORE_PRIMARY',
      'MATCHUP_STRONG_Syndra',
      'ABILITY_Ahri_E',
    ]));
    expect(catalogEntry(context, 'SCOPE_PATCH')?.interpretationAllowed).toBe(true);
    expect(catalogEntry(context, 'SCOPE_POSITION')?.interpretationAllowed).toBe(true);
    expect(catalogEntry(context, 'SCOPE_RANK')?.interpretationAllowed).toBe(true);
    expect(catalogEntry(context, 'CONFIDENCE_WARNING')?.interpretationAllowed).toBe(true);
    expect(catalogEntry(context, 'ABILITY_Ahri_E')?.interpretationAllowed).toBe(true);
  });

  it('caps matchups at 3 strong + 3 weak and cores at 2 after omitting BELOW_DISPLAY', () => {
    const context = buildChampionInsightContext(
      baseInput({
        builds: {
          ...emptyBuilds(),
          coreBuilds: [
            coreBuild(['Skip A', 'Skip B', 'Skip C'], 'BELOW_DISPLAY'),
            coreBuild(['Core One A', 'Core One B', 'Core One C'], 'CREDIBLE'),
            coreBuild(['Core Two A', 'Core Two B', 'Core Two C'], 'STRONG'),
            coreBuild(['Core Three A', 'Core Three B', 'Core Three C'], 'CREDIBLE'),
          ],
        },
        matchups: {
          strongAgainst: [
            matchup('Syndra', 'Syndra', { championId: 134 }),
            matchup('Orianna', 'Orianna', { championId: 61 }),
            matchup('Lux', 'Lux', { championId: 99 }),
            matchup('Ziggs', 'Ziggs', { championId: 115 }),
          ],
          weakAgainst: [
            matchup('Yasuo', 'Yasuo', { championId: 157 }),
            matchup('Zed', 'Zed', { championId: 238 }),
            matchup('Fizz', 'Fizz', { championId: 105 }),
            matchup('Talon', 'Talon', { championId: 91 }),
          ],
        },
      }),
    );

    expect(context.builds.coreBuilds).toHaveLength(2);
    expect(context.builds.coreBuilds.map((row) => row.name)).toEqual([
      'Core One A / Core One B / Core One C',
      'Core Two A / Core Two B / Core Two C',
    ]);
    expect(context.matchups.strongAgainst).toHaveLength(3);
    expect(context.matchups.strongAgainst.map((row) => row.opponentChampionKey)).toEqual([
      'Syndra',
      'Orianna',
      'Lux',
    ]);
    expect(context.matchups.weakAgainst).toHaveLength(3);
    expect(context.matchups.weakAgainst.map((row) => row.opponentChampionKey)).toEqual([
      'Yasuo',
      'Zed',
      'Fizz',
    ]);
  });

  it('truncates ability descriptions to 400 characters and keeps cooldown, cost, and range', () => {
    const longDescription = 'Charm stuns the first enemy hit. '.repeat(30);
    expect(longDescription.length).toBeGreaterThan(400);

    const context = buildChampionInsightContext(
      baseInput({
        abilities: [
          ...AHRI_ABILITIES.filter((entry) => entry.slot !== 'E'),
          ability('E', 'Charm', longDescription),
        ],
      }),
    );

    const charm = context.abilities.find((entry) => entry.slot === 'E');
    expect(charm?.description).toHaveLength(400);
    expect(charm?.cooldown).toBe('12/11/10');
    expect(charm?.cost).toBe('70/75/80');
    expect(charm?.range).toBe('900');
    expect(charm).not.toHaveProperty('iconUrl');
  });
});
