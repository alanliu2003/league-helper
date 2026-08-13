import { MatchAnalyticsValidationError } from '../errors';

export type MatchupContribution = {
  readonly championId: number;
  readonly opponentChampionId: number;
  readonly won: boolean;
  readonly goldDifferenceAt10: number | null;
  readonly goldDifferenceAt15: number | null;
  readonly csDifferenceAt10: number | null;
  readonly csDifferenceAt15: number | null;
  readonly matchEndedAt: Date | number | null;
};

export type MatchupAggregateAccumulator = {
  sampleSize: number;
  wins: number;
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

function assertPositiveChampionId(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    throw new MatchAnalyticsValidationError(
      `${field} must be a positive finite integer.`,
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

export function emptyMatchupAccumulator(): MatchupAggregateAccumulator {
  return {
    sampleSize: 0,
    wins: 0,
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

export function accumulateMatchupContribution(
  accumulator: MatchupAggregateAccumulator,
  contribution: MatchupContribution,
): MatchupAggregateAccumulator {
  assertPositiveChampionId(contribution.championId, 'championId');
  assertPositiveChampionId(contribution.opponentChampionId, 'opponentChampionId');
  if (contribution.championId === contribution.opponentChampionId) {
    throw new MatchAnalyticsValidationError(
      'championId must not equal opponentChampionId.',
      'MIRROR_MATCHUP_FORBIDDEN',
    );
  }
  assertBoolean(contribution.won, 'won');
  assertOptionalSignedFinite(contribution.goldDifferenceAt10, 'goldDifferenceAt10');
  assertOptionalSignedFinite(contribution.goldDifferenceAt15, 'goldDifferenceAt15');
  assertOptionalSignedFinite(contribution.csDifferenceAt10, 'csDifferenceAt10');
  assertOptionalSignedFinite(contribution.csDifferenceAt15, 'csDifferenceAt15');

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

export function combineMatchupAccumulators(
  left: MatchupAggregateAccumulator,
  right: MatchupAggregateAccumulator,
): MatchupAggregateAccumulator {
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
