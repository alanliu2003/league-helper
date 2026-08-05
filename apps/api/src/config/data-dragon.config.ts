import { ValidationFailureError } from '@league-helper/shared';

export type DataDragonConfig = {
  locale: string;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
  baseUrl: string;
};

const DEFAULT_LOCALE = 'en_US';
const DEFAULT_CACHE_TTL_SECONDS = 21_600;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/** Approved Data Dragon CDN host — no arbitrary URL configuration. */
const APPROVED_BASE_URL = 'https://ddragon.leagueoflegends.com';

const MIN_CACHE_TTL_SECONDS = 60;
const MAX_CACHE_TTL_SECONDS = 604_800;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;

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

/** Load and validate public Data Dragon configuration (no API key). */
export function loadDataDragonConfig(env: NodeJS.ProcessEnv = process.env): DataDragonConfig {
  return {
    locale: parseLocale(env.DATA_DRAGON_LOCALE),
    cacheTtlSeconds: parseBoundedInt(env.DATA_DRAGON_CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS, {
      min: MIN_CACHE_TTL_SECONDS,
      max: MAX_CACHE_TTL_SECONDS,
      name: 'DATA_DRAGON_CACHE_TTL_SECONDS',
    }),
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
  };
}

export const DATA_DRAGON_CONFIG = Symbol('DATA_DRAGON_CONFIG');
