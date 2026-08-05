import { z } from 'zod';
import {
  ARAM_QUEUE_ID,
  ARENA_QUEUE_ID,
  CUSTOM_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  NORMAL_DRAFT_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
  getMatchQueueLabel,
  supportsStandardPositions,
} from './match-queues';
import { RankTierSchema } from './ranks';
import { PlatformRouteSchema, RegionalRouteSchema } from './routing';

/**
 * Collected-sample disclaimer for champion stats response envelopes.
 * Never place this on individual aggregate rows.
 */
export const CHAMPION_STATS_DISCLAIMER =
  'Statistics are based on matches collected by League Helper. They do not represent all League matches.';

/**
 * Rank filter semantics for champion aggregates (ingestion-time tier, not match-time).
 */
export const RANK_TIER_SEMANTICS =
  'Known rank tier at ingestion; may not match rank when the match was played.';

/** Finite number helper — rejects NaN and ±Infinity. */
const FiniteNumberSchema = z.number().finite();

/** Exact positions allowed for directory ranking and single-champion position filter. */
export const ChampionRankingPositionSchema = z.enum([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'SUPPORT',
]);
export type ChampionRankingPosition = z.infer<typeof ChampionRankingPositionSchema>;

export const SampleConfidenceSchema = z.enum(['INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH']);
export type SampleConfidence = z.infer<typeof SampleConfidenceSchema>;

export const ConfidenceIntervalSchema = z.object({
  lowerBound: FiniteNumberSchema,
  upperBound: FiniteNumberSchema,
  confidenceLevel: FiniteNumberSchema,
});
export type ConfidenceInterval = z.infer<typeof ConfidenceIntervalSchema>;

export const ChampionStatsFreshnessSchema = z.enum([
  'CURRENT',
  'RECALCULATION_PENDING',
  'UNKNOWN',
]);
export type ChampionStatsFreshness = z.infer<typeof ChampionStatsFreshnessSchema>;

export const ChampionStatsEmptyReasonSchema = z.enum([
  'NO_MATCHING_AGGREGATES',
  'BELOW_MINIMUM_SAMPLE',
  'CHAMPION_HAS_NO_STATS',
  'FILTERS_EXCLUDED_ALL_ROWS',
]);
export type ChampionStatsEmptyReason = z.infer<typeof ChampionStatsEmptyReasonSchema>;

export const SampleScopeSchema = z.object({
  kind: z.literal('COLLECTED_SAMPLE'),
  platform: PlatformRouteSchema,
  patch: z.string().min(1),
  queueId: z.number().int().nonnegative(),
});
export type SampleScope = z.infer<typeof SampleScopeSchema>;

/** Tier filter: concrete rank, ALL rollup, or UNKNOWN ingestion tier. */
export const ChampionStatsTierFilterSchema = z.union([
  RankTierSchema,
  z.literal('ALL'),
  z.literal('UNKNOWN'),
]);
export type ChampionStatsTierFilter = z.infer<typeof ChampionStatsTierFilterSchema>;

/**
 * Aggregate storage / response dimensions.
 * Uses championId (numeric). championKey belongs on champion metadata, not dimensions.
 */
export const AggregateDimensionsSchema = z.object({
  championId: z.number().int(),
  patch: z.string().min(1),
  platform: PlatformRouteSchema,
  regionalRoute: RegionalRouteSchema,
  queueId: z.number().int().nonnegative(),
  rankTier: ChampionStatsTierFilterSchema,
  position: z.union([ChampionRankingPositionSchema, z.literal('ALL'), z.literal('UNKNOWN')]),
  sourceNormalizationVersion: z.string().min(1),
  aggregationVersion: z.string().min(1),
});
export type AggregateDimensions = z.infer<typeof AggregateDimensionsSchema>;

/**
 * Champion static metadata for public responses.
 * Omits passive/spells/baseStats: seed Json blobs are not a stable frontend-safe contract.
 */
export const ChampionSummarySchema = z.object({
  championId: z.number().int(),
  championKey: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()),
  iconUrl: z.string().url().nullable(),
  splashUrl: z.string().url().nullable().optional(),
  staticDataPatch: z.string().min(1).optional(),
  staticDataVersion: z.string().min(1).optional(),
});
export type ChampionSummary = z.infer<typeof ChampionSummarySchema>;

export const ChampionDetailSchema = ChampionSummarySchema.extend({
  canonicalChampionKey: z.string().min(1).optional(),
});
export type ChampionDetail = z.infer<typeof ChampionDetailSchema>;

export const ChampionAggregateMetricsSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: FiniteNumberSchema.nullable(),
  wilsonInterval: ConfidenceIntervalSchema.nullable(),
  sampleConfidence: SampleConfidenceSchema,
  aggregateKdaRatio: FiniteNumberSchema.nullable(),
  averageCsPerMinute: FiniteNumberSchema.nullable(),
  averageDamagePerMinute: FiniteNumberSchema.nullable(),
  averageVisionScorePerMinute: FiniteNumberSchema.nullable(),
  averageGoldDifferenceAt10: FiniteNumberSchema.nullable(),
  averageGoldDifferenceAt15: FiniteNumberSchema.nullable(),
  averageCsDifferenceAt10: FiniteNumberSchema.nullable(),
  averageCsDifferenceAt15: FiniteNumberSchema.nullable(),
  latestEligibleMatchAt: z.string().datetime().nullable(),
  calculatedAt: z.string().datetime().optional(),
});
export type ChampionAggregateMetrics = z.infer<typeof ChampionAggregateMetricsSchema>;

/** Per-row aggregate; disclaimer / freshness live on the response envelope only. */
export const ChampionAggregateRowSchema = z.object({
  champion: ChampionSummarySchema,
  dimensions: AggregateDimensionsSchema,
  metrics: ChampionAggregateMetricsSchema,
});
export type ChampionAggregateRow = z.infer<typeof ChampionAggregateRowSchema>;

export const ChampionStatsSortBySchema = z.enum([
  'winRate',
  'sampleSize',
  'aggregateKdaRatio',
  'averageCsPerMinute',
  'averageDamagePerMinute',
  'averageGoldDifferenceAt10',
  'averageCsDifferenceAt10',
  'championName',
]);
export type ChampionStatsSortBy = z.infer<typeof ChampionStatsSortBySchema>;

export const ChampionStatsSortDirectionSchema = z.enum(['asc', 'desc']);
export type ChampionStatsSortDirection = z.infer<typeof ChampionStatsSortDirectionSchema>;

const OptionalBooleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return value === 'true';
  });

/**
 * Ranking table query.
 *
 * Pagination contract (M8): opaque `cursor` is preferred for stable paging.
 * `offset` is also allowed for small tables. Providing both is rejected.
 */
export const ChampionStatsTableQuerySchema = z
  .object({
    position: ChampionRankingPositionSchema,
    platform: PlatformRouteSchema.optional(),
    patch: z.string().min(1).optional(),
    queueId: z.coerce.number().int().nonnegative().optional(),
    tier: ChampionStatsTierFilterSchema.optional().default('ALL'),
    minimumSample: z.coerce.number().int().nonnegative().optional(),
    includeInsufficient: OptionalBooleanQuerySchema,
    sortBy: ChampionStatsSortBySchema.optional().default('winRate'),
    sortDirection: ChampionStatsSortDirectionSchema.optional().default('desc'),
    limit: z.coerce.number().int().positive().max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.cursor !== undefined && value.offset !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either cursor or offset, not both.',
        path: ['cursor'],
      });
    }
  });
export type ChampionStatsTableQuery = z.infer<typeof ChampionStatsTableQuerySchema>;

/**
 * Single-champion stats query. Position omitted → metadata + five-role breakdown.
 */
export const ChampionStatsQuerySchema = z.object({
  platform: PlatformRouteSchema.optional(),
  patch: z.string().min(1).optional(),
  queueId: z.coerce.number().int().nonnegative().optional(),
  tier: ChampionStatsTierFilterSchema.optional().default('ALL'),
  position: ChampionRankingPositionSchema.optional(),
  minimumSample: z.coerce.number().int().nonnegative().optional(),
  includeInsufficient: OptionalBooleanQuerySchema,
});
export type ChampionStatsQuery = z.infer<typeof ChampionStatsQuerySchema>;

export const ChampionStatsResolvedFiltersSchema = z.object({
  platform: PlatformRouteSchema,
  patch: z.string().min(1),
  queueId: z.number().int().nonnegative(),
  tier: ChampionStatsTierFilterSchema,
  position: ChampionRankingPositionSchema.nullable(),
});
export type ChampionStatsResolvedFilters = z.infer<typeof ChampionStatsResolvedFiltersSchema>;

export const ChampionStatsRequestedFiltersSchema = z.object({
  platform: PlatformRouteSchema.optional(),
  patch: z.string().min(1).optional(),
  queueId: z.number().int().nonnegative().optional(),
  tier: ChampionStatsTierFilterSchema.optional(),
  position: ChampionRankingPositionSchema.optional(),
  minimumSample: z.number().int().nonnegative().optional(),
  includeInsufficient: z.boolean().optional(),
});
export type ChampionStatsRequestedFilters = z.infer<typeof ChampionStatsRequestedFiltersSchema>;

/**
 * Envelope metadata shared by table and single-champion stats responses.
 * Disclaimer / rank semantics / sampleScope / freshness are envelope-only.
 */
