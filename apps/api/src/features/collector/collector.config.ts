import { parsePlatformRoute, ValidationFailureError } from '@league-helper/shared';

export type CollectorConfig = {
  batchSize: number;
  concurrency: number;
  matchesPerPlayer: number;
  maxMatchIdsPerRun: number;
  maxEnqueuePerRun: number;
  minRefreshIntervalMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxBackoffExponent: number;
  playerTimeoutMs: number;
  leaseDurationMs: number;
  staleRunAfterMs: number;
  platformAllowlist: string[];
  estimatedRequestsPerEnqueuedMatch: number;
  priorityMin: number;
  priorityMax: number;
  enrollFromBootstrap: boolean;
  enrollFromSearch: boolean;

  // Task 4 scheduler (config only in Phase 1 — process not started here)
  schedulerEnabled: boolean;
  scheduleIntervalMs: number;
  scheduleBatchSize: number;
  scheduleConcurrency: number;
  scheduleMaxMatchesPerPlayer: number;
  scheduleMaxMatchIds: number;
  scheduleMaxEnqueue: number;
  schedulerLeaseSafetyMarginMs: number;
  schedulerLeaseMs: number;
  schedulerRateLimitCooldownMs: number;
  maxPendingIngestionJobs: number;
  scheduleQueueId: number;
  /** Optional single-platform filter; empty means use platformAllowlist as-is. */
  schedulePlatform: string | null;

  // Task 4 participant expansion
  expandFromParticipants: boolean;
  expansionMaxDepth: number;
  expansionMaxNewPlayersPerMatch: number;
  expansionMaxNewPlayersPerSourcePlayer: number;
  expansionMaxNewPlayersPerRun: number;
  expansionMaxTrackedPlayers: number;
  expansionQueueId: number;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const LEASE_SAFETY_MARGIN_MS = 60_000;

const DEFAULT_BATCH_SIZE = 10;
const HARD_MAX_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 2;
const HARD_MAX_CONCURRENCY = 5;
const DEFAULT_MATCHES_PER_PLAYER = 20;
const HARD_MAX_MATCHES_PER_PLAYER = 100;
const DEFAULT_MAX_MATCH_IDS_PER_RUN = 200;
const HARD_MAX_MATCH_IDS_PER_RUN = 1000;
const DEFAULT_MAX_ENQUEUE_PER_RUN = 200;
const HARD_MAX_ENQUEUE_PER_RUN = 1000;
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 6 * HOUR_MS;
const MIN_REFRESH_INTERVAL_MS = MINUTE_MS;
const DEFAULT_BASE_BACKOFF_MS = 15 * MINUTE_MS;
const DEFAULT_MAX_BACKOFF_MS = 24 * HOUR_MS;
const DEFAULT_MAX_BACKOFF_EXPONENT = 8;
const DEFAULT_PLAYER_TIMEOUT_MS = 10 * MINUTE_MS;
const DEFAULT_LEASE_DURATION_MS = 15 * MINUTE_MS;
const DEFAULT_STALE_RUN_AFTER_MS = 2 * HOUR_MS;
const DEFAULT_PLATFORM_ALLOWLIST = 'na1';
const DEFAULT_ESTIMATED_REQUESTS_PER_ENQUEUED_MATCH = 2;
const DEFAULT_PRIORITY_MIN = 0;
const DEFAULT_PRIORITY_MAX = 1000;

const DEFAULT_SCHEDULE_INTERVAL_MS = 15 * MINUTE_MS;
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const HARD_MAX_SCHEDULE_INTERVAL_MS = 24 * HOUR_MS;
const DEFAULT_SCHEDULER_LEASE_SAFETY_MARGIN_MS = 5 * MINUTE_MS;
const DEFAULT_SCHEDULER_LEASE_MS = 60 * MINUTE_MS;
const DEFAULT_SCHEDULER_RATE_LIMIT_COOLDOWN_MS = 15 * MINUTE_MS;
const DEFAULT_MAX_PENDING_INGESTION_JOBS = 500;
const DEFAULT_SCHEDULE_QUEUE_ID = 420;
const HARD_MAX_PENDING_INGESTION_JOBS = 50_000;

const DEFAULT_EXPANSION_MAX_DEPTH = 1;
const HARD_MAX_EXPANSION_DEPTH = 3;
const DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH = 3;
const HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH = 9;
const DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER = 5;
const HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER = 50;
const DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_RUN = 20;
const HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_RUN = 200;
const DEFAULT_EXPANSION_MAX_TRACKED_PLAYERS = 500;
const HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS = 5000;
const DEFAULT_EXPANSION_QUEUE_ID = 420;

const MAX_DURATION_MS = 7 * 24 * HOUR_MS;
const MAX_BACKOFF_EXPONENT = 32;

/** Drift-sensitive expansion defaults/caps shared with worker mirror tests. */
export const PARTICIPANT_EXPANSION_CONFIG_VECTORS = {
  expandFromParticipantsDefault: false,
  maxDepthDefault: DEFAULT_EXPANSION_MAX_DEPTH,
  maxDepthHardMax: HARD_MAX_EXPANSION_DEPTH,
  maxNewPlayersPerMatchDefault: DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
  maxNewPlayersPerMatchHardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
  maxNewPlayersPerSourcePlayerDefault: DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
  maxNewPlayersPerSourcePlayerHardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
  maxNewPlayersPerRunDefault: DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
  maxNewPlayersPerRunHardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
  maxTrackedPlayersDefault: DEFAULT_EXPANSION_MAX_TRACKED_PLAYERS,
  maxTrackedPlayersHardMax: HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS,
  expansionQueueIdDefault: DEFAULT_EXPANSION_QUEUE_ID,
} as const;

function parseOptionalInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number; name: string },
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new ValidationFailureError(
      `${bounds.name} must be an integer between ${bounds.min} and ${bounds.max}.`,
      { received: raw },
    );
  }

  return value;
}

