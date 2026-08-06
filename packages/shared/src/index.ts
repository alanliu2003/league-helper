export { PRODUCT_NAME, RIOT_LEGAL_NOTICE } from './constants';

export {
  HealthResponseSchema,
  ProviderModeSchema,
  createHealthResponse,
  type HealthResponse,
  type ProviderMode,
} from './health';

export { ProviderIdSchema, PROVIDER_IDS, type ProviderId } from './provider-id';

export {
  DomainError,
  DomainErrorCodeSchema,
  InvalidRiotIdError,
  UnsupportedPlatformRouteError,
  InvalidRegionalRouteError,
  ValidationFailureError,
  ProviderNotConfiguredError,
  ProviderUnauthorizedError,
  ProviderForbiddenError,
  ProviderResponseInvalidError,
  ResourceNotFoundError,
  ProviderRateLimitedError,
  ProviderUnavailableError,
  AccountIdentityConflictError,
  RefreshInProgressError,
  RefreshCooldownError,
  QueueUnavailableError,
  DatabaseUnavailableError,
  InvalidCursorError,
  ChampionNotFoundError,
  ChampionStatsPositionRequiredError,
  ChampionStatsInvalidFilterError,
  serializeDomainError,
  ApiErrorResponseSchema,
  type DomainErrorCode,
  type ApiErrorResponse,
} from './errors';

export {
  RiotIdSchema,
  parseRiotId,
  formatRiotId,
  RIOT_GAME_NAME_MAX_LENGTH,
  RIOT_TAG_LINE_MAX_LENGTH,
  type RiotId,
} from './riot-id';

export {
  PLATFORM_ROUTES,
  REGIONAL_ROUTES,
  EXCLUDED_PLATFORM_ALIASES,
  PlatformRouteSchema,
  RegionalRouteSchema,
  parsePlatformRoute,
  parseRegionalRoute,
  getRegionalRouteForPlatform,
  getPlatformDisplayName,
  listSupportedPlatforms,
  getPlatformToRegionalMap,
  getRoutingKindForEndpointCategory,
  requiresPlatformRouting,
  requiresRegionalRouting,
  getPlatformApiHost,
  getRegionalApiHost,
  getApiHostForEndpointCategory,
  type PlatformRoute,
  type RegionalRoute,
  type RiotEndpointCategory,
} from './routing';

export { RankTierSchema, RankDivisionSchema, type RankTier, type RankDivision } from './ranks';

export { QueueTypeSchema, type QueueType } from './queues';

export {
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  NORMAL_DRAFT_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  ARAM_QUEUE_ID,
  ARENA_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
  CUSTOM_QUEUE_ID,
  MATCH_QUEUE_LABELS,
  PlayerMatchQueueCategorySchema,
  getMatchQueueLabel,
  resolveMatchQueueCategoryFilter,
  supportsStandardPositions,
  type PlayerMatchQueueCategory,
} from './match-queues';

export { TeamPositionSchema, type TeamPosition } from './positions';

export {
  NormalizedPositionSchema,
  normalizeParticipantPosition,
  getNormalizedPositionLabel,
  legacyBuggyPublicRole,
  type NormalizedPosition,
  type NormalizeParticipantPositionInput,
} from './normalized-position';

export { PatchVersionSchema, parsePatchVersion, type PatchVersion } from './patch';

export {
  PlayerAccountSchema,
  RankedEntrySchema,
  type PlayerAccount,
  type RankedEntry,
} from './player';

export {
  MatchParticipantSchema,
  MatchSummarySchema,
  type MatchParticipant,
  type MatchSummary,
} from './match';

export { ChampionMasterySchema, type ChampionMastery } from './mastery';

export {
  ApiSuccessResponseSchema,
  createApiSuccessResponse,
  PaginatedResponseSchema,
  PaginationQuerySchema,
  createPaginatedResponse,
  type ApiSuccessResponse,
  type PaginatedResponse,
  type PaginationQuery,
} from './api';

export type { GameDataProvider } from './provider';

export {
  MATCH_INGESTION_QUEUE_NAME,
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_NORMALIZATION_VERSION,
  MatchIngestionJobPayloadSchema,
  MatchIngestionJobTypeSchema,
  buildMatchIngestionIdempotencyKey,
  buildMatchIngestionBullMqJobId,
  CHAMPION_AGGREGATION_QUEUE_NAME,
  CHAMPION_AGGREGATION_JOB_NAME,
  ChampionAggregationJobPayloadSchema,
  ChampionAggregationJobTypeSchema,
  buildChampionAggregationBullMqJobId,
  BULLMQ_DEFAULT_PREFIX,
  parseBullMqRedisConnectionInfo,
  createBullMqConnectionOptions,
  resolveBullMqPrefix,
  type MatchIngestionQueueName,
  type MatchIngestionJobName,
  type MatchIngestionJobPayload,
  type MatchIngestionJobType,
  type ChampionAggregationQueueName,
  type ChampionAggregationJobName,
  type ChampionAggregationJobPayload,
  type ChampionAggregationJobType,
  type BullMqRedisConnectionInfo,
} from './job-queues';

