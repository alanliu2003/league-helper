export const DEFAULT_MATCHUP_AGGREGATION_VERSION = '1';

/** Product display floor. Rows below this are persisted but not ranked as counters. */
export const MATCHUP_DISPLAY_FLOOR = 10;

export const MATCHUP_DISPLAY_LIMITED_MAX = 19;
export const MATCHUP_DISPLAY_MODERATE_MAX = 29;

export const MATCHUP_RANKING_TOP_N = 8;

/**
 * Matchup-specific confidence bands. Do not reuse champion ranking floor 30
 * as a hide-row threshold — pair data is much sparser.
 *
 * n < 10  INSUFFICIENT (hidden from Strong/Weak)
 * 10–19   LOW (limited sample; shown, no strength styling)
 * 20–29   MEDIUM
 * 30+     HIGH
 */
export const MATCHUP_SAMPLE_CONFIDENCE_THRESHOLDS = {
  insufficientBelow: MATCHUP_DISPLAY_FLOOR,
  lowBelow: MATCHUP_DISPLAY_LIMITED_MAX + 1,
  mediumBelow: MATCHUP_DISPLAY_MODERATE_MAX + 1,
} as const;

export type MatchupRankingPolicy = 'WILSON_LOWER_BOUND';

export const MATCHUP_RANKING_POLICY: MatchupRankingPolicy = 'WILSON_LOWER_BOUND';
