import { ValidationFailureError } from '@league-helper/shared';

/**
 * Proactive Riot request budget (developer-key windows observed as 20:1 + 100:120).
 *
 * Defaults leave ~25% headroom for PRODUCT_SEARCH, refresh overlap, and window skew.
 * Agents must not edit real `.env`; operators copy from `.env.example`.
 */

export const RIOT_REQUEST_BUDGET_REDIS_KEY_PREFIX = 'riot:request-budget';
export const RIOT_REQUEST_BUDGET_ENABLED_ENV = 'RIOT_REQUEST_BUDGET_ENABLED';
export const RIOT_REQUEST_BUDGET_UTILIZATION_ENV = 'RIOT_REQUEST_BUDGET_UTILIZATION';

export type RiotRequestBudgetConfig = {
  enabled: boolean;
  /** Fraction of published/configured window limits to use (0–1]. Default 0.75. */
  utilization: number;
  shortLimit: number;
  shortWindowSeconds: number;
  longLimit: number;
  longWindowSeconds: number;
  /** Max share of short-window capacity enrichment may consume. Default 0.35. */
  enrichmentMaxShare: number;
  /** Short-window capacity reserved for product/search. Default 0.10. */
  productReservedShare: number;
  /**
   * Max inline sleep while waiting for budget. Longer waits throw
   * {@link RiotRequestBudgetDeferredError} so BullMQ can delay the job.
   */
  maxInlineWaitMs: number;
  /** When true, X-App-Rate-Limit* headers update observed ceilings/pressure. */
  observeHeaders: boolean;
  redisKeyPrefix: string;
};

const DEFAULTS: RiotRequestBudgetConfig = {
  enabled: true,
  utilization: 0.75,
  shortLimit: 20,
  shortWindowSeconds: 1,
  longLimit: 100,
  longWindowSeconds: 120,
  enrichmentMaxShare: 0.35,
  productReservedShare: 0.1,
  maxInlineWaitMs: 2_000,
  observeHeaders: true,
  redisKeyPrefix: RIOT_REQUEST_BUDGET_REDIS_KEY_PREFIX,
};

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
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
  throw new ValidationFailureError('Boolean env must be true/false.', { received: raw });
}

function parseBoundedNumber(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number; name: string; integer?: boolean },
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
    throw new ValidationFailureError(
      `${bounds.name} must be a number between ${bounds.min} and ${bounds.max}.`,
      { received: raw },
    );
  }
  if (bounds.integer && !Number.isInteger(value)) {
    throw new ValidationFailureError(`${bounds.name} must be an integer.`, { received: raw });
  }
  return value;
}

/** Load proactive Riot request budget config from env (examples / operator overrides). */
export function loadRiotRequestBudgetConfig(
  env: NodeJS.ProcessEnv = process.env,
): RiotRequestBudgetConfig {
  const enrichmentMaxShare = parseBoundedNumber(
    env.RIOT_REQUEST_BUDGET_ENRICHMENT_MAX_SHARE,
    DEFAULTS.enrichmentMaxShare,
    { min: 0.05, max: 0.9, name: 'RIOT_REQUEST_BUDGET_ENRICHMENT_MAX_SHARE' },
  );
  const productReservedShare = parseBoundedNumber(
    env.RIOT_REQUEST_BUDGET_PRODUCT_RESERVED_SHARE,
    DEFAULTS.productReservedShare,
    { min: 0, max: 0.5, name: 'RIOT_REQUEST_BUDGET_PRODUCT_RESERVED_SHARE' },
  );
  if (enrichmentMaxShare + productReservedShare > 0.95) {
    throw new ValidationFailureError(
      'RIOT_REQUEST_BUDGET_ENRICHMENT_MAX_SHARE + RIOT_REQUEST_BUDGET_PRODUCT_RESERVED_SHARE must be <= 0.95.',
      { enrichmentMaxShare, productReservedShare },
    );
  }

  return {
    enabled: parseBoolean(env.RIOT_REQUEST_BUDGET_ENABLED, DEFAULTS.enabled),
    utilization: parseBoundedNumber(env.RIOT_REQUEST_BUDGET_UTILIZATION, DEFAULTS.utilization, {
      min: 0.1,
      max: 1,
      name: 'RIOT_REQUEST_BUDGET_UTILIZATION',
    }),
    shortLimit: parseBoundedNumber(env.RIOT_REQUEST_BUDGET_SHORT_LIMIT, DEFAULTS.shortLimit, {
      min: 1,
      max: 10_000,
      name: 'RIOT_REQUEST_BUDGET_SHORT_LIMIT',
      integer: true,
    }),
    shortWindowSeconds: parseBoundedNumber(
      env.RIOT_REQUEST_BUDGET_SHORT_WINDOW_SECONDS,
      DEFAULTS.shortWindowSeconds,
      { min: 1, max: 3600, name: 'RIOT_REQUEST_BUDGET_SHORT_WINDOW_SECONDS', integer: true },
    ),
    longLimit: parseBoundedNumber(env.RIOT_REQUEST_BUDGET_LONG_LIMIT, DEFAULTS.longLimit, {
      min: 1,
      max: 100_000,
      name: 'RIOT_REQUEST_BUDGET_LONG_LIMIT',
      integer: true,
    }),
    longWindowSeconds: parseBoundedNumber(
      env.RIOT_REQUEST_BUDGET_LONG_WINDOW_SECONDS,
      DEFAULTS.longWindowSeconds,
      { min: 1, max: 86_400, name: 'RIOT_REQUEST_BUDGET_LONG_WINDOW_SECONDS', integer: true },
    ),
    enrichmentMaxShare,
    productReservedShare,
    maxInlineWaitMs: parseBoundedNumber(
      env.RIOT_REQUEST_BUDGET_MAX_INLINE_WAIT_MS,
      DEFAULTS.maxInlineWaitMs,
      { min: 0, max: 60_000, name: 'RIOT_REQUEST_BUDGET_MAX_INLINE_WAIT_MS', integer: true },
    ),
    observeHeaders: parseBoolean(env.RIOT_REQUEST_BUDGET_OBSERVE_HEADERS, DEFAULTS.observeHeaders),
    redisKeyPrefix: (
      env.RIOT_REQUEST_BUDGET_REDIS_KEY_PREFIX?.trim() || DEFAULTS.redisKeyPrefix
    ).replace(/\/+$/, ''),
  };
}

export function effectiveWindowLimit(limit: number, utilization: number): number {
  return Math.max(1, Math.floor(limit * utilization));
}
