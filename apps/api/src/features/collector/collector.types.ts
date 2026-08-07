import type { CollectorRunStatus, TrackedPlayerEnrollmentSource, TrackedPlayerStatus } from '@prisma/client';
import type { CollectorConfig } from './collector.config';

export type CollectorProvider = 'RIOT';

export const COLLECTOR_PROVIDER: CollectorProvider = 'RIOT';

export type CollectorSeedPlayerTarget = {
  gameName: string;
  tagLine: string;
  platform: string;
  priority?: number;
};

export type CollectorEnrollmentInput = {
  account: {
    id: string;
    provider: string;
    platformRoute: string;
  };
  source: TrackedPlayerEnrollmentSource;
  /** Clamp into config priority range. Default 0 on create. */
  priority?: number;
  /** Explicitly reactivate PAUSED/SUSPENDED to ACTIVE. */
  reactivate?: boolean;
};

export type CollectorEnrollmentResult =
  | {
      ok: true;
      trackedPlayerId: string;
      playerAccountId: string;
      status: TrackedPlayerStatus;
      enrollmentSource: TrackedPlayerEnrollmentSource;
      created: boolean;
      reactivated: boolean;
      platformRoute: string;
    }
  | {
      ok: false;
      playerAccountId: string;
      code: 'UNSUPPORTED_PLATFORM';
      message: string;
      platformRoute: string;
    };

export type CollectorSetStatusInput = {
  trackedPlayerId: string;
  status: TrackedPlayerStatus;
  force?: boolean;
  resetFailures?: boolean;
};

export type CollectorSetStatusResult =
  | {
      ok: true;
      trackedPlayerId: string;
      status: TrackedPlayerStatus;
      leaseCleared: boolean;
      failuresReset: boolean;
    }
  | {
      ok: false;
      code: 'TRACKED_PLAYER_NOT_FOUND';
      message: string;
      trackedPlayerId: string;
    };

export type CollectorPreviewSampleDiscovery = {
  trackedPlayerId: string;
  playerAccountId: string;
  platformRoute: string;
  discoveredMatchCount: number;
  /** Advisory upper-bound estimate (no enqueue classification). */
  wouldEnqueueCount: number;
};

export type CollectorPreviewInput = {
  platformFilter?: string | null;
  queueId: number;
  /** Cap candidate list length (defaults to batchSize). */
  candidateLimit?: number;
  /** When set, run read-only paginateRecentMatchIds for first N candidates. */
  sampleDiscovery?: number;
  /** Per-sample max matches (defaults to config.matchesPerPlayer). */
  maxMatches?: number;
};

export type CollectorPreviewResult = {
  eligibleCount: number;
  effectivePlatforms: string[];
  queueId: number;
  candidates: Array<{
    trackedPlayerId: string;
    playerAccountId: string;
    platformRoute: string;
    priority: number;
    nextEligibleAt: Date;
    lastSuccessfulRefreshAt: Date | null;
  }>;
  sampleDiscovery?: CollectorPreviewSampleDiscovery[];
};

export type CollectorRunOnceInput = {
  platformFilter?: string | null;
  queueId: number;
  batchLimit: number;
  concurrency: number;
  matchesPerPlayer: number;
  maxMatchIdsPerRun: number;
  maxEnqueuePerRun: number;
  /** Optional override; defaults come from injected CollectorConfig. */
  config?: Partial<
    Pick<
      CollectorConfig,
      | 'minRefreshIntervalMs'
      | 'baseBackoffMs'
      | 'maxBackoffMs'
      | 'maxBackoffExponent'
      | 'playerTimeoutMs'
      | 'leaseDurationMs'
      | 'platformAllowlist'
    >
  >;
};

export type CollectorRunCounters = {
  playersClaimed: number;
  playersAttempted: number;
  playersSucceeded: number;
  playersFailed: number;
  ownershipLost: number;
  matchIdsDiscovered: number;
  matchesEnqueued: number;
  matchesSkippedComplete: number;
  rateLimitStops: number;
  budgetExhausted: boolean;
  failureCode?: string | null;
};

export type CollectorRunOnceResult = {
  runId: string;
  ownerToken: string;
  status: Exclude<CollectorRunStatus, 'RUNNING'>;
  effectivePlatforms: string[];
  queueId: number;
  batchLimit: number;
  concurrency: number;
  counters: CollectorRunCounters;
  durationMs: number;
};

export type CollectorSeedCliArgs = {
  mode: 'single' | 'file';
  players: CollectorSeedPlayerTarget[];
  filePath?: string;
  concurrency: number;
  reactivate: boolean;
  json: boolean;
};

