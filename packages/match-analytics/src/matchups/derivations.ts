import { classifySampleConfidence, type SampleConfidence } from '../statistics/sample-confidence';
import { safeDivide } from '../statistics/safe-math';
import { wilsonScoreInterval, type WilsonScoreInterval } from '../statistics/wilson-interval';
import type { MatchupAggregateAccumulator } from './accumulation';
import { MATCHUP_SAMPLE_CONFIDENCE_THRESHOLDS } from './policy';

export type DerivedMatchupMetrics = {
  readonly sampleSize: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly wilsonInterval: WilsonScoreInterval | null;
  readonly sampleConfidence: SampleConfidence;
  readonly averageGoldDifferenceAt10: number | null;
  readonly averageGoldDifferenceAt15: number | null;
  readonly averageCsDifferenceAt10: number | null;
  readonly averageCsDifferenceAt15: number | null;
  readonly latestEligibleMatchAt: Date | null;
};

function averageFromSamples(total: number | null, samples: number): number | null {
  if (samples <= 0 || total === null) {
    return null;
  }
  return safeDivide(total, samples);
}

export function deriveMatchupMetrics(
  accumulator: MatchupAggregateAccumulator,
  options: { confidenceLevel: number },
): DerivedMatchupMetrics {
  const { sampleSize, wins } = accumulator;
  return {
    sampleSize,
    wins,
    losses: Math.max(0, sampleSize - wins),
    winRate: safeDivide(wins, sampleSize),
    wilsonInterval: wilsonScoreInterval(wins, sampleSize, options.confidenceLevel),
    sampleConfidence: classifySampleConfidence(sampleSize, MATCHUP_SAMPLE_CONFIDENCE_THRESHOLDS),
    averageGoldDifferenceAt10: averageFromSamples(
      accumulator.totalGoldDifferenceAt10,
      accumulator.goldDifferenceAt10Samples,
    ),
    averageGoldDifferenceAt15: averageFromSamples(
      accumulator.totalGoldDifferenceAt15,
      accumulator.goldDifferenceAt15Samples,
    ),
    averageCsDifferenceAt10: averageFromSamples(
      accumulator.totalCsDifferenceAt10,
      accumulator.csDifferenceAt10Samples,
    ),
    averageCsDifferenceAt15: averageFromSamples(
      accumulator.totalCsDifferenceAt15,
      accumulator.csDifferenceAt15Samples,
    ),
    latestEligibleMatchAt: accumulator.latestEligibleMatchAt,
  };
}
