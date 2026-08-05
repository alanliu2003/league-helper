import {
  NormalizedPositionSchema,
  RankTierSchema,
  type NormalizedPosition,
  type RankTier,
} from '@league-helper/shared';
import { MatchAnalyticsValidationError } from '../errors';
import {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
} from '../sentinels/aggregate-sentinels';
import {
  isAllPlatformRoute,
  isAllQueueId,
  isAllRegionalRoute,
} from '../sentinels/public-sentinel-mapping';

export type ExactChampionRankTier = RankTier | typeof UNKNOWN_RANK_TIER_SENTINEL;
export type ExactChampionPosition = NormalizedPosition;

export type MaterializedChampionRankTier = ExactChampionRankTier | typeof ALL_RANK_TIER_SENTINEL;
export type MaterializedChampionPosition = ExactChampionPosition | typeof ALL_POSITION_SENTINEL;

export type ExactChampionDimensions = {
  readonly patch: string;
  readonly platformRoute: string;
  readonly regionalRoute: string;
  readonly queueId: number;
  readonly rankTier: ExactChampionRankTier;
  readonly position: ExactChampionPosition;
  readonly championId: number;
  readonly sourceNormalizationVersion: string;
  readonly aggregationVersion: string;
};

export type MaterializedChampionDimensions = {
  readonly patch: string;
  readonly platformRoute: string;
  readonly regionalRoute: string;
  readonly queueId: number;
  readonly rankTier: MaterializedChampionRankTier;
  readonly position: MaterializedChampionPosition;
  readonly championId: number;
  readonly sourceNormalizationVersion: string;
  readonly aggregationVersion: string;
};

const RANK_TIER_VALUES = new Set<string>(RankTierSchema.options);
const NORMALIZED_POSITION_VALUES = new Set<string>(NormalizedPositionSchema.options);

const RAW_RIOT_POSITIONS = new Set([
  'UTILITY',
  'SOLO',
  'DUO',
  'DUO_CARRY',
  'DUO_SUPPORT',
]);

function assertNonEmptyString(value: unknown, field: string, code: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MatchAnalyticsValidationError(`${field} must be a non-empty string.`, code);
  }
}

function assertFiniteInteger(value: unknown, field: string, code: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new MatchAnalyticsValidationError(`${field} must be a finite integer.`, code);
  }
}

function assertConcretePlatformRoute(value: unknown): asserts value is string {
  assertNonEmptyString(value, 'platformRoute', 'INVALID_PLATFORM_ROUTE');
  if (isAllPlatformRoute(value) || value === ALL_PLATFORM_ROUTE_SENTINEL) {
    throw new MatchAnalyticsValidationError(
      'platformRoute must not be the ALL sentinel.',
      'ALL_PLATFORM_ROUTE_FORBIDDEN',
    );
  }
}

function assertConcreteRegionalRoute(value: unknown): asserts value is string {
  assertNonEmptyString(value, 'regionalRoute', 'INVALID_REGIONAL_ROUTE');
  if (isAllRegionalRoute(value) || value === ALL_REGIONAL_ROUTE_SENTINEL) {
    throw new MatchAnalyticsValidationError(
      'regionalRoute must not be the ALL sentinel.',
      'ALL_REGIONAL_ROUTE_FORBIDDEN',
    );
  }
}

function assertConcreteQueueId(value: unknown): asserts value is number {
  assertFiniteInteger(value, 'queueId', 'INVALID_QUEUE_ID');
  if (isAllQueueId(value) || value === ALL_QUEUE_ID_SENTINEL) {
    throw new MatchAnalyticsValidationError(
      'queueId must not be the ALL sentinel.',
      'ALL_QUEUE_ID_FORBIDDEN',
    );
  }
}

