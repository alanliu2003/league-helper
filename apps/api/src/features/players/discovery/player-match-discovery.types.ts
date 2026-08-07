export type PlayerMatchDiscoveryRiotIdInput = {
  mode: 'RIOT_ID';
  gameName: string;
  tagLine: string;
  platform: string;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  correlationId: string;
};

export type PlayerMatchDiscoveryAccountInput = {
  mode: 'PLAYER_ACCOUNT';
  playerAccountId: string;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  correlationId: string;
  /** Population collector run attribution; omitted for bootstrap/search. */
  sourceCollectorRunId?: string;
};

export type PlayerMatchDiscoveryInput =
  | PlayerMatchDiscoveryRiotIdInput
  | PlayerMatchDiscoveryAccountInput;

/** Per-call overrides (e.g. CLI MATCH_BOOTSTRAP_PAGE_SIZE) without Nest boot coupling. */
export type PlayerMatchDiscoveryCallOptions = {
  pageSize?: number;
};

export type PlayerMatchDiscoveryResult = {
  ok: boolean;
  playerAccountId?: string;
  /** Present with playerAccountId after a resolved/upserted account (collector-agnostic). */
  provider?: string;
  platformRoute?: string;
  discoveredMatchCount: number;
  enqueuedCount: number;
  skippedAlreadyCompleteCount: number;
  externalMatchIds: string[];
  warnings: Array<{ code: string; message: string }>;
  normalizedFailureCode?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
};
