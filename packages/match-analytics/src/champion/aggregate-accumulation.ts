import { MatchAnalyticsValidationError } from '../errors';

export type ChampionAggregateContribution = {
  readonly championId: number;
  readonly won: boolean;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly totalCs: number;
  readonly gameSeconds: number;
  readonly damageToChampions: number;
  readonly visionScore: number;
  readonly goldEarned: number;
  readonly goldDifferenceAt10: number | null;
  readonly goldDifferenceAt15: number | null;
  readonly csDifferenceAt10: number | null;
  readonly csDifferenceAt15: number | null;
  readonly matchEndedAt: Date | number | null;
};

export type ChampionAggregateAccumulator = {
  sampleSize: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCs: number;
  totalGameSeconds: number;
  totalDamageToChampions: number;
  totalVisionScore: number;
  totalGoldEarned: number;
  totalGoldDifferenceAt10: number | null;
  goldDifferenceAt10Samples: number;
  totalGoldDifferenceAt15: number | null;
  goldDifferenceAt15Samples: number;
  totalCsDifferenceAt10: number | null;
  csDifferenceAt10Samples: number;
  totalCsDifferenceAt15: number | null;
  csDifferenceAt15Samples: number;
  latestEligibleMatchAt: Date | null;
};

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
    throw new MatchAnalyticsValidationError(
      `${field} must be a finite non-negative integer.`,
      `INVALID_${field.toUpperCase()}`,
    );
  }
}

function assertFiniteInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new MatchAnalyticsValidationError(
      `${field} must be a finite integer.`,
      `INVALID_${field.toUpperCase()}`,
    );
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new MatchAnalyticsValidationError(`${field} must be a boolean.`, `INVALID_${field.toUpperCase()}`);
  }
}

function assertOptionalSignedFinite(
  value: number | null,
  field: string,
): asserts value is number | null {
  if (value === null) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MatchAnalyticsValidationError(
      `${field} must be a finite number or null.`,
      `INVALID_${field.toUpperCase()}`,
    );
  }
}

function toMatchEndedAt(value: Date | number | null): Date | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) {
      throw new MatchAnalyticsValidationError(
        'matchEndedAt must be a valid Date, finite epoch ms, or null.',
        'INVALID_MATCH_ENDED_AT',
      );
    }
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MatchAnalyticsValidationError(
      'matchEndedAt must be a valid Date, finite epoch ms, or null.',
      'INVALID_MATCH_ENDED_AT',
    );
  }
  return new Date(value);
}

function assertContribution(contribution: ChampionAggregateContribution): void {
  assertFiniteInteger(contribution.championId, 'championId');
  if (contribution.championId <= 0) {
    throw new MatchAnalyticsValidationError(
      'championId must be a positive finite integer.',
      'INVALID_CHAMPIONID',
    );
  }
  assertBoolean(contribution.won, 'won');
  assertNonNegativeInteger(contribution.kills, 'kills');
  assertNonNegativeInteger(contribution.deaths, 'deaths');
  assertNonNegativeInteger(contribution.assists, 'assists');
  assertNonNegativeInteger(contribution.totalCs, 'totalCs');
  assertNonNegativeInteger(contribution.gameSeconds, 'gameSeconds');
  assertNonNegativeInteger(contribution.damageToChampions, 'damageToChampions');
  assertNonNegativeInteger(contribution.visionScore, 'visionScore');
  assertNonNegativeInteger(contribution.goldEarned, 'goldEarned');
  assertOptionalSignedFinite(contribution.goldDifferenceAt10, 'goldDifferenceAt10');
  assertOptionalSignedFinite(contribution.goldDifferenceAt15, 'goldDifferenceAt15');
  assertOptionalSignedFinite(contribution.csDifferenceAt10, 'csDifferenceAt10');
  assertOptionalSignedFinite(contribution.csDifferenceAt15, 'csDifferenceAt15');
  toMatchEndedAt(contribution.matchEndedAt);
}

function addOptionalTotal(
  currentTotal: number | null,
  currentSamples: number,
  next: number | null,
): { total: number | null; samples: number } {
  if (next === null) {
    return { total: currentTotal, samples: currentSamples };
  }
  if (currentTotal === null) {
    return { total: next, samples: currentSamples + 1 };
  }
  return { total: currentTotal + next, samples: currentSamples + 1 };
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return a.getTime() >= b.getTime() ? a : b;
}

export function emptyAccumulator(): ChampionAggregateAccumulator {
  return {
    sampleSize: 0,
    wins: 0,
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalCs: 0,
    totalGameSeconds: 0,
    totalDamageToChampions: 0,
    totalVisionScore: 0,
    totalGoldEarned: 0,
    totalGoldDifferenceAt10: null,
    goldDifferenceAt10Samples: 0,
    totalGoldDifferenceAt15: null,
    goldDifferenceAt15Samples: 0,
    totalCsDifferenceAt10: null,
    csDifferenceAt10Samples: 0,
    totalCsDifferenceAt15: null,
    csDifferenceAt15Samples: 0,
    latestEligibleMatchAt: null,
  };
}

