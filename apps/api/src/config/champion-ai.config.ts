import { CHAMPION_AI_INSIGHT_QUEUE_NAME, ValidationFailureError } from '@league-helper/shared';

export type ChampionAiProviderId = 'openai_compatible';

export type ChampionAiConfig = {
  enabled: boolean;
  provider: ChampionAiProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
  maxRepairAttempts: number;
  queueName: string;
  jobAttempts: number;
  stalePendingMs: number;
  failedRetryMs: number;
};

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:7b';

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

function parseProvider(raw: string | undefined): ChampionAiProviderId {
  if (raw === undefined || raw.trim() === '') {
    return 'openai_compatible';
  }
  const value = raw.trim();
  if (value === 'openai_compatible') {
    return value;
  }
  throw new ValidationFailureError('AI_PROVIDER must be openai_compatible.', { received: raw });
}

export function loadChampionAiConfig(env: NodeJS.ProcessEnv = process.env): ChampionAiConfig {
  return {
    enabled: parseBooleanFlag(env.AI_ENABLED, false, 'AI_ENABLED'),
    provider: parseProvider(env.AI_PROVIDER),
    baseUrl: parseNonEmptyString(env.AI_BASE_URL, DEFAULT_BASE_URL),
    model: parseNonEmptyString(env.AI_MODEL, DEFAULT_MODEL),
    apiKey: env.AI_API_KEY ?? '',
    timeoutMs: parsePositiveInt(env.AI_TIMEOUT_MS, 60_000, 'AI_TIMEOUT_MS'),
    temperature: parseFiniteNumber(env.AI_TEMPERATURE, 0.2, 'AI_TEMPERATURE'),
    maxOutputTokens: parsePositiveInt(env.AI_MAX_OUTPUT_TOKENS, 1200, 'AI_MAX_OUTPUT_TOKENS'),
    maxRepairAttempts: parseNonNegativeInt(env.AI_MAX_REPAIR_ATTEMPTS, 1, 'AI_MAX_REPAIR_ATTEMPTS'),
    queueName: parseNonEmptyString(
      env.CHAMPION_AI_INSIGHT_QUEUE_NAME,
      CHAMPION_AI_INSIGHT_QUEUE_NAME,
    ),
    jobAttempts: parsePositiveInt(
      env.CHAMPION_AI_INSIGHT_JOB_ATTEMPTS,
      3,
      'CHAMPION_AI_INSIGHT_JOB_ATTEMPTS',
    ),
    stalePendingMs: parsePositiveInt(
      env.CHAMPION_AI_INSIGHT_STALE_PENDING_MS,
      120_000,
      'CHAMPION_AI_INSIGHT_STALE_PENDING_MS',
    ),
    failedRetryMs: parsePositiveInt(
      env.CHAMPION_AI_INSIGHT_FAILED_RETRY_MS,
      60_000,
      'CHAMPION_AI_INSIGHT_FAILED_RETRY_MS',
    ),
  };
}

export const CHAMPION_AI_CONFIG = Symbol('CHAMPION_AI_CONFIG');
