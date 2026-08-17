import {
  DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
  RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
} from '@league-helper/server-riot';
import {
  CHAMPION_AGGREGATION_QUEUE_NAME,
  CHAMPION_AI_INSIGHT_QUEUE_NAME,
  MATCH_INGESTION_QUEUE_NAME,
  PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME,
  PLAYER_AI_PLAYSTYLE_QUEUE_NAME,
  PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS,
  ValidationFailureError,
} from '@league-helper/shared';

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
  /**
   * Shared Riot 429 cooldown floor (ms). Cross-process with API ladder/collector/scheduler.
   * Product search is intentionally out of Phase 3A.
   */
  riotShared429CooldownMinMs: number;
  timelineFetchEnabled: boolean;
  storeRawPayloads: boolean;
  timelineRequiredForComplete: boolean;
  normalizationVersion: number;
};

export type ChampionAggregationWorkerConfig = {
  queueName: string;
  concurrency: number;
  jobAttempts: number;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  matchupAggregationVersion: string;
  confidenceLevel: number;
};

export type ParticipantRankEnrichmentWorkerConfig = {
  queueName: string;
  /** Developer-key default: 1. */
  concurrency: number;
  jobAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  observationFreshnessMs: number;
  riotShared429CooldownMinMs: number;
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
    riotShared429CooldownMinMs: parseBoundedInt(
      env[RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV],
      DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
      {
        min: 0,
        max: 7 * 24 * 60 * 60_000,
        name: RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
      },
    ),
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

function parseConfidenceLevel(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new ValidationFailureError(
      'CHAMPION_AGGREGATION_CONFIDENCE_LEVEL must be a number in (0, 1).',
      { received: raw },
    );
  }
  return value;
}

function parseNonEmptyVersion(raw: string | undefined, fallback: string, name: string): string {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new ValidationFailureError(`${name} must be a non-empty string.`, { received: raw });
  }
  return value;
}

/** Load champion-aggregation worker settings from environment. */
export function loadChampionAggregationWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChampionAggregationWorkerConfig {
  return {
    queueName: env.CHAMPION_AGGREGATION_QUEUE_NAME?.trim() || CHAMPION_AGGREGATION_QUEUE_NAME,
    concurrency: parseBoundedInt(env.CHAMPION_AGGREGATION_WORKER_CONCURRENCY, 2, {
      min: 1,
      max: 32,
      name: 'CHAMPION_AGGREGATION_WORKER_CONCURRENCY',
    }),
    jobAttempts: parseBoundedInt(env.CHAMPION_AGGREGATION_JOB_ATTEMPTS, 5, {
      min: 1,
      max: 20,
      name: 'CHAMPION_AGGREGATION_JOB_ATTEMPTS',
    }),
    sourceNormalizationVersion: parseNonEmptyVersion(
      env.CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION,
      '1',
      'CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION',
    ),
    aggregationVersion: parseNonEmptyVersion(
      env.CHAMPION_AGGREGATION_VERSION,
      '2',
      'CHAMPION_AGGREGATION_VERSION',
    ),
    matchupAggregationVersion: parseNonEmptyVersion(
      env.CHAMPION_MATCHUP_AGGREGATION_VERSION,
      '1',
      'CHAMPION_MATCHUP_AGGREGATION_VERSION',
    ),
    confidenceLevel: parseConfidenceLevel(env.CHAMPION_AGGREGATION_CONFIDENCE_LEVEL, 0.95),
  };
}

/**
 * Load participant-rank enrichment worker settings from environment.
 * Defaults stay conservative for developer-key operation (concurrency 1).
 */
export function loadParticipantRankEnrichmentWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ParticipantRankEnrichmentWorkerConfig {
  return {
    queueName:
      env.PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME?.trim() || PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME,
    concurrency: parseBoundedInt(env.PARTICIPANT_RANK_ENRICHMENT_WORKER_CONCURRENCY, 1, {
      min: 1,
      max: 8,
      name: 'PARTICIPANT_RANK_ENRICHMENT_WORKER_CONCURRENCY',
    }),
    jobAttempts: parseBoundedInt(env.PARTICIPANT_RANK_ENRICHMENT_JOB_ATTEMPTS, 5, {
      min: 1,
      max: 20,
      name: 'PARTICIPANT_RANK_ENRICHMENT_JOB_ATTEMPTS',
    }),
    backoffBaseMs: parseBoundedInt(env.PARTICIPANT_RANK_ENRICHMENT_BACKOFF_BASE_MS, 2000, {
      min: 100,
      max: 60_000,
      name: 'PARTICIPANT_RANK_ENRICHMENT_BACKOFF_BASE_MS',
    }),
    backoffMaxMs: parseBoundedInt(env.PARTICIPANT_RANK_ENRICHMENT_BACKOFF_MAX_MS, 60_000, {
      min: 1000,
      max: 600_000,
      name: 'PARTICIPANT_RANK_ENRICHMENT_BACKOFF_MAX_MS',
    }),
    observationFreshnessMs: parseBoundedInt(
      env.PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS,
      PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS,
      {
        min: 60_000,
        max: 7 * 24 * 60 * 60_000,
        name: 'PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS',
      },
    ),
    riotShared429CooldownMinMs: parseBoundedInt(
      env[RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV],
      DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
      {
        min: 0,
        max: 7 * 24 * 60 * 60_000,
        name: RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
      },
    ),
  };
}

export type ChampionAiProviderId = 'openai_compatible';

export type ChampionAiInsightWorkerConfig = {
  enabled: boolean;
  queueName: string;
  concurrency: number;
  jobAttempts: number;
  provider: ChampionAiProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
  maxRepairAttempts: number;
};