/** Parse integer then clamp into [min, hardMax] (hard caps for budgets/wave knobs). */
function parseClampedInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; hardMax: number; name: string },
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min) {
    throw new ValidationFailureError(
      `${bounds.name} must be an integer >= ${bounds.min}.`,
      { received: raw },
    );
  }

  return Math.min(value, bounds.hardMax);
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new ValidationFailureError(`${name} must be a boolean (true/false).`, { received: raw });
}

/**
 * Re-read COLLECTOR_SCHEDULER_ENABLED each tick so enable/disable takes effect
 * without restarting the scheduler process.
 *
 * Other schedule knobs (interval, batch, lease, backpressure threshold, cooldown)
 * come from the injected COLLECTOR_CONFIG snapshot loaded at Nest bootstrap.
 */
export function readCollectorSchedulerEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return parseBooleanFlag(
    env.COLLECTOR_SCHEDULER_ENABLED,
    false,
    'COLLECTOR_SCHEDULER_ENABLED',
  );
}

function parsePlatformAllowlist(raw: string | undefined): string[] {
  const source = raw === undefined || raw.trim() === '' ? DEFAULT_PLATFORM_ALLOWLIST : raw;
  const parts = source
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new ValidationFailureError('COLLECTOR_PLATFORM_ALLOWLIST must include at least one platform.');
  }

  const seen = new Set<string>();
  const platforms: string[] = [];
  for (const part of parts) {
    const platform = parsePlatformRoute(part);
    if (!seen.has(platform)) {
      seen.add(platform);
      platforms.push(platform);
    }
  }

  return platforms;
}

function parseOptionalSchedulePlatform(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  return parsePlatformRoute(raw.trim());
}

/** Worst-case scheduled runOnce wall-time lower bound for lease TTL validation. */
export function computeMinimumSchedulerLeaseMs(input: {
  scheduleBatchSize: number;
  scheduleConcurrency: number;
  playerTimeoutMs: number;
  schedulerLeaseSafetyMarginMs: number;
}): number {
  return (
    Math.ceil(input.scheduleBatchSize / input.scheduleConcurrency) * input.playerTimeoutMs +
    input.schedulerLeaseSafetyMarginMs
  );
}

