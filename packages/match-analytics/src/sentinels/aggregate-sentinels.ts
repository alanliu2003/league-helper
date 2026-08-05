/** Reserved ALL platform route sentinel (unused by default M8 materialization). */
export const ALL_PLATFORM_ROUTE_SENTINEL = '' as const;

/** Reserved ALL regional route sentinel (unused by default M8 materialization). */
export const ALL_REGIONAL_ROUTE_SENTINEL = '' as const;

/** Reserved ALL queue sentinel (unused by default M8 materialization). */
export const ALL_QUEUE_ID_SENTINEL = -1 as const;

/** Materialized ALL rank-tier rollup sentinel. */
export const ALL_RANK_TIER_SENTINEL = 'ALL' as const;

/** Unknown rank-tier sentinel (distinct from ALL). */
export const UNKNOWN_RANK_TIER_SENTINEL = 'UNKNOWN' as const;

/** Materialized ALL position rollup sentinel. */
export const ALL_POSITION_SENTINEL = 'ALL' as const;

/** Unknown position sentinel (distinct from ALL). */
export const UNKNOWN_POSITION_SENTINEL = 'UNKNOWN' as const;
