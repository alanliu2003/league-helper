import { RANKED_SOLO_QUEUE_ID, ValidationFailureError } from '@league-helper/shared';

export type PlayerRefreshConfig = {
  cooldownSeconds: number;
  profileCacheTtlSeconds: number;
  masteryLimit: number;
  masterySnapshotMinAgeSeconds: number;
  defaultMatchCount: number;
  maxMatchCount: number;
  /**
   * Default Riot queue filter for general search/refresh discovery.
   * `null` means omit the queue parameter (all recent queues).
   */
  defaultMatchQueueId: number | null;
  /** Ranked Solo/Duo queue ID for ranked-only analytics (not general history). */
  rankedSoloQueueId: number;
  matchIngestionQueueName: string;
  matchIngestionJobAttempts: number;
  matchIngestionReconcileBatchSize: number;
  matchTimelineQueueName: string;
  matchTimelineJobAttempts: number;
  /**
   * When true, player search/discovery may enqueue up to 20 historical
   * match-timeline enrichment jobs. Default false (Riot budget protection).
   */
  matchTimelineSearchBackfillEnabled: boolean;
  refreshLockTtlSeconds: number;
  redisUrl: string;
};

function parseNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationFailureError(`${name} must be a non-negative integer.`, { received: raw });
  }
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationFailureError(`${name} must be a positive integer.`, { received: raw });
  }
  return value;
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
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
  throw new ValidationFailureError(`${name} must be a boolean.`, { received: raw });
}

/** Empty/undefined → null (no queue filter). Otherwise a non-negative integer. */
function parseOptionalQueueId(raw: string | undefined, name: string): number | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationFailureError(`${name} must be a non-negative integer or empty.`, {
      received: raw,
    });
  }
  return value;
}

export function loadPlayerRefreshConfig(env: NodeJS.ProcessEnv = process.env): PlayerRefreshConfig {
  const defaultMatchCount = parsePositiveInt(
    env.PLAYER_DEFAULT_MATCH_COUNT,
    20,
    'PLAYER_DEFAULT_MATCH_COUNT',
  );
  const maxMatchCount = parsePositiveInt(env.PLAYER_MAX_MATCH_COUNT, 100, 'PLAYER_MAX_MATCH_COUNT');
  if (defaultMatchCount > maxMatchCount) {
    throw new ValidationFailureError(
      'PLAYER_DEFAULT_MATCH_COUNT must not exceed PLAYER_MAX_MATCH_COUNT.',
      { defaultMatchCount, maxMatchCount },
    );
  }

  const matchIngestionJobAttempts = parsePositiveInt(
    env.MATCH_INGESTION_JOB_ATTEMPTS,
    5,
    'MATCH_INGESTION_JOB_ATTEMPTS',
  );
  if (matchIngestionJobAttempts > 20) {
    throw new ValidationFailureError('MATCH_INGESTION_JOB_ATTEMPTS must be at most 20.', {
      received: matchIngestionJobAttempts,
    });
  }

  const matchTimelineJobAttempts = parsePositiveInt(
    env.MATCH_TIMELINE_JOB_ATTEMPTS,
    5,
    'MATCH_TIMELINE_JOB_ATTEMPTS',
  );
  if (matchTimelineJobAttempts > 20) {
    throw new ValidationFailureError('MATCH_TIMELINE_JOB_ATTEMPTS must be at most 20.', {
      received: matchTimelineJobAttempts,
    });
  }

  const refreshLockTtlSeconds = parsePositiveInt(
    env.REFRESH_LOCK_TTL_SECONDS,
    60,
    'REFRESH_LOCK_TTL_SECONDS',
  );

  // Prefer PLAYER_DEFAULT_MATCH_QUEUE_ID; empty = all queues.
  // Legacy PLAYER_DEFAULT_QUEUE_ID is ignored for general discovery defaults.
  const defaultMatchQueueId = parseOptionalQueueId(
    env.PLAYER_DEFAULT_MATCH_QUEUE_ID,
    'PLAYER_DEFAULT_MATCH_QUEUE_ID',
  );

  return {
    cooldownSeconds: parseNonNegativeInt(
      env.PLAYER_REFRESH_COOLDOWN_SECONDS,
      120,
      'PLAYER_REFRESH_COOLDOWN_SECONDS',
    ),
    profileCacheTtlSeconds: parsePositiveInt(
      env.PLAYER_PROFILE_CACHE_TTL_SECONDS,
      60,
      'PLAYER_PROFILE_CACHE_TTL_SECONDS',
    ),
    masteryLimit: parsePositiveInt(env.PLAYER_MASTERY_LIMIT, 10, 'PLAYER_MASTERY_LIMIT'),
    masterySnapshotMinAgeSeconds: parsePositiveInt(
      env.PLAYER_MASTERY_SNAPSHOT_MIN_AGE_SECONDS,
      3600,
      'PLAYER_MASTERY_SNAPSHOT_MIN_AGE_SECONDS',
    ),
    defaultMatchCount,
    maxMatchCount,
    defaultMatchQueueId,
    rankedSoloQueueId: parseNonNegativeInt(
      env.RANKED_SOLO_QUEUE_ID,
      RANKED_SOLO_QUEUE_ID,
      'RANKED_SOLO_QUEUE_ID',
    ),
    matchIngestionQueueName:
      (env.MATCH_INGESTION_QUEUE_NAME ?? 'match-ingestion').trim() || 'match-ingestion',
    matchIngestionJobAttempts,
    matchIngestionReconcileBatchSize: parsePositiveInt(
      env.MATCH_INGESTION_RECONCILE_BATCH_SIZE,
      100,
      'MATCH_INGESTION_RECONCILE_BATCH_SIZE',
    ),
    matchTimelineQueueName: env.MATCH_TIMELINE_QUEUE_NAME || 'match-timeline',
    matchTimelineJobAttempts,
    matchTimelineSearchBackfillEnabled: parseBoolean(
      env.MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED,
      false,
      'MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED',
    ),
    refreshLockTtlSeconds,
    redisUrl: (env.REDIS_URL ?? 'redis://localhost:6379').trim(),
  };
}

export const PLAYER_REFRESH_CONFIG = Symbol('PLAYER_REFRESH_CONFIG');
