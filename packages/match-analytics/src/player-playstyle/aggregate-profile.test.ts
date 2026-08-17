import { describe, expect, it } from 'vitest';
import {
  PlayerMetricComparisonSchema,
  type PlayerMetricComparison,
  type PlayerPlaystyleMetricId,
} from '@league-helper/shared';
import { computeAggregateKdaRatio } from '../champion/aggregate-derivations';
import { buildPlayerPlaystyleProfile } from './aggregate-profile';
import type {
  BaselineLookupResult,
  PlayerPlaystyleBaselineMetrics,
  PlayerPlaystyleMatchInput,
} from './metrics';

const OVERALL_METRIC_ORDER: PlayerPlaystyleMetricId[] = [
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'DAMAGE_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
];

const SLICE_METRIC_ORDER: PlayerPlaystyleMetricId[] = [
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'KDA',
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'DAMAGE_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
];

function match(
  overrides: Partial<PlayerPlaystyleMatchInput> & Pick<PlayerPlaystyleMatchInput, 'matchId'>,
): PlayerPlaystyleMatchInput {
  return {
    participantId: 1,
    championId: 103,
    championKey: 'Ahri',
    championName: 'Ahri',
    position: 'MIDDLE',
    patch: '16.14',
    platformRoute: 'NA1',
    queueId: 420,
    win: true,
    kills: 5,
    deaths: 3,
    assists: 7,
    totalCs: 180,
    goldEarned: 12_000,
    damageToChampions: 18_000,
    visionScore: 30,
    timePlayedSeconds: 1800,
    gameDurationSeconds: 1800,
    goldDifferenceAt10: 200,
    goldDifferenceAt15: 400,
    csDifferenceAt10: 5,
    csDifferenceAt15: 10,
    rankTier: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    gameCreation: Date.parse('2026-08-10T00:00:00.000Z'),
    ...overrides,
  };
}

function baselineMetrics(
  overrides: Partial<PlayerPlaystyleBaselineMetrics> = {},
): PlayerPlaystyleBaselineMetrics {
  return {
    sampleSize: 800,
    sampleConfidence: 'HIGH',
    aggregateKdaRatio: 3,
    averageKillsPerGame: 5,
    averageDeathsPerGame: 4,
    averageAssistsPerGame: 6,
    averageCsPerMinute: 7,
    averageGoldPerMinute: 400,
    averageDamagePerMinute: 600,
    averageVisionScorePerMinute: 1,
    averageGoldDifferenceAt10: 0,
    averageGoldDifferenceAt15: 0,
    averageCsDifferenceAt10: 0,
    averageCsDifferenceAt15: 0,
    ...overrides,
  };
}

function lookup(
  metrics: Partial<PlayerPlaystyleBaselineMetrics> = {},
  extra: Partial<Exclude<BaselineLookupResult, null>> = {},
): Exclude<BaselineLookupResult, null> {
  return {
    metrics: baselineMetrics(metrics),
    rankTier: extra.rankTier ?? 'GOLD',
    usedAllTierFallback: extra.usedAllTierFallback ?? false,
  };
}

function baselinesFor(
  matches: readonly PlayerPlaystyleMatchInput[],
  result: BaselineLookupResult | ((match: PlayerPlaystyleMatchInput) => BaselineLookupResult),
): Record<string, BaselineLookupResult> {
  return Object.fromEntries(
    matches.map((row) => [row.matchId, typeof result === 'function' ? result(row) : result]),
  );
}

function findComparison(
  comparisons: readonly PlayerMetricComparison[],
  metric: PlayerPlaystyleMetricId,
): PlayerMetricComparison {
  const row = comparisons.find((comparison) => comparison.metric === metric);
  expect(row).toBeDefined();
  return row as PlayerMetricComparison;
}

function assertValidComparisons(comparisons: readonly PlayerMetricComparison[]): void {
  for (const comparison of comparisons) {
    expect(PlayerMetricComparisonSchema.parse(comparison)).toEqual(comparison);
  }
}

function csForRate(csPerMinute: number, seconds = 1800): number {
  return csPerMinute * (seconds / 60);
}

