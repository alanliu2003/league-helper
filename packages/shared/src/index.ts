export { PRODUCT_NAME, RIOT_LEGAL_NOTICE } from './constants';

export { HealthResponseSchema, createHealthResponse, type HealthResponse } from './health';

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
