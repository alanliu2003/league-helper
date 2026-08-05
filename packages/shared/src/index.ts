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

export { TeamPositionSchema, type TeamPosition } from './positions';

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
  type MatchIngestionQueueName,
  type MatchIngestionJobName,
  type MatchIngestionJobPayload,
  type MatchIngestionJobType,
} from './job-queues';

export {
  PlayerRefreshStateSchema,
  PlayerSafeWarningSchema,
  PublicPlayerSchema,
  PublicRankSummarySchema,
  PublicMasterySummarySchema,
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
