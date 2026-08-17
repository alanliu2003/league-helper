import { PLAYER_AI_PLAYSTYLE_QUEUE_NAME, ValidationFailureError } from '@league-helper/shared';

export type PlayerPlaystyleAiProviderId = 'openai_compatible';

export type PlayerPlaystyleAiConfig = {
  enabled: boolean;
  provider: PlayerPlaystyleAiProviderId;
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
const DEFAULT_MODEL = 'qwen2.5:14b';

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

function parseProvider(raw: string | undefined): PlayerPlaystyleAiProviderId {
  if (raw === undefined || raw.trim() === '') {
    return 'openai_compatible';
  }
  const value = raw.trim();
  if (value === 'openai_compatible') {
    return value;
  }
  throw new ValidationFailureError('AI_PROVIDER must be openai_compatible.', { received: raw });
}

export function loadPlayerPlaystyleAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlayerPlaystyleAiConfig {
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
      env.PLAYER_AI_PLAYSTYLE_QUEUE_NAME,
      PLAYER_AI_PLAYSTYLE_QUEUE_NAME,
    ),
    jobAttempts: parsePositiveInt(
      env.PLAYER_AI_PLAYSTYLE_JOB_ATTEMPTS,
      3,
      'PLAYER_AI_PLAYSTYLE_JOB_ATTEMPTS',
    ),
    stalePendingMs: parsePositiveInt(
      env.PLAYER_AI_PLAYSTYLE_STALE_PENDING_MS,
      120_000,
      'PLAYER_AI_PLAYSTYLE_STALE_PENDING_MS',
    ),
    failedRetryMs: parsePositiveInt(
      env.PLAYER_AI_PLAYSTYLE_FAILED_RETRY_MS,
      60_000,
      'PLAYER_AI_PLAYSTYLE_FAILED_RETRY_MS',
    ),
  };
}

export const PLAYER_PLAYSTYLE_AI_CONFIG = Symbol('PLAYER_PLAYSTYLE_AI_CONFIG');
