import {
  DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
  RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
} from '@league-helper/server-riot';
import {
  parsePlatformRoute,
  RankTierSchema,
  ValidationFailureError,
  type RankTier,
} from '@league-helper/shared';

export type CollectorConfig = {
  batchSize: number;
  concurrency: number;
  matchesPerPlayer: number;
  maxMatchIdsPerRun: number;
  maxEnqueuePerRun: number;
  /**
   * Legacy warm-cadence alias. Success finalization uses hot/warm/cold intervals;
   * this field mirrors `warmRefreshIntervalMs` for backward-compatible callers/overrides.
   */
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

  // Milestone 11 Phase 3 — activity-aware refresh (success path only)
  hotRefreshIntervalMs: number;
  warmRefreshIntervalMs: number;
  coldRefreshIntervalMs: number;
  coldAfterZeroNewRuns: number;
  hotPriority: number;
  warmPriority: number;
  coldPriority: number;
  maxConsecutiveZeroNewMatchRuns: number;
  /** Initial priority for new LADDER roots (before first successful refresh). */
  ladderInitialPriority: number;
  /** Initial priority for new ADMIN_SEED / PRODUCT_SEARCH / BOOTSTRAP roots. */
  productRootInitialPriority: number;

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
  /**
   * Local scheduler status-mirror cooldown after a rate-limited run.
   * Fallback / mirror only — must not shorten the shared Riot cooldown.
   * Authoritative cross-process floor: {@link riotShared429CooldownMinMs}.
   */
  schedulerRateLimitCooldownMs: number;
  /**
   * Shared Riot 429 cooldown floor (ms). Cross-process signal for ladder seed,
   * population collector, scheduler, and match-ingestion worker.
   * Product search is intentionally out of Phase 3A.
   */
  riotShared429CooldownMinMs: number;
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

  // Milestone 11 ladder enrollment (safety caps — fail-fast, never silent-clamp above hard max)
  /** Global ceiling for ALL TrackedPlayer rows (every enrollmentSource). */
  totalTrackedPlayersHardCap: number;
  /** Ceiling for TrackedPlayer rows with enrollmentSource=LADDER. */
  ladderMaxTotal: number;
  /**
   * In-memory per-run create ceiling for ladder seeding (NOT a DB counter).
   * Enforced by the ladder seed service later.
   */
  ladderMaxNewPerRun: number;
  /** M11: ranked solo only. */
  ladderQueueType: 'RANKED_SOLO_5x5';
  /** Apex ladder tiers (A1). */
  ladderTiers: RankTier[];
  /** Representative ladder tiers (A2). */
  ladderRepresentativeTiers: RankTier[];
  ladderMaxPagesPerTierDivision: number;
  /** Scan ceiling while iterating ladder pages (not a create cap). */
  ladderMaxCandidatesScanned: number;
  /** Optional single-platform filter; null means use platformAllowlist. */
  ladderPlatform: string | null;
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
/** Hot may be sub-minute so HOT < WARM remains possible when warm is at the 1m floor. */
const MIN_HOT_REFRESH_INTERVAL_MS = 1_000;
/** Phase 3 defaults: hot sooner, warm ≈ legacy 6h, cold much later. */
const DEFAULT_HOT_REFRESH_INTERVAL_MS = 1 * HOUR_MS;
const DEFAULT_COLD_REFRESH_INTERVAL_MS = 48 * HOUR_MS;
const DEFAULT_COLD_AFTER_ZERO_NEW_RUNS = 3;
const DEFAULT_HOT_PRIORITY = 100;
const DEFAULT_WARM_PRIORITY = 50;
const DEFAULT_COLD_PRIORITY = 10;
const DEFAULT_MAX_CONSECUTIVE_ZERO_NEW_MATCH_RUNS = 100;
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

const DEFAULT_TOTAL_TRACKED_PLAYERS_HARD_CAP = 5000;
const HARD_MAX_TOTAL_TRACKED_PLAYERS_HARD_CAP = 50_000;
const DEFAULT_LADDER_MAX_TOTAL = 3000;
const HARD_MAX_LADDER_MAX_TOTAL = 20_000;
const DEFAULT_LADDER_MAX_NEW_PER_RUN = 100;
const HARD_MAX_LADDER_MAX_NEW_PER_RUN = 1000;
const DEFAULT_LADDER_QUEUE_TYPE = 'RANKED_SOLO_5x5' as const;
const DEFAULT_LADDER_TIERS = 'CHALLENGER,GRANDMASTER';
const DEFAULT_LADDER_REPRESENTATIVE_TIERS = 'DIAMOND,EMERALD,PLATINUM,GOLD';
const DEFAULT_LADDER_MAX_PAGES_PER_TIER_DIVISION = 1;
const HARD_MAX_LADDER_MAX_PAGES_PER_TIER_DIVISION = 5;
const DEFAULT_LADDER_MAX_CANDIDATES_SCANNED = 500;
const HARD_MAX_LADDER_MAX_CANDIDATES_SCANNED = 5000;

/** Apex tiers allowed for COLLECTOR_LADDER_TIERS (M11 A1). */
export const LADDER_APEX_TIERS_ALLOWLIST = ['CHALLENGER', 'GRANDMASTER'] as const satisfies readonly RankTier[];
/** Representative tiers allowed for COLLECTOR_LADDER_REPRESENTATIVE_TIERS (M11 A2). */
export const LADDER_REPRESENTATIVE_TIERS_ALLOWLIST = [
  'DIAMOND',
  'EMERALD',
  'PLATINUM',
  'GOLD',
] as const satisfies readonly RankTier[];

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
  totalTrackedPlayersHardCapDefault: DEFAULT_TOTAL_TRACKED_PLAYERS_HARD_CAP,
  totalTrackedPlayersHardCapHardMax: HARD_MAX_TOTAL_TRACKED_PLAYERS_HARD_CAP,
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

function parseLadderQueueType(raw: string | undefined): 'RANKED_SOLO_5x5' {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_LADDER_QUEUE_TYPE;
  }
  const value = raw.trim();
  if (value !== 'RANKED_SOLO_5x5') {
    throw new ValidationFailureError(
      'COLLECTOR_LADDER_QUEUE_TYPE must be RANKED_SOLO_5x5 for Milestone 11.',
      { received: raw },
    );
  }
  return value;
}

