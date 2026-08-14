import { describe, expect, it } from 'vitest';
import {
  accumulateContribution,
  emptyAccumulator,
  type ChampionAggregateContribution,
  type ChampionAggregateAccumulator,
} from './aggregate-accumulation';
import { deriveChampionAggregateMetrics } from './aggregate-derivations';

function baseContribution(
  overrides: Partial<ChampionAggregateContribution> = {},
): ChampionAggregateContribution {
  return {
    championId: 1,
    won: true,
    kills: 0,
    deaths: 0,
    assists: 0,
    totalCs: 0,
    gameSeconds: 60,
    damageToChampions: 0,
    visionScore: 0,
    goldEarned: 0,
    goldDifferenceAt10: null,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    matchEndedAt: null,
    ...overrides,
  };
}

const deriveOptions = {
  confidenceLevel: 0.95,
  thresholds: { insufficientBelow: 30, lowBelow: 100, mediumBelow: 500 },
} as const;

describe('deriveChampionAggregateMetrics', () => {
  it('KDA matches player UI perfect-game convention', () => {
    const acc = accumulateContribution(emptyAccumulator(), {
      championId: 1,
      won: true,
      kills: 10,
      deaths: 0,
      assists: 2,
      totalCs: 0,
      gameSeconds: 60,
      damageToChampions: 0,
      visionScore: 0,
      goldEarned: 0,
      goldDifferenceAt10: null,
      goldDifferenceAt15: null,
      csDifferenceAt10: null,
      csDifferenceAt15: null,
      matchEndedAt: null,
    });
    const d = deriveChampionAggregateMetrics(acc, deriveOptions);
    expect(d.aggregateKdaRatio).toBe(12);
  });

  it('returns null KDA when there are no samples', () => {
    const d = deriveChampionAggregateMetrics(emptyAccumulator(), deriveOptions);
    expect(d.aggregateKdaRatio).toBeNull();
    expect(d.winRate).toBeNull();
    expect(d.wilsonInterval).toBeNull();
    expect(d.sampleConfidence).toBe('INSUFFICIENT');
  });

  it('computes KDA as (K+A)/D when deaths > 0', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ kills: 4, deaths: 2, assists: 2 }),
    );
    const d = deriveChampionAggregateMetrics(acc, deriveOptions);
    expect(d.aggregateKdaRatio).toBe(3);
  });

  it('returns 0 KDA when deaths=0 and K+A=0', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ kills: 0, deaths: 0, assists: 0 }),
    );
    const d = deriveChampionAggregateMetrics(acc, deriveOptions);
    expect(d.aggregateKdaRatio).toBe(0);
  });

  it('never returns NaN or Infinity for derived ratios', () => {
    const cases: ChampionAggregateAccumulator[] = [
      emptyAccumulator(),
      accumulateContribution(emptyAccumulator(), baseContribution({ deaths: 0, kills: 5, assists: 1 })),
      accumulateContribution(emptyAccumulator(), baseContribution({ deaths: 3, kills: 1, assists: 2 })),
      accumulateContribution(
        emptyAccumulator(),
        baseContribution({
          gameSeconds: 0,
          totalCs: 100,
          damageToChampions: 1000,
          visionScore: 10,
        }),
      ),
    ];

    for (const acc of cases) {
      const d = deriveChampionAggregateMetrics(acc, deriveOptions);
      for (const value of [
        d.winRate,
        d.aggregateKdaRatio,
        d.averageCsPerMinute,
        d.averageDamagePerMinute,
        d.averageVisionScorePerMinute,
        d.averageGoldPerMinute,
        d.averageGoldDifferenceAt10,
        d.averageGoldDifferenceAt15,
        d.averageCsDifferenceAt10,
        d.averageCsDifferenceAt15,
      ]) {
        if (value !== null) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it('averages GD/CSD when samples > 0 including real zero totals', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({
        goldDifferenceAt10: 0,
        csDifferenceAt15: 0,
      }),
    );
    const d = deriveChampionAggregateMetrics(acc, deriveOptions);
    expect(d.averageGoldDifferenceAt10).toBe(0);
    expect(d.averageCsDifferenceAt15).toBe(0);
    expect(d.averageGoldDifferenceAt15).toBeNull();
    expect(d.averageCsDifferenceAt10).toBeNull();
  });

  it('derives averageGoldPerMinute from totalGoldEarned and totalGameSeconds', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ goldEarned: 12_000, gameSeconds: 1800 }),
    );
    const derived = deriveChampionAggregateMetrics(acc, { confidenceLevel: 0.95 });
    expect(derived.averageGoldPerMinute).toBe(400);
  });

  it('does not round derived values', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ kills: 1, deaths: 3, assists: 0, totalCs: 1, gameSeconds: 90 }),
    );
    const d = deriveChampionAggregateMetrics(acc, deriveOptions);
    expect(d.aggregateKdaRatio).toBe(1 / 3);
    expect(d.averageCsPerMinute).toBe(1 / 1.5);
  });

  it('classifies sample confidence from thresholds', () => {
    let acc = emptyAccumulator();
    for (let i = 0; i < 30; i += 1) {
      acc = accumulateContribution(acc, baseContribution({ won: i % 2 === 0 }));
    }
    const d = deriveChampionAggregateMetrics(acc, deriveOptions);
    expect(d.sampleSize).toBe(30);
    expect(d.sampleConfidence).toBe('LOW');
    expect(d.winRate).toBe(0.5);
    expect(d.wilsonInterval).not.toBeNull();
  });
});