export type CollectorSetStatusCliArgs = {
  trackedPlayerId: string;
  status: TrackedPlayerStatus;
  force: boolean;
  resetFailures: boolean;
  json: boolean;
};

export type CollectorRunCliArgs = {
  dryRun: boolean;
  sampleDiscovery?: number;
  platformFilter?: string;
  queueId: number;
  batchSize: number;
  concurrency: number;
  maxMatches: number;
  maxMatchIds: number;
  maxEnqueue: number;
  json: boolean;
};

export type CoverageSnapshotStatus = 'available' | 'unavailable' | 'partial';

export type CollectorCoveragePosition = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'SUPPORT';

export type CollectorCoveragePositionSummary = {
  position: CollectorCoveragePosition;
  maxSampleSize: number;
  keysWithSampleGtZero: number;
  keysAtOrAboveFloor: number;
  keysInNearFloorBand: number;
};

export type CollectorCoveragePlatformSummary = {
  platform: string;
  patch: string | null;
  positions: CollectorCoveragePositionSummary[];
  matchCountsByNormalizedPatch: Array<{ patch: string | null; count: number }>;
};

export type CollectorCoverageSnapshot = {
  status: CoverageSnapshotStatus;
  /** DB snapshot only — not causal run attribution. */
  label: 'db_snapshot';
  queueId: number;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  minimumSample: number;
  nearFloorBand: { min: number; max: number };
  platforms: CollectorCoveragePlatformSummary[];
  warning?: string;
};

export type CollectorCoverageSnapshotInput = {
  effectivePlatforms: string[];
  queueId: number;
};

export type CollectorStatusCliArgs = {
  platformFilter?: string;
  queueId: number;
  json: boolean;
  help: boolean;
};

export type CollectorAuditCliArgs = {
  json: boolean;
  help: boolean;
};

export type CollectorStatusRunSummary = {
  runId: string;
  status: CollectorRunStatus;
  startedAt: string;
  finishedAt: string | null;
  effectivePlatforms: string[];
  queueId: number;
  counters: CollectorRunCounters;
  failureCode: string | null;
};

export type CollectorStatusTrackedPopulation = {
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
  byEnrollmentSource: Record<string, number>;
  eligibleNow: number;
  activelyLeased: number;
  expiredLeases: number;
  nextEligibleAt: string | null;
  recentFailureCodes: Array<{ code: string; count: number }>;
};

export type CollectorStatusReport = {
  ok: true;
  mode: 'status';
  generatedAt: string;
  /** Discovery/enqueue orchestration snapshot — not ingestion/aggregation completion. */
  label: 'discovery_enqueue_orchestration';
  config: {
    staleRunAfterMs: number;
    leaseDurationMs: number;
    platformAllowlist: string[];
  };
  runState: {
    activeRunning: CollectorStatusRunSummary[];
    staleRunning: CollectorStatusRunSummary[];
    recentFinalized: CollectorStatusRunSummary[];
  };
  trackedPopulation: CollectorStatusTrackedPopulation;
  coverage: CollectorCoverageSnapshot | null;
  warnings: string[];
};

export type CollectorAuditSeverity = 'error' | 'warning' | 'info';

export type CollectorAuditFindingCode =
  | 'DUPLICATE_TRACKED_PLAYER_IDENTITY'
  | 'ORPHAN_LEASE_OWNER'
  | 'STALE_RUNNING_COLLECTOR_RUN'
  | 'FINALIZED_COUNTER_MISMATCH'
  | 'PLAYERS_ATTEMPTED_EXCEEDS_CLAIMED'
  | 'MATCHES_ENQUEUED_EXCEEDS_DISCOVERED'
  | 'MATCHES_SKIPPED_COMPLETE_EXCEEDS_DISCOVERED'
  | 'FINALIZED_RUN_MISSING_FINISHED_AT'
  | 'ACTIVE_LEASE_UNSUPPORTED_PLATFORM'
  | 'DENORMALIZED_PROVIDER_MISMATCH'
  | 'DENORMALIZED_PLATFORM_ROUTE_MISMATCH'
  | 'LEFTOVER_LEASE_FINALIZED_OWNER'
  | 'UNSAFE_TIMING_CONFIG';

export type CollectorAuditFinding = {
  code: CollectorAuditFindingCode;
  severity: CollectorAuditSeverity;
  /** trackedPlayerId / collectorRunId / ownerToken prefix — never puuid. */
  safeId: string;
  message: string;
};

export type CollectorAuditReport = {
  ok: boolean;
  mode: 'audit';
  generatedAt: string;
  /** Read-only invariant checks for discovery/enqueue orchestration. */
  label: 'discovery_enqueue_orchestration';
  findingCount: number;
  findings: CollectorAuditFinding[];
};
