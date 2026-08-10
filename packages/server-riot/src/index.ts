export {
  loadRiotConfig,
  requireRiotApiKey,
  isRiotProviderConfigured,
  type RiotConfig,
  type RiotProviderMode,
} from './riot.config';

export { RiotApiClient, type RiotApiClientDependencies } from './riot-api.client';

export { RiotGameDataProvider } from './riot-game-data.provider';
export { MockRiotGameDataProvider } from './mock-riot-game-data.provider';

export { createConsoleRiotLogger, type RiotLogger } from './riot-logger';

export {
  redactSensitiveText,
  assertNoSecretLeak,
  mapHttpStatusToProviderError,
  mapTransportErrorToProviderError,
  createResponseValidationError,
} from './riot-api.errors';

export type {
  RiotRoutingKind,
  RiotEndpointCategory,
  RiotRequestRoute,
  RiotHttpMethod,
  RiotRequestOptions,
  RiotRateLimitWindow,
  RiotRateLimitSnapshot,
  RiotResponseMetadata,
  RiotHttpResult,
  SleepFn,
  RandomFn,
  FetchFn,
} from './riot-api.types';

export {
  RiotAccountDtoSchema,
  RiotSummonerDtoSchema,
  RiotMiniSeriesDtoSchema,
  RiotLeagueEntryDtoSchema,
  RiotLeagueEntryDtoArraySchema,
  RiotLeagueItemDtoSchema,
  RiotLeagueListDtoSchema,
  RiotMatchIdListSchema,
  RiotMatchMetadataDtoSchema,
  RiotMatchParticipantDtoSchema,
  RiotMatchObjectiveDtoSchema,
  RiotMatchTeamDtoSchema,
  RiotMatchInfoDtoSchema,
  RiotMatchDtoSchema,
  RiotParticipantFrameDtoSchema,
  RiotTimelineEventDtoSchema,
  RiotTimelineFrameDtoSchema,
  RiotMatchTimelineDtoSchema,
  RiotChampionMasteryDtoSchema,
  RiotChampionMasteryDtoArraySchema,
  RiotStatusErrorBodySchema,
  type RiotAccountDto,
  type RiotSummonerDto,
  type RiotMiniSeriesDto,
  type RiotLeagueEntryDto,
  type RiotLeagueItemDto,
  type RiotLeagueListDto,
  type RiotMatchMetadataDto,
  type RiotMatchParticipantDto,
  type RiotMatchObjectiveDto,
  type RiotMatchTeamDto,
  type RiotMatchInfoDto,
  type RiotMatchDto,
  type RiotParticipantFrameDto,
  type RiotTimelineEventDto,
  type RiotTimelineFrameDto,
  type RiotMatchTimelineDto,
  type RiotChampionMasteryDto,
} from './riot-api.schemas';

export {
  RIOT_LEAGUE_QUEUE_RANKED_SOLO,
  RiotLeagueQueueTypeSchema,
  RiotPaginatedLeagueTierSchema,
  buildApexLeaguePath,
  buildLeagueEntriesByTierDivisionPath,
  mapLeagueEntriesToLadderCandidates,
  mapLeagueListToLadderCandidates,
  mapRiotLeagueQueueTypeToMatchQueueId,
  parseRiotLeagueQueueType,
  type ApexLeagueKind,
  type LadderAcquisitionMode,
  type LadderCandidate,
  type LadderCandidatesResult,
  type LadderEntriesPageResult,
  type RiotLeagueQueueType,
  type RiotPaginatedLeagueTier,
} from './riot-league-ladder';

export {
  isRetryableHttpStatus,
  isRetryableTransportError,
  computeRetryDelayMs,
  decideRetry,
  sleep,
  type RetryDecision,
  type RetryPolicyOptions,
} from './riot-retry';

export {
  parseRiotRateLimitHeader,
  parseRetryAfterSeconds,
  parseRiotRateLimitSnapshot,
} from './riot-rate-limit';

export {
  RIOT_SHARED_429_COOLDOWN_REDIS_KEY,
  DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
  RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
  EXTEND_SHARED_COOLDOWN_LUA,
  computeEffectiveCooldownDurationMs,
  computeProposedCooldownUntil,
  isSharedCooldownActive,
  sharedCooldownRemainingMs,
  RiotSharedCooldownStore,
  type SharedCooldownRedisClient,
  type RiotSharedCooldownState,
  type ExtendSharedCooldownInput,
  type ExtendSharedCooldownResult,
  type RiotSharedCooldownStoreOptions,
} from './riot-shared-cooldown';

export { createRiotResponseMetadata } from './riot-response-metadata';

export {
  FAKE_PUUID,
  FAKE_SUMMONER_ID,
  FAKE_ACCOUNT_ID,
  FAKE_MATCH_IDS,
  mockAccountDto,
  mockSummonerDto,
  mockSummonerDtoWithoutIds,
  mockLeagueEntriesDto,
  mockEmptyLeagueEntriesDto,
  mockChallengerLeagueListDto,
  mockGrandmasterLeagueListDto,
  mockMasterLeagueListDto,
  mockLeagueEntriesPageDto,
  mockMatchIdList,
  mockMatchDto,
  mockTimelineDto,
  mockChampionMasteryDtoList,
  mockRankedEntries,
  mockChampionMasteryList,
  mockHttpErrorBodies,
} from './fixtures';

export {
  createMockFetch,
  realConfigOverrides,
  type MockFetchCall,
  type MockFetchResponse,
} from './test-utils/mock-fetch';
