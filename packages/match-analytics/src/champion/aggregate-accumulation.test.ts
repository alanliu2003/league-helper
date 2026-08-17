import { describe, expect, it } from 'vitest';
import { MatchAnalyticsValidationError } from '../errors';
import {
  accumulateContribution,
  combineAccumulators,
  emptyAccumulator,
  type ChampionAggregateContribution,
} from './aggregate-accumulation';

function baseContribution(
  overrides: Partial<ChampionAggregateContribution> = {},
): ChampionAggregateContribution {
  return {
    championId: 1,
    won: true,
    kills: 2,
    deaths: 1,
    assists: 3,
    totalCs: 100,
    gameSeconds: 1800,
    damageToChampions: 10_000,
    visionScore: 20,
    goldEarned: 0,
    goldDifferenceAt10: null,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    matchEndedAt: null,
    ...overrides,
  };
}

describe('emptyAccumulator', () => {
  it('starts with zero samples and null timeline totals', () => {
    const acc = emptyAccumulator();
    expect(acc.sampleSize).toBe(0);
    expect(acc.wins).toBe(0);
    expect(acc.totalGoldDifferenceAt10).toBeNull();
    expect(acc.goldDifferenceAt10Samples).toBe(0);
    expect(acc.totalGoldDifferenceAt15).toBeNull();
    expect(acc.goldDifferenceAt15Samples).toBe(0);
    expect(acc.totalCsDifferenceAt10).toBeNull();
    expect(acc.csDifferenceAt10Samples).toBe(0);
    expect(acc.totalCsDifferenceAt15).toBeNull();
    expect(acc.csDifferenceAt15Samples).toBe(0);
    expect(acc.latestEligibleMatchAt).toBeNull();
    expect(acc.totalGoldEarned).toBe(0);
  });
});

describe('accumulateContribution', () => {
  it('does not increment GD/CSD sample counters for null timeline values', () => {
    const acc = accumulateContribution(emptyAccumulator(), baseContribution());
    expect(acc.sampleSize).toBe(1);
    expect(acc.goldDifferenceAt10Samples).toBe(0);
    expect(acc.goldDifferenceAt15Samples).toBe(0);
    expect(acc.csDifferenceAt10Samples).toBe(0);
    expect(acc.csDifferenceAt15Samples).toBe(0);
    expect(acc.totalGoldDifferenceAt10).toBeNull();
    expect(acc.totalGoldDifferenceAt15).toBeNull();
    expect(acc.totalCsDifferenceAt10).toBeNull();
    expect(acc.totalCsDifferenceAt15).toBeNull();
  });

  it('treats real zero timeline difference with samples > 0 as valid', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({
        goldDifferenceAt10: 0,
        goldDifferenceAt15: 0,
        csDifferenceAt10: 0,
        csDifferenceAt15: 0,
      }),
    );
    expect(acc.totalGoldDifferenceAt10).toBe(0);
    expect(acc.goldDifferenceAt10Samples).toBe(1);
    expect(acc.totalGoldDifferenceAt15).toBe(0);
    expect(acc.goldDifferenceAt15Samples).toBe(1);
    expect(acc.totalCsDifferenceAt10).toBe(0);
    expect(acc.csDifferenceAt10Samples).toBe(1);
    expect(acc.totalCsDifferenceAt15).toBe(0);
    expect(acc.csDifferenceAt15Samples).toBe(1);
  });

  it('accumulates core counters and latestEligibleMatchAt', () => {
    const ended = new Date('2026-08-01T12:00:00.000Z');
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({
        won: false,
        kills: 5,
        deaths: 2,
        assists: 7,
        totalCs: 150,
        gameSeconds: 2000,
        damageToChampions: 12_000,
        visionScore: 30,
        goldDifferenceAt10: -100,
        matchEndedAt: ended,
      }),
    );
    expect(acc.sampleSize).toBe(1);
    expect(acc.wins).toBe(0);
    expect(acc.totalKills).toBe(5);
    expect(acc.totalDeaths).toBe(2);
    expect(acc.totalAssists).toBe(7);
    expect(acc.totalCs).toBe(150);
    expect(acc.totalGameSeconds).toBe(2000);
    expect(acc.totalDamageToChampions).toBe(12_000);
    expect(acc.totalVisionScore).toBe(30);
    expect(acc.totalGoldDifferenceAt10).toBe(-100);
    expect(acc.goldDifferenceAt10Samples).toBe(1);
    expect(acc.latestEligibleMatchAt).toEqual(ended);
  });

  it('accumulates goldEarned into totalGoldEarned', () => {
    const acc = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ goldEarned: 12_000, gameSeconds: 1800 }),
    );
    expect(acc.totalGoldEarned).toBe(12_000);
  });

  it('rejects invalid contribution fields', () => {
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ kills: 1.5 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ kills: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ deaths: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ assists: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ totalCs: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ gameSeconds: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ damageToChampions: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ visionScore: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(emptyAccumulator(), baseContribution({ goldEarned: -1 })),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(
        emptyAccumulator(),
        baseContribution({ goldDifferenceAt10: Number.NaN }),
      ),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      accumulateContribution(
        emptyAccumulator(),
        baseContribution({ goldDifferenceAt10: Number.POSITIVE_INFINITY }),
      ),
    ).toThrow(MatchAnalyticsValidationError);
  });
});

describe('combineAccumulators', () => {
  it('is order-independent', () => {
    const a = accumulateContribution(
      emptyAccumulator(),
      baseContribution({
        won: true,
        kills: 1,
        deaths: 0,
        assists: 1,
        goldEarned: 1_000,
        goldDifferenceAt10: 50,
        matchEndedAt: new Date('2026-08-01T10:00:00.000Z'),
      }),
    );
    const b = accumulateContribution(
      emptyAccumulator(),
      baseContribution({
        won: false,
        kills: 2,
        deaths: 3,
        assists: 4,
        goldEarned: 2_000,
        goldDifferenceAt10: -20,
        matchEndedAt: new Date('2026-08-02T10:00:00.000Z'),
      }),
    );

    const ab = combineAccumulators(a, b);
    const ba = combineAccumulators(b, a);

    expect(ab).toEqual(ba);
    expect(ab.sampleSize).toBe(2);
    expect(ab.wins).toBe(1);
    expect(ab.totalKills).toBe(3);
    expect(ab.totalDeaths).toBe(3);
    expect(ab.totalAssists).toBe(5);
    expect(ab.totalGoldDifferenceAt10).toBe(30);
    expect(ab.goldDifferenceAt10Samples).toBe(2);
    expect(ab.latestEligibleMatchAt).toEqual(new Date('2026-08-02T10:00:00.000Z'));
    expect(ab.totalGoldEarned).toBe(3_000);
  });

  it('sums totalGoldEarned when combining accumulators', () => {
    const a = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ goldEarned: 12_000 }),
    );
    const b = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ goldEarned: 8_000 }),
    );
    expect(combineAccumulators(a, b).totalGoldEarned).toBe(20_000);
  });

  it('keeps null timeline totals until first present sample when combining', () => {
    const withNull = accumulateContribution(emptyAccumulator(), baseContribution());
    const withZero = accumulateContribution(
      emptyAccumulator(),
      baseContribution({ goldDifferenceAt10: 0 }),
    );
    const combined = combineAccumulators(withNull, withZero);
    expect(combined.totalGoldDifferenceAt10).toBe(0);
    expect(combined.goldDifferenceAt10Samples).toBe(1);
  });
});
