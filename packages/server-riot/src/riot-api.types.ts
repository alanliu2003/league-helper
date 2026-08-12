import type { PlatformRoute, RegionalRoute } from '@league-helper/shared';

export type RiotRoutingKind = 'platform' | 'regional';

export type RiotEndpointCategory =
  'account-v1' | 'summoner-v4' | 'league-v4' | 'match-v5' | 'champion-mastery-v4';

export type RiotRequestRoute =
  | { kind: 'platform'; platform: PlatformRoute }
  | { kind: 'regional'; regionalRoute: RegionalRoute };

export type RiotHttpMethod = 'GET';

export type RiotRequestWorkloadHint =
  | 'match'
  | 'refresh'
  | 'enrichment'
  | 'ladder'
  | 'identity'
  | 'product'
  | 'unknown';

export type RiotRequestOptions = {
  method?: RiotHttpMethod;
  category: RiotEndpointCategory;
  route: RiotRequestRoute;
  path: string;
  query?: Record<string, string | number | undefined>;
  correlationId?: string;
  /** Resource hint used for safer 404 messaging. */
  resourceHint?: 'account' | 'summoner' | 'match' | 'timeline' | 'mastery' | 'ranked' | 'match-ids';
  /**
   * Optional proactive budget workload tag. When omitted, AsyncLocalStorage
   * context or a category default is used.
   */
  workload?: RiotRequestWorkloadHint;
};

export type RiotRateLimitWindow = {
  requests: number;
  windowSeconds: number;
};

export type RiotRateLimitSnapshot = {
  appRateLimit: RiotRateLimitWindow[] | null;
  appRateLimitCount: RiotRateLimitWindow[] | null;
  methodRateLimit: RiotRateLimitWindow[] | null;
  methodRateLimitCount: RiotRateLimitWindow[] | null;
  rateLimitType: string | null;
  retryAfterSeconds: number | null;
};

export type RiotResponseMetadata = {
  correlationId: string;
  riotRequestId: string | null;
  httpStatus: number;
  durationMs: number;
  routeLabel: string;
  category: RiotEndpointCategory;
  rateLimit: RiotRateLimitSnapshot;
  attempt: number;
};

export type RiotHttpResult<T> = {
  data: T;
  metadata: RiotResponseMetadata;
};

export type SleepFn = (ms: number) => Promise<void>;
export type RandomFn = () => number;
export type FetchFn = typeof fetch;
