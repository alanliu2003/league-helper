import { ValidationFailureError } from '@league-helper/shared';

export type PlayerRefreshConfig = {
  cooldownSeconds: number;
  profileCacheTtlSeconds: number;
  masteryLimit: number;
  masterySnapshotMinAgeSeconds: number;
  defaultMatchCount: number;
  maxMatchCount: number;
  defaultQueueId: number;
  matchIngestionQueueName: string;
  matchIngestionJobAttempts: number;
  matchIngestionReconcileBatchSize: number;
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

  const refreshLockTtlSeconds = parsePositiveInt(
    env.REFRESH_LOCK_TTL_SECONDS,
    60,
    'REFRESH_LOCK_TTL_SECONDS',
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
    defaultQueueId: parsePositiveInt(env.PLAYER_DEFAULT_QUEUE_ID, 420, 'PLAYER_DEFAULT_QUEUE_ID'),
    matchIngestionQueueName:
      (env.MATCH_INGESTION_QUEUE_NAME ?? 'match-ingestion').trim() || 'match-ingestion',
    matchIngestionJobAttempts,
    matchIngestionReconcileBatchSize: parsePositiveInt(
      env.MATCH_INGESTION_RECONCILE_BATCH_SIZE,
      100,
      'MATCH_INGESTION_RECONCILE_BATCH_SIZE',
    ),
    refreshLockTtlSeconds,
    redisUrl: (env.REDIS_URL ?? 'redis://localhost:6379').trim(),
  };
}

export const PLAYER_REFRESH_CONFIG = Symbol('PLAYER_REFRESH_CONFIG');