function parseTierList(
  raw: string | undefined,
  fallback: string,
  allowlist: readonly RankTier[],
  name: string,
): RankTier[] {
  const source = raw === undefined || raw.trim() === '' ? fallback : raw;
  const parts = source
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new ValidationFailureError(`${name} must include at least one tier.`);
  }

  const allowed = new Set<string>(allowlist);
  const seen = new Set<string>();
  const tiers: RankTier[] = [];
  for (const part of parts) {
    const parsed = RankTierSchema.safeParse(part);
    if (!parsed.success) {
      throw new ValidationFailureError(`${name} contains an invalid rank tier.`, {
        received: part,
      });
    }
    if (!allowed.has(parsed.data)) {
      throw new ValidationFailureError(
        `${name} contains a tier outside the approved allowlist (${allowlist.join(',')}).`,
        { received: parsed.data },
      );
    }
    if (!seen.has(parsed.data)) {
      seen.add(parsed.data);
      tiers.push(parsed.data);
    }
  }

  return tiers;
}

function parseOptionalLadderPlatform(
  raw: string | undefined,
  platformAllowlist: string[],
): string | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const platform = parsePlatformRoute(raw.trim());
  if (!platformAllowlist.includes(platform)) {
    throw new ValidationFailureError(
      'COLLECTOR_LADDER_PLATFORM must be included in COLLECTOR_PLATFORM_ALLOWLIST.',
      { ladderPlatform: platform, platformAllowlist },
    );
  }
  return platform;
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

  /**
   * Warm interval supersedes the legacy single cadence for success finalization.
   * COLLECTOR_WARM_REFRESH_INTERVAL_MS wins when set; otherwise COLLECTOR_MIN_REFRESH_INTERVAL_MS
   * (default 6h) is the warm default. Returned `minRefreshIntervalMs` mirrors warm.
   */
  const warmRefreshIntervalMs = parseOptionalInt(
    env.COLLECTOR_WARM_REFRESH_INTERVAL_MS !== undefined &&
      env.COLLECTOR_WARM_REFRESH_INTERVAL_MS.trim() !== ''
      ? env.COLLECTOR_WARM_REFRESH_INTERVAL_MS
      : env.COLLECTOR_MIN_REFRESH_INTERVAL_MS,
    DEFAULT_MIN_REFRESH_INTERVAL_MS,
    {
      min: MIN_REFRESH_INTERVAL_MS,
      max: MAX_DURATION_MS,
      name:
        env.COLLECTOR_WARM_REFRESH_INTERVAL_MS !== undefined &&
        env.COLLECTOR_WARM_REFRESH_INTERVAL_MS.trim() !== ''
          ? 'COLLECTOR_WARM_REFRESH_INTERVAL_MS'
          : 'COLLECTOR_MIN_REFRESH_INTERVAL_MS',
    },
  );
  const minRefreshIntervalMs = warmRefreshIntervalMs;
  const hotRefreshIntervalMs = parseOptionalInt(
    env.COLLECTOR_HOT_REFRESH_INTERVAL_MS,
    DEFAULT_HOT_REFRESH_INTERVAL_MS,
    {
      min: MIN_HOT_REFRESH_INTERVAL_MS,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_HOT_REFRESH_INTERVAL_MS',
    },
  );
  const coldRefreshIntervalMs = parseOptionalInt(
    env.COLLECTOR_COLD_REFRESH_INTERVAL_MS,
    DEFAULT_COLD_REFRESH_INTERVAL_MS,
    {
      min: MIN_REFRESH_INTERVAL_MS,
      max: MAX_DURATION_MS,
      name: 'COLLECTOR_COLD_REFRESH_INTERVAL_MS',
    },
  );
  if (!(hotRefreshIntervalMs < warmRefreshIntervalMs && warmRefreshIntervalMs < coldRefreshIntervalMs)) {
    throw new ValidationFailureError(
      'Collector refresh intervals must satisfy HOT < WARM < COLD.',
      { hotRefreshIntervalMs, warmRefreshIntervalMs, coldRefreshIntervalMs },
    );
  }

  const coldAfterZeroNewRuns = parseOptionalInt(
    env.COLLECTOR_COLD_AFTER_ZERO_NEW_RUNS,
    DEFAULT_COLD_AFTER_ZERO_NEW_RUNS,
    {
      min: 1,
      max: 10_000,
      name: 'COLLECTOR_COLD_AFTER_ZERO_NEW_RUNS',
    },
  );
  const maxConsecutiveZeroNewMatchRuns = parseOptionalInt(
    env.COLLECTOR_MAX_CONSECUTIVE_ZERO_NEW_MATCH_RUNS,
    DEFAULT_MAX_CONSECUTIVE_ZERO_NEW_MATCH_RUNS,
    {
      min: 1,
      max: 1_000_000,
      name: 'COLLECTOR_MAX_CONSECUTIVE_ZERO_NEW_MATCH_RUNS',
    },
  );
  if (maxConsecutiveZeroNewMatchRuns < coldAfterZeroNewRuns) {
    throw new ValidationFailureError(
      'COLLECTOR_MAX_CONSECUTIVE_ZERO_NEW_MATCH_RUNS must be greater than or equal to COLLECTOR_COLD_AFTER_ZERO_NEW_RUNS.',
      { maxConsecutiveZeroNewMatchRuns, coldAfterZeroNewRuns },
    );
  }

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

  const hotPriority = parseOptionalInt(env.COLLECTOR_HOT_PRIORITY, DEFAULT_HOT_PRIORITY, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    name: 'COLLECTOR_HOT_PRIORITY',
  });
  const warmPriority = parseOptionalInt(env.COLLECTOR_WARM_PRIORITY, DEFAULT_WARM_PRIORITY, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    name: 'COLLECTOR_WARM_PRIORITY',
  });
  const coldPriority = parseOptionalInt(env.COLLECTOR_COLD_PRIORITY, DEFAULT_COLD_PRIORITY, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    name: 'COLLECTOR_COLD_PRIORITY',
  });
  if (!(hotPriority >= warmPriority && warmPriority >= coldPriority)) {
    throw new ValidationFailureError(
      'Collector activity priorities must satisfy HOT >= WARM >= COLD.',
      { hotPriority, warmPriority, coldPriority },
    );
  }

  const ladderInitialPriority = parseOptionalInt(
    env.COLLECTOR_LADDER_INITIAL_PRIORITY,
    warmPriority,
    {
      min: Number.MIN_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
      name: 'COLLECTOR_LADDER_INITIAL_PRIORITY',
    },
  );
  const productRootInitialPriority = parseOptionalInt(
    env.COLLECTOR_PRODUCT_ROOT_INITIAL_PRIORITY,
    hotPriority,
    {
      min: Number.MIN_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
      name: 'COLLECTOR_PRODUCT_ROOT_INITIAL_PRIORITY',
    },
  );
  if (ladderInitialPriority > productRootInitialPriority) {
    throw new ValidationFailureError(
      'COLLECTOR_LADDER_INITIAL_PRIORITY must be less than or equal to COLLECTOR_PRODUCT_ROOT_INITIAL_PRIORITY.',
      { ladderInitialPriority, productRootInitialPriority },
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

  const platformAllowlist = parsePlatformAllowlist(env.COLLECTOR_PLATFORM_ALLOWLIST);

  // Milestone 11 ladder safety caps: reject above hard max (do NOT silent-clamp).
  const totalTrackedPlayersHardCap = parseOptionalInt(
    env.COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP,
    DEFAULT_TOTAL_TRACKED_PLAYERS_HARD_CAP,
    {
      min: 1,
      max: HARD_MAX_TOTAL_TRACKED_PLAYERS_HARD_CAP,
      name: 'COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP',
    },
  );
  const ladderMaxTotal = parseOptionalInt(
    env.COLLECTOR_LADDER_MAX_TOTAL,
    DEFAULT_LADDER_MAX_TOTAL,
    {
      min: 1,
      max: HARD_MAX_LADDER_MAX_TOTAL,
      name: 'COLLECTOR_LADDER_MAX_TOTAL',
    },
  );
  const ladderMaxNewPerRun = parseOptionalInt(
    env.COLLECTOR_LADDER_MAX_NEW_PER_RUN,
    DEFAULT_LADDER_MAX_NEW_PER_RUN,
    {
      min: 1,
      max: HARD_MAX_LADDER_MAX_NEW_PER_RUN,
      name: 'COLLECTOR_LADDER_MAX_NEW_PER_RUN',
    },
  );

  if (ladderMaxTotal > totalTrackedPlayersHardCap) {
    throw new ValidationFailureError(
      'COLLECTOR_LADDER_MAX_TOTAL must be less than or equal to COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP.',
      { ladderMaxTotal, totalTrackedPlayersHardCap },
    );
  }
  if (ladderMaxNewPerRun > ladderMaxTotal) {
    throw new ValidationFailureError(
      'COLLECTOR_LADDER_MAX_NEW_PER_RUN must be less than or equal to COLLECTOR_LADDER_MAX_TOTAL.',
      { ladderMaxNewPerRun, ladderMaxTotal },
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
    platformAllowlist,
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
    hotRefreshIntervalMs,
    warmRefreshIntervalMs,
    coldRefreshIntervalMs,
    coldAfterZeroNewRuns,
    hotPriority,
    warmPriority,
    coldPriority,
    maxConsecutiveZeroNewMatchRuns,
    ladderInitialPriority,
    productRootInitialPriority,

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
    // Shared floor is the cross-process 429 signal. Product search left out of Phase 3A.
    riotShared429CooldownMinMs: parseOptionalInt(
      env[RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV],
      DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
      {
        min: 0,
        max: MAX_DURATION_MS,
        name: RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
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

    totalTrackedPlayersHardCap,
    ladderMaxTotal,
    ladderMaxNewPerRun,
    ladderQueueType: parseLadderQueueType(env.COLLECTOR_LADDER_QUEUE_TYPE),
    ladderTiers: parseTierList(
      env.COLLECTOR_LADDER_TIERS,
      DEFAULT_LADDER_TIERS,
      LADDER_APEX_TIERS_ALLOWLIST,
      'COLLECTOR_LADDER_TIERS',
    ),
    ladderRepresentativeTiers: parseTierList(
      env.COLLECTOR_LADDER_REPRESENTATIVE_TIERS,
      DEFAULT_LADDER_REPRESENTATIVE_TIERS,
      LADDER_REPRESENTATIVE_TIERS_ALLOWLIST,
      'COLLECTOR_LADDER_REPRESENTATIVE_TIERS',
    ),
    ladderMaxPagesPerTierDivision: parseOptionalInt(
      env.COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION,
      DEFAULT_LADDER_MAX_PAGES_PER_TIER_DIVISION,
      {
        min: 1,
        max: HARD_MAX_LADDER_MAX_PAGES_PER_TIER_DIVISION,
        name: 'COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION',
      },
    ),
    ladderMaxCandidatesScanned: parseOptionalInt(
      env.COLLECTOR_LADDER_MAX_CANDIDATES_SCANNED,
      DEFAULT_LADDER_MAX_CANDIDATES_SCANNED,
      {
        min: 1,
        max: HARD_MAX_LADDER_MAX_CANDIDATES_SCANNED,
        name: 'COLLECTOR_LADDER_MAX_CANDIDATES_SCANNED',
      },
    ),
    ladderPlatform: parseOptionalLadderPlatform(env.COLLECTOR_LADDER_PLATFORM, platformAllowlist),
  };
}