function assertExactRankTier(value: unknown): asserts value is ExactChampionRankTier {
  if (value === ALL_RANK_TIER_SENTINEL) {
    throw new MatchAnalyticsValidationError(
      'rankTier must not be ALL on exact dimensions.',
      'ALL_RANK_TIER_FORBIDDEN',
    );
  }
  if (value === UNKNOWN_RANK_TIER_SENTINEL) {
    return;
  }
  if (typeof value !== 'string' || !RANK_TIER_VALUES.has(value)) {
    throw new MatchAnalyticsValidationError(
      'rankTier must be a RankTier or UNKNOWN.',
      'INVALID_RANK_TIER',
    );
  }
}

function assertMaterializedRankTier(value: unknown): asserts value is MaterializedChampionRankTier {
  if (value === ALL_RANK_TIER_SENTINEL || value === UNKNOWN_RANK_TIER_SENTINEL) {
    return;
  }
  if (typeof value !== 'string' || !RANK_TIER_VALUES.has(value)) {
    throw new MatchAnalyticsValidationError(
      'rankTier must be a RankTier, UNKNOWN, or ALL.',
      'INVALID_RANK_TIER',
    );
  }
}

function assertNormalizedPositionValue(
  value: unknown,
  allowAll: boolean,
): asserts value is MaterializedChampionPosition {
  if (typeof value !== 'string') {
    throw new MatchAnalyticsValidationError(
      'position must be a NormalizedPosition' + (allowAll ? ' or ALL.' : '.'),
      'INVALID_POSITION',
    );
  }

  if (RAW_RIOT_POSITIONS.has(value)) {
    throw new MatchAnalyticsValidationError(
      'position must be a NormalizedPosition; raw Riot positions are forbidden.',
      'RAW_RIOT_POSITION_FORBIDDEN',
    );
  }

  if (value === ALL_POSITION_SENTINEL) {
    if (!allowAll) {
      throw new MatchAnalyticsValidationError(
        'position must not be ALL on exact dimensions.',
        'ALL_POSITION_FORBIDDEN',
      );
    }
    return;
  }

  if (!NORMALIZED_POSITION_VALUES.has(value)) {
    throw new MatchAnalyticsValidationError(
      'position must be a NormalizedPosition' + (allowAll ? ' or ALL.' : '.'),
      'INVALID_POSITION',
    );
  }
}

function assertSharedDimensionFields(dims: {
  patch: unknown;
  platformRoute: unknown;
  regionalRoute: unknown;
  queueId: unknown;
  championId: unknown;
  sourceNormalizationVersion: unknown;
  aggregationVersion: unknown;
}): void {
  assertNonEmptyString(dims.patch, 'patch', 'INVALID_PATCH');
  assertConcretePlatformRoute(dims.platformRoute);
  assertConcreteRegionalRoute(dims.regionalRoute);
  assertConcreteQueueId(dims.queueId);
  assertFiniteInteger(dims.championId, 'championId', 'INVALID_CHAMPION_ID');
  if (dims.championId <= 0) {
    throw new MatchAnalyticsValidationError(
      'championId must be a positive finite integer.',
      'INVALID_CHAMPION_ID',
    );
  }
  assertNonEmptyString(
    dims.sourceNormalizationVersion,
    'sourceNormalizationVersion',
    'INVALID_SOURCE_NORMALIZATION_VERSION',
  );
  assertNonEmptyString(
    dims.aggregationVersion,
    'aggregationVersion',
    'INVALID_AGGREGATION_VERSION',
  );
}

export function assertExactChampionDimensions(
  dims: ExactChampionDimensions,
): asserts dims is ExactChampionDimensions {
  assertSharedDimensionFields(dims);
  assertExactRankTier(dims.rankTier);
  assertNormalizedPositionValue(dims.position, false);
}

export function assertMaterializedChampionDimensions(
  dims: MaterializedChampionDimensions,
): asserts dims is MaterializedChampionDimensions {
  assertSharedDimensionFields(dims);
  assertMaterializedRankTier(dims.rankTier);
  assertNormalizedPositionValue(dims.position, true);
}
