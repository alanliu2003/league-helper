export { MatchAnalyticsValidationError } from './errors';
export { safeDivide } from './statistics/safe-math';
export {
  classifySampleConfidence,
  DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
  type SampleConfidence,
  type SampleConfidenceThresholds,
} from './statistics/sample-confidence';
export {
  wilsonScoreInterval,
  type WilsonScoreInterval,
} from './statistics/wilson-interval';

export {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
} from './sentinels/aggregate-sentinels';
export {
  isAllPlatformRoute,
  isAllPosition,
  isAllQueueId,
  isAllRankTier,
  isAllRegionalRoute,
  isUnknownPosition,
  isUnknownRankTier,
} from './sentinels/public-sentinel-mapping';

export {
  assertExactChampionDimensions,
  assertMaterializedChampionDimensions,
  type ExactChampionDimensions,
  type ExactChampionPosition,
  type ExactChampionRankTier,
  type MaterializedChampionDimensions,
  type MaterializedChampionPosition,
  type MaterializedChampionRankTier,
} from './champion/aggregate-dimensions';
export { buildChampionAggregateDimensionKey } from './champion/aggregate-keys';
export {
  DEFAULT_CHAMPION_ROLLUP_POLICY,
  expandChampionDimensionTuples,
  type ChampionRollupPolicy,
} from './champion/rollup-policy';
export {
  accumulateContribution,
  combineAccumulators,
  emptyAccumulator,
  type ChampionAggregateAccumulator,
  type ChampionAggregateContribution,
} from './champion/aggregate-accumulation';
export {
  computeAggregateKdaRatio,
  deriveChampionAggregateMetrics,
  type DeriveChampionAggregateMetricsOptions,
  type DerivedChampionAggregateMetrics,
} from './champion/aggregate-derivations';
export { resolveMatchEndedAt } from './champion/match-end-timestamp';
