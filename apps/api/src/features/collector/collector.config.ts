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

const MAX_DURATION_MS = 7 * 24 * HOUR_MS;
const MAX_BACKOFF_EXPONENT = 32;

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
  };
}