/** Load population-collector ops config (CLI only — not used by public UI). */
export function loadCollectorConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CollectorConfig {
  const batchSize = parseClampedInt(env.COLLECTOR_BATCH_SIZE, DEFAULT_BATCH_SIZE, {
    min: 1,
    hardMax: HARD_MAX_BATCH_SIZE,
    name: 'COLLECTOR_BATCH_SIZE',
  });
  const concurrency = parseClampedInt(env.COLLECTOR_CONCURRENCY, DEFAULT_CONCURRENCY, {
    min: 1,
    hardMax: HARD_MAX_CONCURRENCY,
    name: 'COLLECTOR_CONCURRENCY',
  });
  const matchesPerPlayer = parseClampedInt(
    env.COLLECTOR_MATCHES_PER_PLAYER,
    DEFAULT_MATCHES_PER_PLAYER,
    {
      min: 1,
      hardMax: HARD_MAX_MATCHES_PER_PLAYER,
      name: 'COLLECTOR_MATCHES_PER_PLAYER',
    },
  );
  const maxMatchIdsPerRun = parseClampedInt(
    env.COLLECTOR_MAX_MATCH_IDS_PER_RUN,
    DEFAULT_MAX_MATCH_IDS_PER_RUN,
    {
      min: 1,
      hardMax: HARD_MAX_MATCH_IDS_PER_RUN,
      name: 'COLLECTOR_MAX_MATCH_IDS_PER_RUN',
    },
  );
  const maxEnqueuePerRun = parseClampedInt(
    env.COLLECTOR_MAX_ENQUEUE_PER_RUN,
    DEFAULT_MAX_ENQUEUE_PER_RUN,
    {
      min: 1,
      hardMax: HARD_MAX_ENQUEUE_PER_RUN,
      name: 'COLLECTOR_MAX_ENQUEUE_PER_RUN',
    },
  );

  const minRefreshIntervalMs = parseOptionalInt(
    env.COLLECTOR_MIN_REFRESH_INTERVAL_MS,
    DEFAULT_MIN_REFRESH_INTERVAL_MS,
    {
      min: MIN_REFRESH_INTERVAL_MS,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_MIN_REFRESH_INTERVAL_MS',
    },
  );
  const baseBackoffMs = parseOptionalInt(env.COLLECTOR_BASE_BACKOFF_MS, DEFAULT_BASE_BACKOFF_MS, {
    min: 1,
    max: MAX_DURATION_MS,
    name: 'COLLECTOR_BASE_BACKOFF_MS',
  });
  const maxBackoffMs = parseOptionalInt(env.COLLECTOR_MAX_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS, {
    min: 1,
    max: MAX_DURATION_MS,
    name: 'COLLECTOR_MAX_BACKOFF_MS',
  });
  const maxBackoffExponent = parseOptionalInt(
    env.COLLECTOR_MAX_BACKOFF_EXPONENT,
    DEFAULT_MAX_BACKOFF_EXPONENT,
    {
      min: 0,
      max: MAX_BACKOFF_EXPONENT,
      name: 'COLLECTOR_MAX_BACKOFF_EXPONENT',
    },
  );
  const playerTimeoutMs = parseOptionalInt(
    env.COLLECTOR_PLAYER_TIMEOUT_MS,
    DEFAULT_PLAYER_TIMEOUT_MS,
    {
      min: 1,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_PLAYER_TIMEOUT_MS',
    },
  );
  const leaseDurationMs = parseOptionalInt(
    env.COLLECTOR_LEASE_DURATION_MS,
    DEFAULT_LEASE_DURATION_MS,
    {
      min: 1,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_LEASE_DURATION_MS',
    },
  );
  const staleRunAfterMs = parseOptionalInt(
    env.COLLECTOR_STALE_RUN_AFTER_MS,
    DEFAULT_STALE_RUN_AFTER_MS,
    {
      min: 1,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_STALE_RUN_AFTER_MS',
    },
  );

  if (!(leaseDurationMs > playerTimeoutMs + LEASE_SAFETY_MARGIN_MS)) {
    throw new ValidationFailureError(
      'COLLECTOR_LEASE_DURATION_MS must be greater than COLLECTOR_PLAYER_TIMEOUT_MS + 60000ms safety margin.',
      {
        leaseDurationMs,
        playerTimeoutMs,
        requiredMinimumExclusive: playerTimeoutMs + LEASE_SAFETY_MARGIN_MS,
      },
    );
  }

  if (!(staleRunAfterMs > leaseDurationMs)) {
    throw new ValidationFailureError(
      'COLLECTOR_STALE_RUN_AFTER_MS must be greater than COLLECTOR_LEASE_DURATION_MS.',
      { staleRunAfterMs, leaseDurationMs },
    );
  }

  const priorityMin = parseOptionalInt(env.COLLECTOR_PRIORITY_MIN, DEFAULT_PRIORITY_MIN, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    name: 'COLLECTOR_PRIORITY_MIN',
  });
  const priorityMax = parseOptionalInt(env.COLLECTOR_PRIORITY_MAX, DEFAULT_PRIORITY_MAX, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    name: 'COLLECTOR_PRIORITY_MAX',
  });
  if (priorityMin > priorityMax) {
    throw new ValidationFailureError(
      'COLLECTOR_PRIORITY_MIN must be less than or equal to COLLECTOR_PRIORITY_MAX.',
      { priorityMin, priorityMax },
    );
  }

  const scheduleBatchSize = parseClampedInt(
    env.COLLECTOR_SCHEDULE_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    {
      min: 1,
      hardMax: HARD_MAX_BATCH_SIZE,
      name: 'COLLECTOR_SCHEDULE_BATCH_SIZE',
    },
  );
  const scheduleConcurrency = parseClampedInt(
    env.COLLECTOR_SCHEDULE_CONCURRENCY,
    DEFAULT_CONCURRENCY,
    {
      min: 1,
      hardMax: HARD_MAX_CONCURRENCY,
      name: 'COLLECTOR_SCHEDULE_CONCURRENCY',
    },
  );
  const schedulerLeaseSafetyMarginMs = parseOptionalInt(
    env.COLLECTOR_SCHEDULER_LEASE_SAFETY_MARGIN_MS,
    DEFAULT_SCHEDULER_LEASE_SAFETY_MARGIN_MS,
    {
      min: 0,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_SCHEDULER_LEASE_SAFETY_MARGIN_MS',
    },
  );
  const schedulerLeaseMs = parseOptionalInt(
    env.COLLECTOR_SCHEDULER_LEASE_MS,
    DEFAULT_SCHEDULER_LEASE_MS,
    {
      min: 1,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_SCHEDULER_LEASE_MS',
    },
  );

  const minimumSchedulerLeaseMs = computeMinimumSchedulerLeaseMs({
    scheduleBatchSize,
    scheduleConcurrency,
    playerTimeoutMs,
    schedulerLeaseSafetyMarginMs,
  });

  if (!(schedulerLeaseMs > minimumSchedulerLeaseMs)) {
    throw new ValidationFailureError(
      'COLLECTOR_SCHEDULER_LEASE_MS must be greater than ceil(batch/concurrency)*COLLECTOR_PLAYER_TIMEOUT_MS + safety margin.',
      {
        schedulerLeaseMs,
        minimumSchedulerLeaseMs,
        scheduleBatchSize,
        scheduleConcurrency,
        playerTimeoutMs,
        schedulerLeaseSafetyMarginMs,
      },
    );
  }

  return {
    batchSize,
    concurrency,
    matchesPerPlayer,
    maxMatchIdsPerRun,
    maxEnqueuePerRun,
    minRefreshIntervalMs,
    baseBackoffMs,
    maxBackoffMs,
    maxBackoffExponent,
    playerTimeoutMs,
    leaseDurationMs,
    staleRunAfterMs,
    platformAllowlist: parsePlatformAllowlist(env.COLLECTOR_PLATFORM_ALLOWLIST),
    estimatedRequestsPerEnqueuedMatch: parseOptionalInt(
      env.COLLECTOR_ESTIMATED_REQUESTS_PER_ENQUEUED_MATCH,
      DEFAULT_ESTIMATED_REQUESTS_PER_ENQUEUED_MATCH,
      {
        min: 0,
        max: 1000,
        name: 'COLLECTOR_ESTIMATED_REQUESTS_PER_ENQUEUED_MATCH',
      },
    ),
    priorityMin,
    priorityMax,
    enrollFromBootstrap: parseBooleanFlag(
      env.COLLECTOR_ENROLL_FROM_BOOTSTRAP,
      false,
      'COLLECTOR_ENROLL_FROM_BOOTSTRAP',
    ),
    enrollFromSearch: parseBooleanFlag(
      env.COLLECTOR_ENROLL_FROM_SEARCH,
      false,
      'COLLECTOR_ENROLL_FROM_SEARCH',
    ),

    schedulerEnabled: readCollectorSchedulerEnabled(env),
    scheduleIntervalMs: parseOptionalInt(
      env.COLLECTOR_SCHEDULE_INTERVAL_MS,
      DEFAULT_SCHEDULE_INTERVAL_MS,
      {
        min: MIN_SCHEDULE_INTERVAL_MS,
        max: HARD_MAX_SCHEDULE_INTERVAL_MS,
        name: 'COLLECTOR_SCHEDULE_INTERVAL_MS',
      },
    ),
    scheduleBatchSize,
    scheduleConcurrency,
    scheduleMaxMatchesPerPlayer: parseClampedInt(
      env.COLLECTOR_SCHEDULE_MAX_MATCHES_PER_PLAYER,
      DEFAULT_MATCHES_PER_PLAYER,
      {
        min: 1,
        hardMax: HARD_MAX_MATCHES_PER_PLAYER,
        name: 'COLLECTOR_SCHEDULE_MAX_MATCHES_PER_PLAYER',
      },
    ),
    scheduleMaxMatchIds: parseClampedInt(
      env.COLLECTOR_SCHEDULE_MAX_MATCH_IDS,
      DEFAULT_MAX_MATCH_IDS_PER_RUN,
      {
        min: 1,
        hardMax: HARD_MAX_MATCH_IDS_PER_RUN,
        name: 'COLLECTOR_SCHEDULE_MAX_MATCH_IDS',
      },
    ),
    scheduleMaxEnqueue: parseClampedInt(
      env.COLLECTOR_SCHEDULE_MAX_ENQUEUE,
      DEFAULT_MAX_ENQUEUE_PER_RUN,
      {
        min: 1,
        hardMax: HARD_MAX_ENQUEUE_PER_RUN,
        name: 'COLLECTOR_SCHEDULE_MAX_ENQUEUE',
      },
    ),
    schedulerLeaseSafetyMarginMs,
    schedulerLeaseMs,
    schedulerRateLimitCooldownMs: parseOptionalInt(
      env.COLLECTOR_SCHEDULER_RATE_LIMIT_COOLDOWN_MS,
      DEFAULT_SCHEDULER_RATE_LIMIT_COOLDOWN_MS,
      {
        min: 0,
        max: MAX_DURATION_MS,
        name: 'COLLECTOR_SCHEDULER_RATE_LIMIT_COOLDOWN_MS',
      },
    ),
    maxPendingIngestionJobs: parseClampedInt(
      env.COLLECTOR_MAX_PENDING_INGESTION_JOBS,
      DEFAULT_MAX_PENDING_INGESTION_JOBS,
      {
        min: 0,
        hardMax: HARD_MAX_PENDING_INGESTION_JOBS,
        name: 'COLLECTOR_MAX_PENDING_INGESTION_JOBS',
      },
    ),
    scheduleQueueId: parseOptionalInt(env.COLLECTOR_SCHEDULE_QUEUE_ID, DEFAULT_SCHEDULE_QUEUE_ID, {
      min: 0,
      max: 1_000_000,
      name: 'COLLECTOR_SCHEDULE_QUEUE_ID',
    }),
    schedulePlatform: parseOptionalSchedulePlatform(env.COLLECTOR_SCHEDULE_PLATFORM),

    expandFromParticipants: parseBooleanFlag(
      env.COLLECTOR_EXPAND_FROM_PARTICIPANTS,
      false,
      'COLLECTOR_EXPAND_FROM_PARTICIPANTS',
    ),
    expansionMaxDepth: parseOptionalInt(
      env.COLLECTOR_EXPANSION_MAX_DEPTH,
      DEFAULT_EXPANSION_MAX_DEPTH,
      {
        min: 0,
        max: HARD_MAX_EXPANSION_DEPTH,
        name: 'COLLECTOR_EXPANSION_MAX_DEPTH',
      },
    ),
    expansionMaxNewPlayersPerMatch: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
      DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
        name: 'COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH',
      },
    ),
    expansionMaxNewPlayersPerSourcePlayer: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
      DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
        name: 'COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER',
      },
    ),
    expansionMaxNewPlayersPerRun: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
      DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
        name: 'COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN',
      },
    ),
    expansionMaxTrackedPlayers: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS,
      DEFAULT_EXPANSION_MAX_TRACKED_PLAYERS,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS,
        name: 'COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS',
      },
    ),
    expansionQueueId: parseOptionalInt(
      env.COLLECTOR_EXPANSION_QUEUE_ID,
      DEFAULT_EXPANSION_QUEUE_ID,
      {
        min: 0,
        max: 1_000_000,
        name: 'COLLECTOR_EXPANSION_QUEUE_ID',
      },
    ),
  };
}
