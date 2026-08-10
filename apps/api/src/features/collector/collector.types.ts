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
  /**
   * Proposed discovery depth. Explicit seed/search/bootstrap omit this and default to 0.
   * UPDATE applies LEAST(existing, proposed); never increases depth.
   */
  discoveryDepth?: number;
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
      code: 'UNSUPPORTED_PLATFORM' | 'TOTAL_TRACKED_CAP' | 'LADDER_TRACKED_CAP';
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
    consecutiveZeroNewMatchRuns: number;
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

/**
 * Task 4 async post-finalization expansion metrics.
 * May change after CollectorRun.status is terminal; not part of Task 3 equality.
 */
export type CollectorRunExpansionCounters = {
  participantsConsidered: number;
  playersEnrolledFromParticipants: number;
  playersAlreadyTrackedFromParticipants: number;
  playersSkippedDepthLimit: number;
  playersSkippedPopulationCap: number;
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

export type CollectorLadderSeedCliArgs = {
  platform: string;
  mode: 'apex' | 'representative';
  tiers: string[];
  dryRun: boolean;
  json: boolean;
  /** Representative division (defaults to I when using max-pages). */
  division?: 'I' | 'II' | 'III' | 'IV';
  /** Representative: exact single page. */
  page?: number;
  /** Representative: pages 1..N (capped by config hard max). */
  maxPagesPerDivision?: number;
  help: boolean;
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

/** Fixed density observability thresholds (not a second ranking floor). */
export type CollectorCoverageDensityThresholds = {
  gte1: 1;
  gte30: 30;
  gte100: 100;
};

export type CollectorCoverageDensityBuckets = {
  championPositionKeysGte1: number;
  championPositionKeysGte30: number;
  championPositionKeysGte100: number;
};

export type CollectorCoveragePositionDensity = {
  position: CollectorCoveragePosition;
  gte1: number;
  gte30: number;
  gte100: number;
  maxSampleSize: number;
};

export type CollectorCoverageCapSlot = {
  used: number;
  cap: number;
  remaining: number;
};

export type CollectorCoverageTrackedPlayers = {
  total: number;
  byEnrollmentSource: Record<string, number>;
  byPlatformRoute: Record<string, number>;
  byDiscoveryDepth: Record<string, number>;
  byStatus: Record<string, number>;
};

export type CollectorCoverageCapUsage = {
  matchParticipant: CollectorCoverageCapSlot;
  ladder: CollectorCoverageCapSlot;
  totalTracked: CollectorCoverageCapSlot;
};

/**
 * Persisted activity signals only. HOT/WARM/COLD at refresh time also need
 * enqueuedNewCount, which is not stored on TrackedPlayer.
 */
export type CollectorCoverageActivitySignals = {
  status: 'partial';
  note: string;
  coldAfterZeroNewRuns: number;
  activePlayers: number;
  neverSuccessfulRefresh: number;
  zeroNewStreakAtOrAboveCold: number;
  byConsecutiveZeroNewMatchRuns: Record<string, number>;
};

export type CollectorCoverageLadderRepresentation = {
  status: 'available' | 'unavailable' | 'partial';
  /** Latest RANKED_SOLO_5x5 RankSnapshot tier for enrollmentSource=LADDER roots. */
  ladderPlayersByTier: Record<string, number> | null;
  ladderPlayersMissingRankSnapshot: number | null;
  /**
   * Current-patch queue participant rows with rankTierAtIngestion set.
   * Null when no semantic patch resolved or no tier observations exist.
   */
  currentPatchQueueParticipantObservationsByTier: Record<string, number> | null;
  /**
   * Match-level tier counts are ambiguous (participants may differ).
   * Always unavailable with an explicit reason.
   */
  currentPatchQueueMatchesByTier: {
    status: 'unavailable';
    reason: string;
  };
  /** Exact rankTier ChampionAggregate keys (rankTier != ALL) with sampleSize >= 1. */
  championPositionKeysByExactTierGte1: Record<string, number> | null;
  reviewFlags: string[];
  warning?: string;
};

export type CollectorCoverageClassicZero = {
  /**
   * Public Summoner's Rift roster from ChampionStaticData
   * (excludes Jade Classic / non-public variants via publicChampionStaticWhere).
   */
  rosterSource: 'ChampionStaticData_public';
  rosterNote: string;
  status: 'available' | 'unavailable';
  staticDataPatchVersion: string | null;
  totalRosterChampions: number | null;
  /** Champions with no qualifying current-patch q420 exact-position aggregate (sampleSize >= 1). */
  championsWithZeroQualifyingCoverage: number | null;
  warning?: string;
};

export type CollectorCoveragePlatformDetail = {
  platform: string;
  semanticPatch: string | null;
  matchCounts: {
    queueTotal: number;
    currentPatchNormalized: number | null;
  };
  density: CollectorCoverageDensityBuckets;
  byPosition: CollectorCoveragePositionDensity[];
  sampleSizeHistogram: Array<{ bucket: string; count: number }>;
  classicZero: CollectorCoverageClassicZero;
  ladderRepresentation: CollectorCoverageLadderRepresentation;
};

export type CollectorCoverageChampionSection = {
  densityThresholds: CollectorCoverageDensityThresholds;
  /** Ranking floor from CHAMPION_AGGREGATION_MIN_SAMPLE — unchanged. */
  minimumSampleRankingFloor: number;
  nearFloorBand: { min: number; max: number };
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  positions: CollectorCoveragePosition[];
  platforms: CollectorCoveragePlatformDetail[];
};

/** Focused read-only population / champion coverage report (Phase 4). */
export type CollectorCoverageReport = {
  ok: true;
  mode: 'coverage';
  generatedAt: string;
  label: 'population_coverage_observability';
  queueId: number;
  effectivePlatforms: string[];
  trackedPlayers: CollectorCoverageTrackedPlayers;
  capUsage: CollectorCoverageCapUsage;
  activitySignals: CollectorCoverageActivitySignals;
  championCoverage: CollectorCoverageChampionSection;
  /** Existing density snapshot shape (status/run reuse). */
  densitySnapshot: CollectorCoverageSnapshot;
  reviewFlags: string[];
  warnings: string[];
};

export type CollectorCoverageReportInput = {
  effectivePlatforms: string[];
  queueId: number;
};

export type CollectorCoverageCliArgs = {
  platformFilter?: string;
  queueId: number;
  json: boolean;
  help: boolean;
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

export type CollectorSchedulerCliArgs = {
  help: boolean;
};

export type CollectorSchedulerTriggerCliArgs = {
  json: boolean;
  help: boolean;
};

export type CollectorSchedulerStatusCliArgs = {
  json: boolean;
  help: boolean;
};

/** Focused read-only scheduler status (no raw lease owner UUID). */
export type CollectorSchedulerStatusReport = {
  ok: true;
  mode: 'scheduler-status';
  generatedAt: string;
  /** From config (re-read preferred) — not inferred from lastOutcome. */
  enabled: boolean;
  scheduleIntervalMs: number;
  scheduleQueueId: number;
  schedulePlatform: string | null;
  scheduleBatchSize: number;
  scheduleConcurrency: number;
  maxPendingIngestionJobs: number;
  schedulerLeaseMs: number;
  /** Presence only — do not expose owner UUID. */
  leaseOwnerPresent: boolean;
  leaseExpiresAt: string | null;
  lastTriggerAt: string | null;
  lastOutcome: string | null;
  lastCollectorRunId: string | null;
  lastErrorCode: string | null;
  cooldownUntil: string | null;
  cooldownActive: boolean;
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
  /**
   * Async post-finalization expansion metrics (Task 4).
   * Distinct from Task 3 execution counters; may update after terminal status.
   */
  expansionCounters: CollectorRunExpansionCounters;
  expansionCountersLabel: 'ASYNC_POST_FINALIZATION_EXPANSION_METRICS';
};

export type CollectorStatusAutonomousBudget = {
  /** Reserved/committed MATCH_PARTICIPANT creates (not total TrackedPlayer rows). */
  matchParticipantEnrolledCount: number;
  /** Configured autonomous MATCH_PARTICIPANT creation cap. */
  expansionMaxTrackedPlayers: number;
  remainingAutonomousSlots: number;
};

export type CollectorStatusTrackedPopulation = {
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
  byEnrollmentSource: Record<string, number>;
  byDiscoveryDepth: Record<string, number>;
  /** Total TrackedPlayer rows (may exceed autonomous cap when operators seed roots). */
  totalTrackedPlayers: number;
  autonomousParticipantBudget: CollectorStatusAutonomousBudget;
  eligibleNow: number;
  activelyLeased: number;
  expiredLeases: number;
  nextEligibleAt: string | null;
  recentFailureCodes: Array<{ code: string; count: number }>;
};

/** Read-only snapshot of CollectorSchedulerState (Phase 3 owns runtime behavior). */
export type CollectorStatusSchedulerSnapshot = {
  /** From config — not inferred solely from lastOutcome. */
  enabled: boolean;
  /** PRESENT/ABSENT only — raw leaseOwner UUID is never exposed in operator output. */
  leaseOwnerPresent: boolean;
  leaseExpiresAt: string | null;
  lastTriggerAt: string | null;
  lastOutcome: string | null;
  lastCollectorRunId: string | null;
  lastErrorCode: string | null;
  cooldownUntil: string | null;
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
    schedulerEnabled: boolean;
    expandFromParticipants: boolean;
    expansionMaxTrackedPlayers: number;
    expansionMaxDepth: number;
  };
  runState: {
    activeRunning: CollectorStatusRunSummary[];
    staleRunning: CollectorStatusRunSummary[];
    recentFinalized: CollectorStatusRunSummary[];
  };
  trackedPopulation: CollectorStatusTrackedPopulation;
  scheduler: CollectorStatusSchedulerSnapshot;
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
  | 'UNSAFE_TIMING_CONFIG'
  | 'NEGATIVE_DISCOVERY_DEPTH'
  | 'DISCOVERY_DEPTH_ABOVE_HARD_MAX'
  | 'DISCOVERY_DEPTH_ABOVE_CONFIGURED_MAX'
  | 'POPULATION_BUDGET_DRIFT'
  | 'NEGATIVE_POPULATION_BUDGET'
  | 'NEGATIVE_EXPANSION_COUNTER'
  | 'MATCH_PARTICIPANT_ABOVE_HARD_CAP'
  | 'MATCH_PARTICIPANT_ABOVE_CONFIGURED_CAP'
  | 'SOURCE_QUOTA_RUN_MISMATCH'
  | 'MALFORMED_SCHEDULER_LEASE_STATE'
  | 'MISSING_POPULATION_BUDGET_SINGLETON'
  | 'MISSING_SCHEDULER_STATE_SINGLETON';

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

/** Local + owner-recorded scheduler tick outcomes (Phase 3). */
export type SchedulerTickOutcome =
  | 'TRIGGERED'
  | 'SKIPPED_DISABLED'
  | 'SKIPPED_OVERLAP'
  | 'SKIPPED_BACKPRESSURE'
  | 'SKIPPED_COOLDOWN'
  | 'FAILED_TO_START';

export type SchedulerTickResult = {
  outcome: SchedulerTickOutcome;
  collectorRunId?: string;
  errorCode?: string;
};

export type CollectorSchedulerTriggerReport = {
  ok: boolean;
  mode: 'scheduler-trigger';
  outcome: SchedulerTickOutcome;
  collectorRunId?: string;
  errorCode?: string;
};
