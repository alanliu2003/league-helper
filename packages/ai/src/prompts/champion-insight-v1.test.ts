import { describe, expect, it } from 'vitest';
import { CHAMPION_AI_PROMPT_VERSION as SHARED_PROMPT_VERSION } from '@league-helper/shared';
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
} from '@league-helper/shared';
import { buildChampionInsightContext } from '../context/builder';
import type { ChampionInsightContextInput } from '../context/types';
import {
  CHAMPION_AI_PROMPT_VERSION,
  buildChampionInsightSystemPrompt,
  buildChampionInsightUserPrompt,
} from './champion-insight-v1';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function metrics(): ChampionAggregateMetrics {
  return {
    sampleSize: 120,
    wins: 61,
    winRate: 0.512,
    wilsonInterval: {
      lowerBound: 0.42,
      upperBound: 0.6,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'HIGH',
    aggregateKdaRatio: 3.2,
    averageCsPerMinute: 8.4,
    averageDamagePerMinute: 580,
    averageVisionScorePerMinute: 1.1,
    averageGoldDifferenceAt10: 212,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
  };
}

function coreBuild(names: [string, string, string]): ChampionCoreBuild {
  return {
    items: [item(3001, names[0]), item(3002, names[1]), item(3003, names[2])],
    sampleSize: 40,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function startingSet(): ChampionStartingItemSet {
  return {
    items: [item(1056, "Doran's Ring"), item(2003, 'Health Potion')],
    sampleSize: 30,
    pickRate: 0.4,
    wins: 16,
    winRate: 0.53,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function bootRow(): ChampionBootRow {
  return {
    item: item(3020, "Sorcerer's Shoes"),
    sampleSize: 30,
    pickRate: 0.6,
    wins: 18,
    winRate: 0.6,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function runePage(): ChampionRuneSetup {
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
    sampleBand: 'CREDIBLE',
  };
}

function spellPair(): ChampionSpellPair {
  return {
    spells: [item(4, 'Flash'), item(14, 'Ignite')],
    sampleSize: 40,
    pickRate: 0.7,
    wins: 22,
    winRate: 0.55,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function skillOrder(): ChampionSkillOrderRow {
  return {
    maxOrder: ['Q', 'W', 'E'],
    levelSequence: ['Q', 'W', 'E', 'Q', 'Q', 'R'],
    sampleSize: 25,
    pickRate: 0.8,
    wins: 14,
    winRate: 0.56,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function matchup(championKey: string, name: string): ChampionMatchupRow {
  return {
    opponent: {
      championId: 134,
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

function performanceInput(
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
        coreBuild(["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"]),
      ],
      startingItems: [startingSet()],
      boots: [bootRow()],
      runes: [runePage()],
      summonerSpells: [spellPair()],
      skillOrder: [skillOrder()],
    },
    matchups: {
      strongAgainst: [matchup('Syndra', 'Syndra')],
      weakAgainst: [],
    },
    abilities: [
      ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.'),
    ],
    ...overrides,
  };
}

describe('champion insight prompts', () => {
  const context = buildChampionInsightContext(performanceInput());

  it('re-exports the shared prompt version', () => {
    expect(CHAMPION_AI_PROMPT_VERSION).toBe(SHARED_PROMPT_VERSION);
    expect(CHAMPION_AI_PROMPT_VERSION).toBe('champion-insight-v1.3');
  });

  it('includes locked qualitative and evidence rules and does not contain API keys', () => {
    const system = buildChampionInsightSystemPrompt();
    expect(system).toContain('Never invent');
    expect(system).toContain('qualitative');
    expect(system).toContain('outputPolicy');
    expect(system).toContain('IMPORTANT NUMERIC RULE');
    expect(system).toContain('percentages');
    expect(system).toContain('timing-window numbers');
    expect(system).toContain('Do not restate analytics timing windows using digits');
    expect(system).toContain('at 10 minutes');
    expect(system).toContain('early-game checkpoints');
    expect(system).toContain('platform identity label');
    expect(system).toContain('may help explain');
    expect(system).toContain('could contribute to');
    expect(system).toContain('observed statistical support');
    expect(system).toContain('magic penetration');
    expect(system).toContain('kind is "statistical"');
    expect(system).toContain('Do not write evidence handles in text fields');
    expect(system).toContain('buildInsight MUST be null');
    expect(system).toContain('matchupInsights MUST be []');
    expect(system).not.toMatch(/sk-[A-Za-z0-9]|api[_-]?key|Bearer /i);
    expect(system).not.toContain('temperature');
  });

  it('includes evidence handles and omits canonical ids and icon URLs from the user prompt', () => {
    const user = buildChampionInsightUserPrompt(context);
    expect(user).toContain('E1');
    expect(user).toContain('Citable evidence handles');
    expect(user).toContain('outputPolicy');
    expect(user).toContain('evidenceHandle');
    expect(user).toContain('kind: statistical');
    expect(user).toContain('Do not copy those digits');
    expect(user).not.toContain('interpretationAllowed');
    expect(user).not.toContain('CHAMPION_WIN_RATE');
    expect(user).not.toContain('BUILD_CORE_PRIMARY');
    expect(user).not.toContain('MATCHUP_STRONG_Syndra');
    expect(user).not.toContain('iconUrl');
    expect(user).not.toContain('https://example.com/');
    expect(user).not.toContain('temperature');
  });

  it('forbids causal matchup wording and invented item mechanics in the system prompt', () => {
    const system = buildChampionInsightSystemPrompt();
    expect(system).toContain('Do not claim that an ability causes, leads to, or is why the matchup is favorable');
    expect(system).toContain('This item gives Ahri more sustain.');
    expect(system).toContain('the data does not justify treating one as universally superior');
  });

  it('requires matchupInsights to be empty when no matchup candidates are eligible', () => {
    const context = buildChampionInsightContext(
      performanceInput({
        matchups: { strongAgainst: [], weakAgainst: [] },
        builds: {
          coreBuilds: [],
          startingItems: [],
          boots: [],
          runes: [],
          summonerSpells: [],
          skillOrder: [],
        },
      }),
    );
    const user = buildChampionInsightUserPrompt(context);
    expect(user).toContain('allowedMatchupOpponentKeys=[]');
    expect(user).toContain('matchupInsights MUST be []');
  });

  it('requires buildInsight to be null when no build slice is eligible', () => {
    const context = buildChampionInsightContext(
      performanceInput({
        builds: {
          coreBuilds: [
            {
              items: [
                { id: 3001, name: "Rylai's Crystal Scepter", iconUrl: 'https://example.com/item.png' },
                { id: 3002, name: "Liandry's Torment", iconUrl: 'https://example.com/item.png' },
                { id: 3003, name: "Zhonya's Hourglass", iconUrl: 'https://example.com/item.png' },
              ],
              sampleSize: 6,
              pickRate: 0.22,
              wins: 3,
              winRate: 0.5,
              lowSample: true,
              sampleBand: 'EXPLORATORY',
            },
          ],
          startingItems: [],
          boots: [],
          runes: [],
          summonerSpells: [],
          skillOrder: [],
        },
        matchups: { strongAgainst: [], weakAgainst: [] },
      }),
    );
    expect(context.buildInsightAllowed).toBe(false);
    const user = buildChampionInsightUserPrompt(context);
    expect(user).toContain('buildInsightAllowed=false');
    expect(user).toContain('buildInsight MUST be null');
  });
});