const DEFAULT_AI_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_AI_MODEL = 'qwen2.5:14b';

function parseFiniteNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ValidationFailureError(`${name} must be a finite number.`, { received: raw });
  }
  return value;
}

function parseNonEmptyString(raw: string | undefined, fallback: string): string {
  if (raw === undefined) {
    return fallback;
  }
  const value = raw.trim();
  if (value.length === 0) {
    return fallback;
  }
  return value;
}

function parseAiProvider(raw: string | undefined): ChampionAiProviderId {
  if (raw === undefined || raw.trim() === '') {
    return 'openai_compatible';
  }
  const value = raw.trim();
  if (value === 'openai_compatible') {
    return value;
  }
  throw new ValidationFailureError('AI_PROVIDER must be openai_compatible.', { received: raw });
}

/**
 * Load champion AI insight worker settings from environment.
 * Never contacts a provider — a down Ollama instance must not prevent startup.
 */
export function loadChampionAiInsightWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChampionAiInsightWorkerConfig {
  return {
    enabled: parseBoolean(env.AI_ENABLED, false, 'AI_ENABLED'),
    queueName: parseNonEmptyString(
      env.CHAMPION_AI_INSIGHT_QUEUE_NAME,
      CHAMPION_AI_INSIGHT_QUEUE_NAME,
    ),
    concurrency: parseBoundedInt(env.CHAMPION_AI_INSIGHT_WORKER_CONCURRENCY, 1, {
      min: 1,
      max: 8,
      name: 'CHAMPION_AI_INSIGHT_WORKER_CONCURRENCY',
    }),
    jobAttempts: parseBoundedInt(env.CHAMPION_AI_INSIGHT_JOB_ATTEMPTS, 3, {
      min: 1,
      max: 20,
      name: 'CHAMPION_AI_INSIGHT_JOB_ATTEMPTS',
    }),
    provider: parseAiProvider(env.AI_PROVIDER),
    baseUrl: parseNonEmptyString(env.AI_BASE_URL, DEFAULT_AI_BASE_URL),
    model: parseNonEmptyString(env.AI_MODEL, DEFAULT_AI_MODEL),
    apiKey: env.AI_API_KEY ?? '',
    timeoutMs: parseBoundedInt(env.AI_TIMEOUT_MS, 60_000, {
      min: 1_000,
      max: 600_000,
      name: 'AI_TIMEOUT_MS',
    }),
    temperature: parseFiniteNumber(env.AI_TEMPERATURE, 0.2, 'AI_TEMPERATURE'),
    maxOutputTokens: parseBoundedInt(env.AI_MAX_OUTPUT_TOKENS, 1200, {
      min: 1,
      max: 16_000,
      name: 'AI_MAX_OUTPUT_TOKENS',
    }),
    maxRepairAttempts: parseBoundedInt(env.AI_MAX_REPAIR_ATTEMPTS, 1, {
      min: 0,
      max: 5,
      name: 'AI_MAX_REPAIR_ATTEMPTS',
    }),
  };
}

export type PlayerPlaystyleInsightWorkerConfig = {
  enabled: boolean;
  queueName: string;
  concurrency: number;
  jobAttempts: number;
  provider: ChampionAiProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
  maxRepairAttempts: number;
};

/**
 * Load player playstyle insight worker settings from environment.
 * Never contacts a provider — a down Ollama instance must not prevent startup.
 * Boots even when AI_ENABLED=false so the queue has an idle consumer.
 */
export function loadPlayerPlaystyleInsightWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlayerPlaystyleInsightWorkerConfig {
  return {
    enabled: parseBoolean(env.AI_ENABLED, false, 'AI_ENABLED'),
    queueName: parseNonEmptyString(
      env.PLAYER_AI_PLAYSTYLE_QUEUE_NAME,
      PLAYER_AI_PLAYSTYLE_QUEUE_NAME,
    ),
    concurrency: parseBoundedInt(env.PLAYER_AI_PLAYSTYLE_WORKER_CONCURRENCY, 1, {
      min: 1,
      max: 8,
      name: 'PLAYER_AI_PLAYSTYLE_WORKER_CONCURRENCY',
    }),
    jobAttempts: parseBoundedInt(env.PLAYER_AI_PLAYSTYLE_JOB_ATTEMPTS, 3, {
      min: 1,
      max: 20,
      name: 'PLAYER_AI_PLAYSTYLE_JOB_ATTEMPTS',
    }),
    provider: parseAiProvider(env.AI_PROVIDER),
    baseUrl: parseNonEmptyString(env.AI_BASE_URL, DEFAULT_AI_BASE_URL),
    model: parseNonEmptyString(env.AI_MODEL, DEFAULT_AI_MODEL),
    apiKey: env.AI_API_KEY ?? '',
    timeoutMs: parseBoundedInt(env.AI_TIMEOUT_MS, 60_000, {
      min: 1_000,
      max: 600_000,
      name: 'AI_TIMEOUT_MS',
    }),
    temperature: parseFiniteNumber(env.AI_TEMPERATURE, 0.2, 'AI_TEMPERATURE'),
    maxOutputTokens: parseBoundedInt(env.AI_MAX_OUTPUT_TOKENS, 1200, {
      min: 1,
      max: 16_000,
      name: 'AI_MAX_OUTPUT_TOKENS',
    }),
    maxRepairAttempts: parseBoundedInt(env.AI_MAX_REPAIR_ATTEMPTS, 1, {
      min: 0,
      max: 5,
      name: 'AI_MAX_REPAIR_ATTEMPTS',
    }),
  };
}
