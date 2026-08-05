import {
  classifySampleConfidence,
  DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
  type SampleConfidence,
  type SampleConfidenceThresholds,
} from '../statistics/sample-confidence';
import { safeDivide } from '../statistics/safe-math';
import {
  wilsonScoreInterval,
  type WilsonScoreInterval,
} from '../statistics/wilson-interval';
import type { ChampionAggregateAccumulator } from './aggregate-accumulation';

export type DeriveChampionAggregateMetricsOptions = {
  readonly confidenceLevel: number;
  readonly thresholds?: SampleConfidenceThresholds;
};

export type DerivedChampionAggregateMetrics = {
  readonly sampleSize: number;
  readonly wins: number;
  readonly winRate: number | null;
  readonly wilsonInterval: WilsonScoreInterval | null;
  readonly sampleConfidence: SampleConfidence;
  readonly aggregateKdaRatio: number | null;
  readonly averageCsPerMinute: number | null;
  readonly averageDamagePerMinute: number | null;
  readonly averageVisionScorePerMinute: number | null;
  readonly averageGoldDifferenceAt10: number | null;
  readonly averageGoldDifferenceAt15: number | null;
  readonly averageCsDifferenceAt10: number | null;
  readonly averageCsDifferenceAt15: number | null;
  readonly latestEligibleMatchAt: Date | null;
};

/**
 * Aggregate KDA (player UI convention):
 * - sampleSize === 0 → null
 * - deaths > 0 → (K + A) / D
 * - deaths === 0 && K + A === 0 → 0
 * - deaths === 0 && K + A > 0 → K + A
 */
export function computeAggregateKdaRatio(
  sampleSize: number,
  totalKills: number,
  totalDeaths: number,
  totalAssists: number,
): number | null {
  if (sampleSize === 0) {
    return null;
  }

  const ka = totalKills + totalAssists;
  if (totalDeaths > 0) {
    return safeDivide(ka, totalDeaths);
  }
  if (ka === 0) {
    return 0;
  }
  return ka;
}

function averageFromSamples(total: number | null, samples: number): number | null {
  if (samples <= 0 || total === null) {
    return null;
  }
  return safeDivide(total, samples);
}

function perMinute(total: number, totalGameSeconds: number): number | null {
  return safeDivide(total, totalGameSeconds / 60);
}

export function deriveChampionAggregateMetrics(
  accumulator: ChampionAggregateAccumulator,
  options: DeriveChampionAggregateMetricsOptions,
): DerivedChampionAggregateMetrics {
  const thresholds = options.thresholds ?? DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS;
  const { sampleSize, wins } = accumulator;

  return {
    sampleSize,
    wins,
    winRate: safeDivide(wins, sampleSize),
    wilsonInterval: wilsonScoreInterval(wins, sampleSize, options.confidenceLevel),
    sampleConfidence: classifySampleConfidence(sampleSize, thresholds),
    aggregateKdaRatio: computeAggregateKdaRatio(
      sampleSize,
      accumulator.totalKills,
      accumulator.totalDeaths,
      accumulator.totalAssists,
    ),
    averageCsPerMinute: perMinute(accumulator.totalCs, accumulator.totalGameSeconds),
    averageDamagePerMinute: perMinute(
      accumulator.totalDamageToChampions,
      accumulator.totalGameSeconds,
    ),
    averageVisionScorePerMinute: perMinute(
      accumulator.totalVisionScore,
      accumulator.totalGameSeconds,
    ),
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