export {
  serializeChampionStatsGenerationScope,
  buildChampionStatsGenerationKey,
  buildChampionStatsTableCacheKey,
  buildChampionStatsChampionCacheKey,
  buildChampionStatsFiltersCacheKey,
  type ChampionStatsGenerationScope,
  type ChampionStatsTableCacheKeyInput,
  type ChampionStatsChampionCacheKeyInput,
  type ChampionStatsFiltersCacheKeyInput,
} from './champion-stats-cache';

export {
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  CHAMPION_STATS_FILTER_QUEUE_IDS,
  ChampionRankingPositionSchema,
  SampleConfidenceSchema,
  ConfidenceIntervalSchema,
  ChampionStatsFreshnessSchema,
  ChampionStatsEmptyReasonSchema,
  SampleScopeSchema,
  ChampionStatsTierFilterSchema,
  AggregateDimensionsSchema,
  ChampionSummarySchema,
  ChampionDetailSchema,
  ChampionAggregateMetricsSchema,
  ChampionAggregateRowSchema,
  ChampionStatsSortBySchema,
  ChampionStatsSortDirectionSchema,
  ChampionStatsTableQuerySchema,
  ChampionStatsQuerySchema,
  ChampionStatsResolvedFiltersSchema,
  ChampionStatsRequestedFiltersSchema,
  ChampionStatsEnvelopeMetaSchema,
  ChampionStatsPaginationSchema,
  ChampionStatsTableResponseSchema,
  ChampionPositionBreakdownEntrySchema,
  ChampionExactStatsSchema,
  ChampionStatsResponseSchema,
  ChampionListResponseSchema,
  ChampionDetailResponseSchema,
  ChampionStatsFilterQueueSchema,
  ChampionStatsFiltersResponseSchema,
  buildChampionStatsFilterQueue,
  type ChampionRankingPosition,
  type SampleConfidence,
  type ConfidenceInterval,
  type ChampionStatsFreshness,
  type ChampionStatsEmptyReason,
  type SampleScope,
  type ChampionStatsTierFilter,
  type AggregateDimensions,
  type ChampionSummary,
  type ChampionDetail,
  type ChampionAggregateMetrics,
  type ChampionAggregateRow,
  type ChampionStatsSortBy,
  type ChampionStatsSortDirection,
  type ChampionStatsTableQuery,
  type ChampionStatsQuery,
  type ChampionStatsResolvedFilters,
  type ChampionStatsRequestedFilters,
  type ChampionStatsPagination,
  type ChampionStatsTableResponse,
  type ChampionPositionBreakdownEntry,
  type ChampionExactStats,
  type ChampionStatsResponse,
  type ChampionListResponse,
  type ChampionDetailResponse,
  type ChampionStatsFilterQueue,
  type ChampionStatsFiltersResponse,
} from './champion-api';

export {
  PlayerRefreshStateSchema,
  PlayerSafeWarningSchema,
  PublicPlayerSchema,
  PublicRankSummarySchema,
  PublicMasterySummarySchema,
  PublicMatchIngestionStatusSchema,
  PublicMatchSummarySchema,
  PlayerRefreshStatusSchema,
  PlayerSearchResponseSchema,
  PlayerProfileResponseSchema,
  PlayerSearchRequestSchema,
  PlayerRefreshRequestSchema,
  PlayerRanksQuerySchema,
  PlayerMasteryQuerySchema,
  PlayerMatchesQuerySchema,
  CursorPageSchema,
  type PlayerRefreshState,
  type PlayerSafeWarning,
  type PublicPlayer,
  type PublicRankSummary,
  type PublicMasterySummary,
  type PublicMatchIngestionStatus,
  type PublicMatchSummary,
  type PlayerRefreshStatus,
  type PlayerSearchResponse,
  type PlayerProfileResponse,
  type PlayerSearchRequest,
  type PlayerRefreshRequest,
  type PlayerRanksQuery,
  type PlayerMasteryQuery,
  type PlayerMatchesQuery,
} from './player-api';
