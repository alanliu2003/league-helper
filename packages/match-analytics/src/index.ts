export { MatchAnalyticsValidationError } from './errors';
export { safeDivide } from './statistics/safe-math';
export {
  classifySampleConfidence,
  DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
  type SampleConfidence,
  type SampleConfidenceThresholds,
} from './statistics/sample-confidence';
export { wilsonScoreInterval, type WilsonScoreInterval } from './statistics/wilson-interval';

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

export {
  BUILD_SOURCE_COMPLETE,
  BUILD_SOURCE_PARTIAL,
  assessBuildSourceEligibility,
  type BuildParticipantSource,
  type BuildSourceCompleteness,
  type BuildSourceEligibility,
  type BuildTimelineEventInput,
} from './builds/eligibility';
export {
  reconstructItemInventory,
  toItemTimelineEvents,
  type ItemTimelineEvent,
  type ReconstructItemInventoryOptions,
} from './builds/item-reconstruction';
export {
  COMPLETED_MAJOR_GOLD_FLOOR,
  classifyItem,
  goldTotalFromGoldData,
  type ItemKind,
  type ItemStaticClassificationInput,
} from './builds/item-classification';
export {
  STARTING_ITEMS_CUTOFF_MS,
  deriveStartingItemIds,
  startingItemsFromSourceEvents,
  startingItemsSignature,
} from './builds/starting-items';
export {
  CORE_BUILD_MAX_ITEMS,
  bootsSignature,
  coreBuildSignature,
  deriveBootsItemId,
  deriveCoreBuildItemIds,
  isCoreBuildEligible,
  isQualifyingCoreItem,
  listCoreItemCompletions,
  normalizeFinalItemIds,
} from './builds/item-builds';
export {
  canonicalizeSummonerSpellPair,
  type CanonicalSummonerSpellPair,
} from './builds/spell-pair';
export {
  CANONICAL_SKILL_PRIORITY_SIGNATURES,
  SKILL_SLOT_KEYS,
  deriveFirstLearnedBasicOrder,
  deriveSkillPriority,
  deriveSkillSequence,
  isSkillPriorityEligible,
  resolveSkillLevelSlots,
  skillSlotToKey,
  skillSlotsFromTimeline,
  type AbilityMaxOrder,
  type BasicSkillKey,
  type SkillKey,
  type SkillPriority,
  type SkillPrioritySignature,
  type SkillSequence,
} from './builds/skill-order';
export { deriveRunePage, type DerivedRunePage, type RunePageInput } from './builds/rune-page';
export {
  BUILD_DISPLAY_CREDIBLE_MIN,
  BUILD_DISPLAY_EXPLORATORY_MIN,
  BUILD_DISPLAY_STRONG_MIN,
  classifyBuildSampleDisplay,
  type BuildSampleBand,
  type BuildSampleDisplay,
} from './builds/sample-policy';
export {
  emptyBuildTotals,
  mergeBuildAggregateTotals,
  pickRate,
  winRate,
  type MergeableBuildTotals,
} from './builds/aggregate-merge';
export {
  CHAMPION_BUILD_CATEGORIES,
  DEFAULT_BUILD_AGGREGATION_VERSION,
  type ChampionBuildCategory,
} from './builds/categories';
export {
  deriveParticipantBuildContributions,
  type BuildContribution,
} from './builds/contributions';

export {
  RELIABLE_LANE_POSITIONS,
  RELIABLE_LANE_POSITION_SET,
  findUniqueSamePositionOpponent,
  pairLaneOpponents,
  type DirectionalMatchupObservation,
  type LanePairSkipReason,
  type LanePairableParticipant,
  type LanePairingResult,
  type ReliableLanePosition,
  type UndirectedLanePair,
} from './matchups/pairing';
export {
  DEFAULT_MATCHUP_AGGREGATION_VERSION,
  MATCHUP_DISPLAY_FLOOR,
  MATCHUP_DISPLAY_LIMITED_MAX,
  MATCHUP_DISPLAY_MODERATE_MAX,
  MATCHUP_RANKING_POLICY,
  MATCHUP_RANKING_TOP_N,
  MATCHUP_SAMPLE_CONFIDENCE_THRESHOLDS,
  type MatchupRankingPolicy,
} from './matchups/policy';
export { expandMatchupRankTiers, subjectFeedsMatchupRankTier } from './matchups/rank-keys';
export {
  buildMatchupAggregateDimensionKey,
  type MatchupAggregateDimensions,
} from './matchups/keys';
export {
  accumulateMatchupContribution,
  combineMatchupAccumulators,
  emptyMatchupAccumulator,
  type MatchupAggregateAccumulator,
  type MatchupContribution,
} from './matchups/accumulation';
export { deriveMatchupMetrics, type DerivedMatchupMetrics } from './matchups/derivations';
export {
  rankStrongAndWeakMatchups,
  type RankableMatchupRow,
  type RankedMatchupLists,
} from './matchups/ranking';
export { mergeMatchupAccumulatorsByOpponent } from './matchups/merge';

export {
  PLAYER_PLAYSTYLE_CREDIBLE_MIN,
  PLAYER_PLAYSTYLE_EXPLORATORY_MIN,
  PLAYER_PLAYSTYLE_STRONG_MIN,
  classifyPlayerPlaystyleSampleBand,
} from './player-playstyle/sample-policy';
export {
  PLAYER_METRIC_NEAR_BANDS,
  classifyMetricDirection,
  type PlayerPlaystyleComparableDirection,
} from './player-playstyle/comparison';
