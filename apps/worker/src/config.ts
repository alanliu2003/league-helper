import { MATCH_INGESTION_QUEUE_NAME, ValidationFailureError } from '@league-helper/shared';

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new ValidationFailureError(
      'DATABASE_URL is required for the match-ingestion worker (Prisma).',
    );
  }
  return url;
}

export const QUEUE_NAME = 'league-helper-default';

export type MatchIngestionWorkerConfig = {
  queueName: string;
  concurrency: number;
  jobAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  timelineFetchEnabled: boolean;
  storeRawPayloads: boolean;
  timelineRequiredForComplete: boolean;
  normalizationVersion: number;
};

function parseBoundedInt(
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

/** Load match-ingestion worker settings from environment. */
export function loadMatchIngestionWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): MatchIngestionWorkerConfig {
  return {
    queueName: env.MATCH_INGESTION_QUEUE_NAME?.trim() || MATCH_INGESTION_QUEUE_NAME,
    concurrency: parseBoundedInt(env.MATCH_INGESTION_WORKER_CONCURRENCY, 2, {
      min: 1,
      max: 32,
      name: 'MATCH_INGESTION_WORKER_CONCURRENCY',
    }),
    jobAttempts: parseBoundedInt(env.MATCH_INGESTION_JOB_ATTEMPTS, 5, {
      min: 1,
      max: 20,
      name: 'MATCH_INGESTION_JOB_ATTEMPTS',
    }),
    backoffBaseMs: parseBoundedInt(env.MATCH_INGESTION_BACKOFF_BASE_MS, 2000, {
      min: 100,
      max: 60_000,
      name: 'MATCH_INGESTION_BACKOFF_BASE_MS',
    }),
    backoffMaxMs: parseBoundedInt(env.MATCH_INGESTION_BACKOFF_MAX_MS, 60_000, {
      min: 1000,
      max: 600_000,
      name: 'MATCH_INGESTION_BACKOFF_MAX_MS',
    }),
    timelineFetchEnabled: parseBoolean(
      env.MATCH_TIMELINE_FETCH_ENABLED,
      true,
      'MATCH_TIMELINE_FETCH_ENABLED',
    ),
    storeRawPayloads: parseBoolean(env.MATCH_STORE_RAW_PAYLOADS, false, 'MATCH_STORE_RAW_PAYLOADS'),
    timelineRequiredForComplete: parseBoolean(
      env.MATCH_TIMELINE_REQUIRED_FOR_COMPLETE,
      false,
      'MATCH_TIMELINE_REQUIRED_FOR_COMPLETE',
    ),
    normalizationVersion: parseBoundedInt(env.MATCH_NORMALIZATION_VERSION, 1, {
      min: 1,
      max: 100,
      name: 'MATCH_NORMALIZATION_VERSION',
    }),
  };
}
