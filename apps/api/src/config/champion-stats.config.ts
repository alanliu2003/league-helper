import {
  PlatformRouteSchema,
  RANKED_SOLO_QUEUE_ID,
  ValidationFailureError,
  type PlatformRoute,
} from '@league-helper/shared';

/**
 * Champion stats API read configuration.
 *
 * Version alignment (ops):
 * - API aggregate reads use `CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION`
 *   as the authoritative `sourceNormalizationVersion` (same as the worker).
 * - `MATCH_NORMALIZATION_VERSION` is numeric and applies to match ingestion only.
 *   Keep it aligned with the aggregation source version in deployment, but do
 *   not read it here for champion-stats queries.
 * - `CHAMPION_AGGREGATION_VERSION` must match the worker materialization version.
 *
 * Default queue: `CHAMPION_AGGREGATION_DEFAULT_QUEUE_ID` when set, else 420
 * (Ranked Solo/Duo). Same name as worker/UI defaults — do not invent aliases.
 */
export type ChampionStatsConfig = {
  defaultPlatform: PlatformRoute;
  defaultQueueId: number;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  /** Insufficient-sample threshold (default 30). */
  minimumSample: number;
  confidenceLevel: number;
  cacheTtlSeconds: number;
  buildAggregationVersion: string;
  matchupAggregationVersion: string;
  matchupDisplayFloor: number;
};

function parseRequiredPlatform(raw: string | undefined): PlatformRoute {
  if (raw === undefined || raw.trim() === '') {
    throw new ValidationFailureError(
      'CHAMPION_STATS_DEFAULT_PLATFORM is required and must be a valid PlatformRoute.',
      { received: raw ?? null },
    );
  }
  const parsed = PlatformRouteSchema.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) {
    throw new ValidationFailureError(
      'CHAMPION_STATS_DEFAULT_PLATFORM must be a valid PlatformRoute.',
      { received: raw },
    );
  }
  return parsed.data;
}

function parseNonEmptyVersion(raw: string | undefined, fallback: string, name: string): string {
  if (raw === undefined) {
    return fallback;
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new ValidationFailureError(`${name} must be a non-empty string.`, { received: raw });
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

export function loadChampionStatsConfig(env: NodeJS.ProcessEnv = process.env): ChampionStatsConfig {
  return {
    defaultPlatform: parseRequiredPlatform(env.CHAMPION_STATS_DEFAULT_PLATFORM),
    defaultQueueId: parseNonNegativeInt(
      env.CHAMPION_AGGREGATION_DEFAULT_QUEUE_ID,
      RANKED_SOLO_QUEUE_ID,
      'CHAMPION_AGGREGATION_DEFAULT_QUEUE_ID',
    ),
    sourceNormalizationVersion: parseNonEmptyVersion(
      env.CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION,
      '1',
      'CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION',
    ),
    aggregationVersion: parseNonEmptyVersion(
      env.CHAMPION_AGGREGATION_VERSION,
      '1',
      'CHAMPION_AGGREGATION_VERSION',
    ),
    minimumSample: parsePositiveInt(
      env.CHAMPION_AGGREGATION_MIN_SAMPLE,
      30,
      'CHAMPION_AGGREGATION_MIN_SAMPLE',
    ),
    confidenceLevel: parseConfidenceLevel(env.CHAMPION_AGGREGATION_CONFIDENCE_LEVEL, 0.95),
    cacheTtlSeconds: parsePositiveInt(
      env.CHAMPION_STATS_CACHE_TTL_SECONDS,
      60,
      'CHAMPION_STATS_CACHE_TTL_SECONDS',
    ),
    buildAggregationVersion: parseNonEmptyVersion(
      env.CHAMPION_BUILD_AGGREGATION_VERSION,
      '1',
      'CHAMPION_BUILD_AGGREGATION_VERSION',
    ),
    matchupAggregationVersion: parseNonEmptyVersion(
      env.CHAMPION_MATCHUP_AGGREGATION_VERSION,
      '1',
      'CHAMPION_MATCHUP_AGGREGATION_VERSION',
    ),
    matchupDisplayFloor: parsePositiveInt(
      env.CHAMPION_MATCHUP_DISPLAY_FLOOR,
      10,
      'CHAMPION_MATCHUP_DISPLAY_FLOOR',
    ),
  };
}

export const CHAMPION_STATS_CONFIG = Symbol('CHAMPION_STATS_CONFIG');
