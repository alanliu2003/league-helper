import { MatchAnalyticsValidationError } from '../errors';
import {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
} from '../sentinels/aggregate-sentinels';
import {
  assertExactChampionDimensions,
  assertMaterializedChampionDimensions,
  type ExactChampionDimensions,
  type MaterializedChampionDimensions,
} from './aggregate-dimensions';
import { buildChampionAggregateDimensionKey } from './aggregate-keys';

export type ChampionRollupPolicy = {
  readonly includeExact: boolean;
  readonly includeAllTier: boolean;
  readonly includeAllPositions: boolean;
  readonly includeAllTierAndPosition: boolean;
  readonly includeAllPlatform: boolean;
  readonly includeAllRegionalRoute: boolean;
  readonly includeAllQueue: boolean;
};

export const DEFAULT_CHAMPION_ROLLUP_POLICY: ChampionRollupPolicy = {
  includeExact: true,
  includeAllTier: true,
  includeAllPositions: true,
  includeAllTierAndPosition: false,
  includeAllPlatform: false,
  includeAllRegionalRoute: false,
  includeAllQueue: false,
} as const;

function cloneWith(
  exact: ExactChampionDimensions,
  overrides: Partial<MaterializedChampionDimensions>,
): MaterializedChampionDimensions {
  return {
    ...exact,
    ...overrides,
  };
}

/**
 * Expand exact dimensions into materialized rollup tuples.
 * Default policy emits exact, ALL-tier, and ALL-position only (no ALL×ALL,
 * no ALL platform/region/queue).
 */
export function expandChampionDimensionTuples(
  exact: ExactChampionDimensions,
  policy: ChampionRollupPolicy = DEFAULT_CHAMPION_ROLLUP_POLICY,
): MaterializedChampionDimensions[] {
  assertExactChampionDimensions(exact);

  const candidates: MaterializedChampionDimensions[] = [];

  if (policy.includeExact) {
    candidates.push(cloneWith(exact, {}));
  }

  if (policy.includeAllTier) {
    candidates.push(cloneWith(exact, { rankTier: ALL_RANK_TIER_SENTINEL }));
  }

  if (policy.includeAllPositions) {
    candidates.push(cloneWith(exact, { position: ALL_POSITION_SENTINEL }));
  }

  if (policy.includeAllTierAndPosition) {
    candidates.push(
      cloneWith(exact, {
        rankTier: ALL_RANK_TIER_SENTINEL,
        position: ALL_POSITION_SENTINEL,
      }),
    );
  }

  if (policy.includeAllPlatform) {
    candidates.push(cloneWith(exact, { platformRoute: ALL_PLATFORM_ROUTE_SENTINEL }));
  }

  if (policy.includeAllRegionalRoute) {
    candidates.push(cloneWith(exact, { regionalRoute: ALL_REGIONAL_ROUTE_SENTINEL }));
  }

  if (policy.includeAllQueue) {
    candidates.push(cloneWith(exact, { queueId: ALL_QUEUE_ID_SENTINEL }));
  }

  const unique = new Map<string, MaterializedChampionDimensions>();
  for (const candidate of candidates) {
    // Default path never emits ALL platform/region/queue; those reserved sentinels
    // fail materialized assertion when selected by an explicit non-default policy.
    if (
      candidate.platformRoute === ALL_PLATFORM_ROUTE_SENTINEL ||
      candidate.regionalRoute === ALL_REGIONAL_ROUTE_SENTINEL ||
      candidate.queueId === ALL_QUEUE_ID_SENTINEL
    ) {
      throw new MatchAnalyticsValidationError(
        'ALL platform/regionalRoute/queue materialization is reserved and not supported by default validators.',
        'RESERVED_ALL_DIMENSION_UNSUPPORTED',
      );
    }
    assertMaterializedChampionDimensions(candidate);
    unique.set(buildChampionAggregateDimensionKey(candidate), candidate);
  }

  return [...unique.values()];
}
