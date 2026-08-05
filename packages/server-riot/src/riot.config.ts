import { ProviderNotConfiguredError, ValidationFailureError } from '@league-helper/shared';

export type RiotProviderMode = 'real' | 'mock';

export type RiotConfig = {
  apiKey: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  maxRetryDelayMs: number;
  baseDomain: string;
  providerMode: RiotProviderMode;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_BASE_DOMAIN = 'api.riotgames.com';
const DEFAULT_PROVIDER_MODE: RiotProviderMode = 'mock';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;
const MIN_RETRIES = 0;
const MAX_RETRIES = 5;
const MIN_RETRY_DELAY_MS = 0;
const MAX_RETRY_DELAY_MS = 60_000;

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

function parseProviderMode(raw: string | undefined): RiotProviderMode {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PROVIDER_MODE;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'real' || normalized === 'mock') {
    return normalized;
  }

  throw new ValidationFailureError('RIOT_PROVIDER_MODE must be "real" or "mock".', {
    received: raw,
  });
}

function parseBaseDomain(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_BASE_DOMAIN).trim().toLowerCase();
  if (value !== 'api.riotgames.com') {
    throw new ValidationFailureError(
      'RIOT_API_BASE_DOMAIN must be the approved Riot domain api.riotgames.com.',
      { received: raw },
    );
  }
  return value;
}

/** Load and validate Riot server-side configuration from environment variables. */
export function loadRiotConfig(env: NodeJS.ProcessEnv = process.env): RiotConfig {
  const apiKeyRaw = env.RIOT_API_KEY?.trim();
  const apiKey = apiKeyRaw && apiKeyRaw.length > 0 ? apiKeyRaw : undefined;

  return {
    apiKey,
    timeoutMs: parseBoundedInt(env.RIOT_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, {
      min: MIN_TIMEOUT_MS,
      max: MAX_TIMEOUT_MS,
      name: 'RIOT_API_TIMEOUT_MS',
    }),
    maxRetries: parseBoundedInt(env.RIOT_API_MAX_RETRIES, DEFAULT_MAX_RETRIES, {
      min: MIN_RETRIES,
      max: MAX_RETRIES,
      name: 'RIOT_API_MAX_RETRIES',
    }),
    maxRetryDelayMs: parseBoundedInt(env.RIOT_API_MAX_RETRY_DELAY_MS, DEFAULT_MAX_RETRY_DELAY_MS, {
      min: MIN_RETRY_DELAY_MS,
      max: MAX_RETRY_DELAY_MS,
      name: 'RIOT_API_MAX_RETRY_DELAY_MS',
    }),
    baseDomain: parseBaseDomain(env.RIOT_API_BASE_DOMAIN),
    providerMode: parseProviderMode(env.RIOT_PROVIDER_MODE),
  };
}

export function requireRiotApiKey(config: RiotConfig): string {
  if (!config.apiKey) {
    throw new ProviderNotConfiguredError(
      'RIOT_API_KEY is required when using the real Riot provider.',
    );
  }
  return config.apiKey;
}

export function isRiotProviderConfigured(config: RiotConfig): boolean {
  return config.providerMode === 'mock' || Boolean(config.apiKey);
}