export const ChampionStatsEnvelopeMetaSchema = z.object({
  disclaimer: z.literal(CHAMPION_STATS_DISCLAIMER),
  rankTierSemantics: z.literal(RANK_TIER_SEMANTICS),
  sampleScope: SampleScopeSchema,
  freshness: ChampionStatsFreshnessSchema,
  requestedFilters: ChampionStatsRequestedFiltersSchema,
  resolvedFilters: ChampionStatsResolvedFiltersSchema,
  usedDefaultPlatform: z.boolean(),
  usedDefaultPatch: z.boolean(),
  effectiveMinimumSample: z.number().int().nonnegative(),
  sourceNormalizationVersion: z.string().min(1),
  aggregationVersion: z.string().min(1),
});

export const ChampionStatsPaginationSchema = z.object({
  nextCursor: z.string().nullable(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative().optional(),
  totalCount: z.number().int().nonnegative().optional(),
});
export type ChampionStatsPagination = z.infer<typeof ChampionStatsPaginationSchema>;

export const ChampionStatsTableResponseSchema = ChampionStatsEnvelopeMetaSchema.extend({
  rows: z.array(ChampionAggregateRowSchema),
  emptyReason: ChampionStatsEmptyReasonSchema.optional(),
  pagination: ChampionStatsPaginationSchema,
});
export type ChampionStatsTableResponse = z.infer<typeof ChampionStatsTableResponseSchema>;

export const ChampionPositionBreakdownEntrySchema = z.object({
  position: ChampionRankingPositionSchema,
  dimensions: AggregateDimensionsSchema.nullable(),
  metrics: ChampionAggregateMetricsSchema.nullable(),
});
export type ChampionPositionBreakdownEntry = z.infer<typeof ChampionPositionBreakdownEntrySchema>;

/** Exact stats for one champion; distinct from table rows (no nested champion summary). */
export const ChampionExactStatsSchema = z.object({
  dimensions: AggregateDimensionsSchema,
  metrics: ChampionAggregateMetricsSchema,
});
export type ChampionExactStats = z.infer<typeof ChampionExactStatsSchema>;

export const ChampionStatsResponseSchema = ChampionStatsEnvelopeMetaSchema.extend({
  champion: ChampionDetailSchema,
  stats: ChampionExactStatsSchema.nullable(),
  emptyReason: ChampionStatsEmptyReasonSchema.optional(),
  positionBreakdown: z.array(ChampionPositionBreakdownEntrySchema),
});
export type ChampionStatsResponse = z.infer<typeof ChampionStatsResponseSchema>;

export const ChampionListResponseSchema = z.object({
  champions: z.array(ChampionSummarySchema),
  staticDataPatch: z.string().min(1).optional(),
  staticDataVersion: z.string().min(1).optional(),
});
export type ChampionListResponse = z.infer<typeof ChampionListResponseSchema>;

export const ChampionDetailResponseSchema = z.object({
  champion: ChampionDetailSchema,
  staticDataPatch: z.string().min(1).optional(),
  staticDataVersion: z.string().min(1).optional(),
});
export type ChampionDetailResponse = z.infer<typeof ChampionDetailResponseSchema>;

export const ChampionStatsFilterQueueSchema = z.object({
  queueId: z.number().int().nonnegative(),
  label: z.string().min(1),
  supportsStandardPositions: z.boolean(),
});
export type ChampionStatsFilterQueue = z.infer<typeof ChampionStatsFilterQueueSchema>;

export const ChampionStatsFiltersResponseSchema = z.object({
  disclaimer: z.literal(CHAMPION_STATS_DISCLAIMER),
  rankTierSemantics: z.literal(RANK_TIER_SEMANTICS),
  defaultPlatform: PlatformRouteSchema,
  defaultQueueId: z.number().int().nonnegative(),
  defaultPatch: z.string().min(1).nullable(),
  availablePlatforms: z.array(PlatformRouteSchema),
  availablePatches: z.array(z.string().min(1)),
  availableQueues: z.array(ChampionStatsFilterQueueSchema),
  availableTiers: z.array(ChampionStatsTierFilterSchema),
  availablePositions: z.array(ChampionRankingPositionSchema),
  sourceNormalizationVersion: z.string().min(1),
  aggregationVersion: z.string().min(1),
  sampleScope: SampleScopeSchema.optional(),
});
export type ChampionStatsFiltersResponse = z.infer<typeof ChampionStatsFiltersResponseSchema>;

/** Convenience builder for filter queue metadata using shared queue labels. */
export function buildChampionStatsFilterQueue(queueId: number): ChampionStatsFilterQueue {
  return ChampionStatsFilterQueueSchema.parse({
    queueId,
    label: getMatchQueueLabel(queueId),
    supportsStandardPositions: supportsStandardPositions(queueId),
  });
}

/** Queue IDs commonly offered in champion-stats filters (SR-focused + known modes). */
export const CHAMPION_STATS_FILTER_QUEUE_IDS = [
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  NORMAL_DRAFT_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
  ARAM_QUEUE_ID,
  ARENA_QUEUE_ID,
  CUSTOM_QUEUE_ID,
] as const;
