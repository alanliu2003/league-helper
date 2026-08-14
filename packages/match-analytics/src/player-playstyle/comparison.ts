import type { PlayerPlaystyleDirection, PlayerPlaystyleMetricId } from '@league-helper/shared';

export const PLAYER_METRIC_NEAR_BANDS: Record<PlayerPlaystyleMetricId, number> = {
  CS_PER_MIN: 0.4,
  GOLD_PER_MIN: 25,
  DAMAGE_PER_MIN: 40,
  VISION_PER_MIN: 0.12,
  KDA: 0.35,
  KILLS_PER_GAME: 0.6,
  DEATHS_PER_GAME: 0.4,
  ASSISTS_PER_GAME: 0.8,
  GOLD_DIFF_AT_10: 120,
  GOLD_DIFF_AT_15: 180,
  CS_DIFF_AT_10: 4,
  CS_DIFF_AT_15: 6,
};

export type PlayerPlaystyleComparableDirection = Exclude<
  PlayerPlaystyleDirection,
  'NOT_COMPARABLE'
>;

/**
 * Classifies a numeric delta against the metric's inclusive near-band.
 * Does not return NOT_COMPARABLE; that is reserved for missing/ineligible data.
 */
export function classifyMetricDirection(
  metric: PlayerPlaystyleMetricId,
  delta: number,
): PlayerPlaystyleComparableDirection {
  const threshold = PLAYER_METRIC_NEAR_BANDS[metric];
  if (threshold === undefined) {
    throw new Error(`Missing near-band threshold for metric ${metric}`);
  }
  if (Math.abs(delta) <= threshold) {
    return 'NEAR_BASELINE';
  }
  return delta > 0 ? 'ABOVE_BASELINE' : 'BELOW_BASELINE';
}