describe('buildPlayerPlaystyleProfile', () => {
  it('does not raw-average mixed-champion CS/min on overall', () => {
    const matches = [
      match({
        matchId: 'ahri',
        totalCs: csForRate(10),
        championKey: 'Ahri',
        championName: 'Ahri',
        championId: 103,
        position: 'MIDDLE',
      }),
      match({
        matchId: 'jinx',
        totalCs: csForRate(2),
        championKey: 'Jinx',
        championName: 'Jinx',
        championId: 222,
        position: 'BOTTOM',
      }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: {
        ahri: lookup({ averageCsPerMinute: 8 }),
        jinx: lookup({ averageCsPerMinute: 1 }),
      },
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    const cs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(cs.playerValue).toBeNull();
    expect(cs.baseline?.value).toBeNull();
    expect(cs.playerValue).not.toBe(6);
    expect(cs.baseline?.value).not.toBe(4.5);
    expect(cs.delta).toBeCloseTo(1.5);
    expect(profile.overall.comparisons.some((row) => row.metric === 'KDA')).toBe(false);
    assertValidComparisons(profile.overall.comparisons);
  });

  it('uses mean of matched per-match baselines on slices, not a modal aggregate', () => {
    const matches = [
      match({
        matchId: 'p14-a',
        patch: '16.14',
        totalCs: csForRate(7.5),
        gameCreation: Date.parse('2026-08-01T00:00:00.000Z'),
      }),
      match({
        matchId: 'p14-b',
        patch: '16.14',
        totalCs: csForRate(7.5),
        gameCreation: Date.parse('2026-08-02T00:00:00.000Z'),
      }),
      match({
        matchId: 'p15-a',
        patch: '16.15',
        totalCs: csForRate(8.5),
        gameCreation: Date.parse('2026-08-03T00:00:00.000Z'),
      }),
      match({
        matchId: 'p15-b',
        patch: '16.15',
        totalCs: csForRate(8.5),
        gameCreation: Date.parse('2026-08-04T00:00:00.000Z'),
      }),
      match({
        matchId: 'p15-c',
        patch: '16.15',
        totalCs: csForRate(8.5),
        gameCreation: Date.parse('2026-08-05T00:00:00.000Z'),
      }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: {
        'p14-a': lookup({ averageCsPerMinute: 7 }),
        'p14-b': lookup({ averageCsPerMinute: 7 }),
        'p15-a': lookup({ averageCsPerMinute: 8 }),
        'p15-b': lookup({ averageCsPerMinute: 8 }),
        'p15-c': lookup({ averageCsPerMinute: 8 }),
      },
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    expect(profile.championSlices).toHaveLength(1);
    const cs = findComparison(profile.championSlices[0]!.comparisons, 'CS_PER_MIN');
    expect(cs.playerValue).toBeCloseTo(8.1);
    expect(cs.baseline?.value).toBeCloseTo(7.6);
    expect(cs.baseline?.value).not.toBe(7);
    expect(cs.baseline?.value).not.toBe(8);
    expect(cs.delta).toBeCloseTo(0.5);
    expect(cs.delta).toBeCloseTo((cs.playerValue as number) - (cs.baseline?.value as number));

    const overallCs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(overallCs.playerValue).toBeNull();
    expect(overallCs.baseline?.value).toBeNull();
    expect(overallCs.delta).toBeCloseTo(0.5);
    assertValidComparisons(profile.championSlices[0]!.comparisons);
  });

  it('computes slice KDA from ratio-of-sums and omits overall KDA', () => {
    const matches = [
      match({ matchId: 'kda-a', kills: 10, deaths: 0, assists: 0 }),
      match({ matchId: 'kda-b', kills: 0, deaths: 5, assists: 0 }),
      match({ matchId: 'kda-c', kills: 1, deaths: 1, assists: 0 }),
      match({ matchId: 'kda-d', kills: 1, deaths: 1, assists: 0 }),
      match({ matchId: 'kda-e', kills: 1, deaths: 1, assists: 0 }),
    ];
    const perMatchKdas = matches.map(
      (row) => computeAggregateKdaRatio(1, row.kills, row.deaths, row.assists) as number,
    );
    const meanOfPerMatchKda = perMatchKdas.reduce((sum, value) => sum + value, 0) / perMatchKdas.length;
    const ratioOfSums = computeAggregateKdaRatio(5, 13, 8, 0);

    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselinesFor(matches, lookup({ aggregateKdaRatio: 3 })),
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    expect(profile.overall.comparisons.map((row) => row.metric)).toEqual(OVERALL_METRIC_ORDER);
    expect(profile.overall.comparisons.some((row) => row.metric === 'KDA')).toBe(false);

    const slice = profile.championSlices[0]!;
    expect(slice.comparisons.map((row) => row.metric)).toEqual(SLICE_METRIC_ORDER);
    const kda = findComparison(slice.comparisons, 'KDA');
    expect(kda.playerValue).toBe(ratioOfSums);
    expect(kda.playerValue).not.toBe(meanOfPerMatchKda);
    expect(kda.baseline?.value).toBe(3);
    expect(kda.delta).toBeCloseTo((ratioOfSums as number) - 3);
    expect(kda.delta).not.toBeCloseTo(meanOfPerMatchKda - 3);
  });

  it('excludes insufficient or null baselines from a metric comparableMatchCount', () => {
    const matches = [
      match({ matchId: 'ok-1' }),
      match({ matchId: 'ok-2' }),
      match({ matchId: 'ok-3' }),
      match({ matchId: 'ok-4' }),
      match({ matchId: 'bad-insufficient' }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: {
        'ok-1': lookup(),
        'ok-2': lookup(),
        'ok-3': lookup(),
        'ok-4': lookup(),
        'bad-insufficient': lookup({ sampleSize: 10, sampleConfidence: 'INSUFFICIENT' }),
      },
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    const cs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(cs.comparableMatchCount).toBe(4);
    expect(cs.direction).toBe('NOT_COMPARABLE');
    expect(cs.interpretationAllowed).toBe(false);
    expect(profile.skipped.noBaseline).toBe(1);
    expect(profile.matchesAnalyzed).toBe(5);
    expect(profile.comparableMatchCount).toBe(4);

    const withNull = buildPlayerPlaystyleProfile({
      matches: [...matches, match({ matchId: 'bad-null' })],
      baselinesByMatchId: {
        'ok-1': lookup(),
        'ok-2': lookup(),
        'ok-3': lookup(),
        'ok-4': lookup(),
        'bad-insufficient': lookup({ sampleSize: 10, sampleConfidence: 'INSUFFICIENT' }),
        'bad-null': null,
      },
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });
    expect(findComparison(withNull.overall.comparisons, 'CS_PER_MIN').comparableMatchCount).toBe(4);
    expect(withNull.skipped.noBaseline).toBe(2);
  });

  it('sets usedAllTierFallback when any comparable match used ALL-tier', () => {
    const matches = [
      match({ matchId: 'fallback', goldDifferenceAt10: null }),
      match({ matchId: 'exact-1' }),
      match({ matchId: 'exact-2' }),
      match({ matchId: 'exact-3' }),
      match({ matchId: 'exact-4' }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: {
        fallback: lookup({}, { rankTier: 'ALL', usedAllTierFallback: true }),
        'exact-1': lookup(),
        'exact-2': lookup(),
        'exact-3': lookup(),
        'exact-4': lookup(),
      },
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    const overallCs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(overallCs.baseline?.usedAllTierFallback).toBe(true);
    expect(overallCs.baseline?.rankTier).toBe('ALL');

    const overallGd = findComparison(profile.overall.comparisons, 'GOLD_DIFF_AT_10');
    expect(overallGd.baseline?.usedAllTierFallback).toBe(false);
    expect(overallGd.baseline?.rankTier).toBe('GOLD');

    const slice = profile.championSlices[0]!;
    expect(findComparison(slice.comparisons, 'CS_PER_MIN').baseline?.usedAllTierFallback).toBe(true);
    expect(findComparison(slice.comparisons, 'GOLD_DIFF_AT_10').baseline?.usedAllTierFallback).toBe(
      false,
    );
  });

  it('omits a champion+position slice below 5 analyzed games and includes one at 5', () => {
    const ahri = Array.from({ length: 4 }, (_, index) =>
      match({
        matchId: `ahri-${index}`,
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        gameCreation: Date.parse('2026-08-08T00:00:00.000Z') + index,
      }),
    );
    const jinx = Array.from({ length: 5 }, (_, index) =>
      match({
        matchId: `jinx-${index}`,
        championId: 222,
        championKey: 'Jinx',
        championName: 'Jinx',
        position: 'BOTTOM',
        gameCreation: Date.parse('2026-08-09T00:00:00.000Z') + index,
      }),
    );
    const matches = [...ahri, ...jinx];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselinesFor(matches, lookup()),
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    expect(profile.championSlices.map((slice) => slice.championKey)).toEqual(['Jinx']);
    expect(profile.championSlices[0]?.matchCount).toBe(5);
    expect(profile.championSlices[0]?.sampleBand).toBe('EXPLORATORY');
    expect(profile.mix.map((entry) => ({ key: entry.championKey, count: entry.matchCount }))).toEqual(
      [
        { key: 'Jinx', count: 5 },
        { key: 'Ahri', count: 4 },
      ],
    );
  });

  it('keeps at most 3 slices, highest count then most recent gameCreation', () => {
    const champions = [
      { championKey: 'Ahri', championName: 'Ahri', championId: 103, position: 'MIDDLE' as const, latest: Date.parse('2026-08-10T00:00:00.000Z') },
      { championKey: 'Jinx', championName: 'Jinx', championId: 222, position: 'BOTTOM' as const, latest: Date.parse('2026-08-09T00:00:00.000Z') },
      { championKey: 'Zed', championName: 'Zed', championId: 238, position: 'MIDDLE' as const, latest: Date.parse('2026-08-08T00:00:00.000Z') },
      { championKey: 'Lux', championName: 'Lux', championId: 99, position: 'MIDDLE' as const, latest: Date.parse('2026-08-01T00:00:00.000Z') },
    ];
    const matches = champions.flatMap((champion) =>
      Array.from({ length: 5 }, (_, index) =>
        match({
          matchId: `${champion.championKey}-${index}`,
          championId: champion.championId,
          championKey: champion.championKey,
          championName: champion.championName,
          position: champion.position,
          gameCreation: champion.latest - index * 60_000,
        }),
      ),
    );
    expect(matches).toHaveLength(20);

    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselinesFor(matches, lookup()),
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    expect(profile.championSlices.map((slice) => slice.championKey)).toEqual(['Ahri', 'Jinx', 'Zed']);
    expect(profile.championSlices.some((slice) => slice.championKey === 'Lux')).toBe(false);
    expect(profile.mix).toHaveLength(4);
    expect(profile.windowSize).toBe(20);
  });

  it('marks overall INSUFFICIENT and NOT_COMPARABLE when comparable matches are below 5', () => {
    const matches = [
      match({ matchId: 'a', totalCs: csForRate(10) }),
      match({ matchId: 'b', totalCs: csForRate(10) }),
      match({ matchId: 'c', totalCs: csForRate(10) }),
      match({ matchId: 'd', totalCs: csForRate(10) }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselinesFor(matches, lookup({ averageCsPerMinute: 7 })),
      skipped: { remake: 2, incomplete: 1, unknownPosition: 0 },
    });

    expect(profile.playerSampleBand).toBe('INSUFFICIENT');
    expect(profile.comparableMatchCount).toBe(4);
    expect(profile.windowSize).toBe(7);
    for (const comparison of profile.overall.comparisons) {
      expect(comparison.interpretationAllowed).toBe(false);
      if (comparison.comparableMatchCount < 5) {
        expect(comparison.direction).toBe('NOT_COMPARABLE');
      }
    }
    const cs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(cs.delta).toBeCloseTo(3);
    expect(cs.direction).toBe('NOT_COMPARABLE');
    expect(cs.direction).not.toBe('ABOVE_BASELINE');
  });

  it('does not let one valid metric unlock another with too few comparable matches', () => {
    const matches = [
      match({ matchId: 'gd', goldDifferenceAt10: 250 }),
      match({ matchId: 'n1', goldDifferenceAt10: null }),
      match({ matchId: 'n2', goldDifferenceAt10: null }),
      match({ matchId: 'n3', goldDifferenceAt10: null }),
      match({ matchId: 'n4', goldDifferenceAt10: null }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselinesFor(matches, lookup()),
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    const cs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(cs.comparableMatchCount).toBe(5);
    expect(cs.interpretationAllowed).toBe(true);
    expect(cs.direction).not.toBe('NOT_COMPARABLE');

    const gd = findComparison(profile.overall.comparisons, 'GOLD_DIFF_AT_10');
    expect(gd.comparableMatchCount).toBe(1);
    expect(gd.direction).toBe('NOT_COMPARABLE');
    expect(gd.interpretationAllowed).toBe(false);
  });

  it('treats GOLD_PER_MIN as comparable only when baseline gold per minute is finite', () => {
    const matches = Array.from({ length: 5 }, (_, index) => match({ matchId: `gpm-${index}` }));
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: {
        'gpm-0': lookup({ averageGoldPerMinute: null }),
        'gpm-1': lookup({ averageGoldPerMinute: 390 }),
        'gpm-2': lookup({ averageGoldPerMinute: 390 }),
        'gpm-3': lookup({ averageGoldPerMinute: 390 }),
        'gpm-4': lookup({ averageGoldPerMinute: 390 }),
      },
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });

    const gpm = findComparison(profile.overall.comparisons, 'GOLD_PER_MIN');
    expect(gpm.comparableMatchCount).toBe(4);
    expect(gpm.direction).toBe('NOT_COMPARABLE');
    expect(gpm.interpretationAllowed).toBe(false);

    const cs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(cs.comparableMatchCount).toBe(5);
    expect(cs.interpretationAllowed).toBe(true);
  });

  it('computes window accounting without shrinking matchesAnalyzed for noBaseline', () => {
    const analyzed = [
      match({ matchId: 'ok-1', win: true, patch: '9.24' }),
      match({ matchId: 'ok-2', win: true, patch: '16.1' }),
      match({ matchId: 'ok-3', win: false, patch: '16.1' }),
      match({ matchId: 'ok-4', win: true, patch: '16.14' }),
      match({ matchId: 'ok-5', win: false, patch: '16.15' }),
      match({ matchId: 'no-base', win: true, patch: '16.15' }),
    ];
    const profile = buildPlayerPlaystyleProfile({
      matches: analyzed,
      baselinesByMatchId: {
        'ok-1': lookup(),
        'ok-2': lookup(),
        'ok-3': lookup(),
        'ok-4': lookup(),
        'ok-5': lookup(),
        'no-base': null,
      },
      skipped: { remake: 2, incomplete: 1, unknownPosition: 1 },
    });

    expect(profile.windowSize).toBe(10);
    expect(profile.matchesAnalyzed).toBe(6);
    expect(profile.skipped.noBaseline).toBe(1);
    expect(profile.skipped.noBaseline).toBeLessThanOrEqual(profile.matchesAnalyzed);
    expect(profile.comparableMatchCount).toBe(5);
    expect(
      profile.skipped.remake +
        profile.skipped.incomplete +
        profile.skipped.unknownPosition +
        profile.matchesAnalyzed,
    ).toBe(profile.windowSize);
    expect(profile.windowSize).toBeLessThanOrEqual(20);
    expect(profile.wins).toBe(4);
    expect(profile.patchRange).toEqual({ min: '9.24', max: '16.15' });
    expect(profile.playerSampleBand).toBe('EXPLORATORY');
    expect(profile.overall.comparisons[0]?.baseline?.sampleSize).toBe(800);
    expect(profile.overall.comparisons[0]?.baseline?.sampleConfidence).toBe('HIGH');
  });

  it('classifies NEAR_BASELINE at the inclusive GOLD_PER_MIN threshold', () => {
    const matches = Array.from({ length: 5 }, (_, index) =>
      match({ matchId: `near-${index}`, goldEarned: 12_000 }),
    );
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselinesFor(matches, lookup({ averageGoldPerMinute: 375 })),
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });
    const gpm = findComparison(profile.overall.comparisons, 'GOLD_PER_MIN');
    expect(gpm.delta).toBe(25);
    expect(gpm.direction).toBe('NEAR_BASELINE');
    expect(gpm.interpretationAllowed).toBe(true);
  });

  it('accepts Map-keyed baselines and uses minimum baseline sampleSize', () => {
    const matches = Array.from({ length: 5 }, (_, index) => match({ matchId: `map-${index}` }));
    const baselines = new Map<string, BaselineLookupResult>([
      ['map-0', lookup({ sampleSize: 40, sampleConfidence: 'LOW' })],
      ['map-1', lookup({ sampleSize: 800, sampleConfidence: 'HIGH' })],
      ['map-2', lookup({ sampleSize: 120, sampleConfidence: 'MEDIUM' })],
      ['map-3', lookup({ sampleSize: 800, sampleConfidence: 'HIGH' })],
      ['map-4', lookup({ sampleSize: 800, sampleConfidence: 'HIGH' })],
    ]);
    const profile = buildPlayerPlaystyleProfile({
      matches,
      baselinesByMatchId: baselines,
      skipped: { remake: 0, incomplete: 0, unknownPosition: 0 },
    });
    const cs = findComparison(profile.overall.comparisons, 'CS_PER_MIN');
    expect(cs.baseline?.sampleSize).toBe(40);
    expect(cs.baseline?.sampleConfidence).toBe('LOW');
    expect(cs.interpretationAllowed).toBe(true);
  });
});