export function accumulateContribution(
  accumulator: ChampionAggregateAccumulator,
  contribution: ChampionAggregateContribution,
): ChampionAggregateAccumulator {
  assertContribution(contribution);

  const gold10 = addOptionalTotal(
    accumulator.totalGoldDifferenceAt10,
    accumulator.goldDifferenceAt10Samples,
    contribution.goldDifferenceAt10,
  );
  const gold15 = addOptionalTotal(
    accumulator.totalGoldDifferenceAt15,
    accumulator.goldDifferenceAt15Samples,
    contribution.goldDifferenceAt15,
  );
  const cs10 = addOptionalTotal(
    accumulator.totalCsDifferenceAt10,
    accumulator.csDifferenceAt10Samples,
    contribution.csDifferenceAt10,
  );
  const cs15 = addOptionalTotal(
    accumulator.totalCsDifferenceAt15,
    accumulator.csDifferenceAt15Samples,
    contribution.csDifferenceAt15,
  );

  return {
    sampleSize: accumulator.sampleSize + 1,
    wins: accumulator.wins + (contribution.won ? 1 : 0),
    totalKills: accumulator.totalKills + contribution.kills,
    totalDeaths: accumulator.totalDeaths + contribution.deaths,
    totalAssists: accumulator.totalAssists + contribution.assists,
    totalCs: accumulator.totalCs + contribution.totalCs,
    totalGameSeconds: accumulator.totalGameSeconds + contribution.gameSeconds,
    totalDamageToChampions: accumulator.totalDamageToChampions + contribution.damageToChampions,
    totalVisionScore: accumulator.totalVisionScore + contribution.visionScore,
    totalGoldEarned: accumulator.totalGoldEarned + contribution.goldEarned,
    totalGoldDifferenceAt10: gold10.total,
    goldDifferenceAt10Samples: gold10.samples,
    totalGoldDifferenceAt15: gold15.total,
    goldDifferenceAt15Samples: gold15.samples,
    totalCsDifferenceAt10: cs10.total,
    csDifferenceAt10Samples: cs10.samples,
    totalCsDifferenceAt15: cs15.total,
    csDifferenceAt15Samples: cs15.samples,
    latestEligibleMatchAt: maxDate(
      accumulator.latestEligibleMatchAt,
      toMatchEndedAt(contribution.matchEndedAt),
    ),
  };
}

function combineOptionalTotals(
  leftTotal: number | null,
  leftSamples: number,
  rightTotal: number | null,
  rightSamples: number,
): { total: number | null; samples: number } {
  if (leftTotal === null && rightTotal === null) {
    return { total: null, samples: 0 };
  }
  if (leftTotal === null) {
    return { total: rightTotal, samples: rightSamples };
  }
  if (rightTotal === null) {
    return { total: leftTotal, samples: leftSamples };
  }
  return { total: leftTotal + rightTotal, samples: leftSamples + rightSamples };
}

export function combineAccumulators(
  left: ChampionAggregateAccumulator,
  right: ChampionAggregateAccumulator,
): ChampionAggregateAccumulator {
  const gold10 = combineOptionalTotals(
    left.totalGoldDifferenceAt10,
    left.goldDifferenceAt10Samples,
    right.totalGoldDifferenceAt10,
    right.goldDifferenceAt10Samples,
  );
  const gold15 = combineOptionalTotals(
    left.totalGoldDifferenceAt15,
    left.goldDifferenceAt15Samples,
    right.totalGoldDifferenceAt15,
    right.goldDifferenceAt15Samples,
  );
  const cs10 = combineOptionalTotals(
    left.totalCsDifferenceAt10,
    left.csDifferenceAt10Samples,
    right.totalCsDifferenceAt10,
    right.csDifferenceAt10Samples,
  );
  const cs15 = combineOptionalTotals(
    left.totalCsDifferenceAt15,
    left.csDifferenceAt15Samples,
    right.totalCsDifferenceAt15,
    right.csDifferenceAt15Samples,
  );

  return {
    sampleSize: left.sampleSize + right.sampleSize,
    wins: left.wins + right.wins,
    totalKills: left.totalKills + right.totalKills,
    totalDeaths: left.totalDeaths + right.totalDeaths,
    totalAssists: left.totalAssists + right.totalAssists,
    totalCs: left.totalCs + right.totalCs,
    totalGameSeconds: left.totalGameSeconds + right.totalGameSeconds,
    totalDamageToChampions: left.totalDamageToChampions + right.totalDamageToChampions,
    totalVisionScore: left.totalVisionScore + right.totalVisionScore,
    totalGoldEarned: left.totalGoldEarned + right.totalGoldEarned,
    totalGoldDifferenceAt10: gold10.total,
    goldDifferenceAt10Samples: gold10.samples,
    totalGoldDifferenceAt15: gold15.total,
    goldDifferenceAt15Samples: gold15.samples,
    totalCsDifferenceAt10: cs10.total,
    csDifferenceAt10Samples: cs10.samples,
    totalCsDifferenceAt15: cs15.total,
    csDifferenceAt15Samples: cs15.samples,
    latestEligibleMatchAt: maxDate(left.latestEligibleMatchAt, right.latestEligibleMatchAt),
  };
}
