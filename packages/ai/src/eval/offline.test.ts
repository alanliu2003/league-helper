import { describe, expect, it } from 'vitest';
import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionCoreBuild,
  ChampionMatchupRow,
} from '@league-helper/shared';
import { buildChampionInsightContext } from '../context/builder';
import type { ChampionInsightEvalFixture } from './fixture-schema';
import { assertFixtureExpectations, runOfflineEval } from './offline';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function highMetrics(): ChampionAggregateMetrics {
  return {
    sampleSize: 180,
    wins: 108,
    winRate: 0.6,
    wilsonInterval: { lowerBound: 0.53, upperBound: 0.67, confidenceLevel: 0.95 },
    sampleConfidence: 'HIGH',
    aggregateKdaRatio: 3.1,
    averageCsPerMinute: 7.4,
    averageDamagePerMinute: 580,
    averageVisionScorePerMinute: 1.1,
    averageGoldDifferenceAt10: 80,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
  };
}

function coreBuild(
  names: [string, string, string],
  sampleBand: ChampionCoreBuild['sampleBand'] = 'CREDIBLE',
): ChampionCoreBuild {
  return {
    items: [item(3001, names[0]), item(3002, names[1]), item(3003, names[2])],
    sampleSize: sampleBand === 'CREDIBLE' || sampleBand === 'STRONG' ? 40 : 6,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample: sampleBand === 'BELOW_DISPLAY' || sampleBand === 'EXPLORATORY',
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

function emptyBuilds() {
  return {
    coreBuilds: [] as ChampionCoreBuild[],
    startingItems: [],
    boots: [],
    runes: [],
    summonerSpells: [],
    skillOrder: [],
  };
}

function eligibleFixture(
  overrides: Partial<ChampionInsightEvalFixture> = {},
): ChampionInsightEvalFixture {
  return {
    id: 'test-eligible-high-sample',
    description: 'Injectable eligible fixture for offline eval tests',
    expectGenerationEligible: true,
    expectPerformanceConclusionsAllowed: true,
    expectBuildInsightAllowed: true,
    expectMatchupExplanationsAllowed: true,
    expectEvidenceContains: ['CHAMPION_WIN_RATE', 'BUILD_CORE_PRIMARY', 'MATCHUP_STRONG_Syndra'],
    input: {
      champion: { championId: 103, championKey: 'Ahri', name: 'Ahri', position: 'MIDDLE' },
      scope: { patch: '16.15', platform: 'na1', queueId: 420, tier: 'GOLD', kind: 'COLLECTED_SAMPLE' },
      stats: highMetrics(),
      builds: {
        ...emptyBuilds(),
        coreBuilds: [
          coreBuild(["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"]),
        ],
      },
      matchups: {
        strongAgainst: [matchup('Syndra', 'Syndra')],
        weakAgainst: [],
      },
      abilities: [ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.')],
    },
    ...overrides,
  };
}

function captureWriter() {
  const lines: string[] = [];
  return {
    lines,
    write(line: string) {
      lines.push(line);
    },
    text() {
      return lines.join('\n');
    },
  };
}

describe('offline eval harness', () => {
  it('passes injected fixtures whose expectations match the context builder', async () => {
    const capture = captureWriter();
    const result = await runOfflineEval({
      fixtures: [eligibleFixture()],
      write: capture.write,
    });

    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(1);
    expect(result.fixtures).toBe(1);
    expect(capture.text().toLowerCase()).toMatch(/pass/);
  });

  it('fails with the fixture id when an expectation does not match the builder', () => {
    const fixture = eligibleFixture({
      id: 'mutated-generation-flag',
      expectGenerationEligible: false,
    });
    const context = buildChampionInsightContext(fixture.input);

    expect(() => assertFixtureExpectations(fixture, context)).toThrow(/mutated-generation-flag/);
  });

  it('loads committed fixtures from disk and asserts every catalog expectation', async () => {
    const capture = captureWriter();
    const result = await runOfflineEval({ write: capture.write });

    expect(result.exitCode).toBe(0);
    expect(result.fixtures).toBeGreaterThanOrEqual(12);
    expect(result.passed).toBe(result.fixtures);
    expect(capture.text().toLowerCase()).toMatch(/pass/);
  });
});
