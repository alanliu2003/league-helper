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
