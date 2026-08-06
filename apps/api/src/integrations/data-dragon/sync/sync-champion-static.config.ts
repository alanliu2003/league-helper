import { ValidationFailureError } from '@league-helper/shared';

export type ChampionStaticSyncConfig = {
  locale: string;
  requestTimeoutMs: number;
  baseUrl: string;
  /** 'latest' or a pinned Data Dragon version string. */
  version: string;
  minChampions: number;
  maxRetries: number;
  maxRetryDelayMs: number;
};

const DEFAULT_LOCALE = 'en_US';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_VERSION = 'latest';
const DEFAULT_MIN_CHAMPIONS = 100;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;
/** Approved Data Dragon CDN host — no arbitrary URL configuration. */
const APPROVED_BASE_URL = 'https://ddragon.leagueoflegends.com';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;
const MIN_CHAMPIONS = 1;
const MAX_CHAMPIONS = 10_000;
const MIN_RETRIES = 0;
const MAX_RETRIES = 10;

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

function parseLocale(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_LOCALE).trim();
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(value)) {
    throw new ValidationFailureError('DATA_DRAGON_LOCALE must look like en_US (language_REGION).', {
      received: raw,
    });
  }
  return value;
}

function parseVersion(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_VERSION).trim();
  if (!value) {
    throw new ValidationFailureError('DATA_DRAGON_VERSION must not be empty.', { received: raw });
  }
  if (value === 'latest') {
    return value;
  }
  // Pinned CDN versions look like 16.10.1 (at least major.minor.patch digits).
  if (!/^\d+\.\d+(\.\d+)?$/.test(value)) {
    throw new ValidationFailureError(
      'DATA_DRAGON_VERSION must be "latest" or a Data Dragon version like 16.10.1.',
      { received: raw },
    );
  }
  return value;
}

/** Load and validate champion static sync configuration (no API key). */
export function loadChampionStaticSyncConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ChampionStaticSyncConfig {
  return {
    locale: parseLocale(env.DATA_DRAGON_LOCALE),
    requestTimeoutMs: parseBoundedInt(
      env.DATA_DRAGON_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      {
        min: MIN_TIMEOUT_MS,
        max: MAX_TIMEOUT_MS,
        name: 'DATA_DRAGON_REQUEST_TIMEOUT_MS',
      },
    ),
    baseUrl: APPROVED_BASE_URL,
    version: parseVersion(env.DATA_DRAGON_VERSION),
    minChampions: parseBoundedInt(
      env.DATA_DRAGON_SYNC_MIN_CHAMPIONS,
      DEFAULT_MIN_CHAMPIONS,
      {
        min: MIN_CHAMPIONS,
        max: MAX_CHAMPIONS,
        name: 'DATA_DRAGON_SYNC_MIN_CHAMPIONS',
      },
    ),
    maxRetries: parseBoundedInt(env.DATA_DRAGON_SYNC_MAX_RETRIES, DEFAULT_MAX_RETRIES, {
      min: MIN_RETRIES,
      max: MAX_RETRIES,
      name: 'DATA_DRAGON_SYNC_MAX_RETRIES',
    }),
    maxRetryDelayMs: DEFAULT_MAX_RETRY_DELAY_MS,
  };
}
