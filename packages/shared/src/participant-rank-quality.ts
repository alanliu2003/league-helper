import type { ParticipantRankResolutionStatus } from './participant-rank-resolution';

export type RankResolutionStateCounts = {
  PENDING: number;
  FAILED_RETRYABLE: number;
  RESOLVED_RANKED: number;
  RESOLVED_UNRANKED: number;
  FAILED_PERMANENT: number;
  NOT_APPLICABLE: number;
};

export type RankQualityMetrics = {
  /** Samples with a terminal rank outcome (ranked / unranked / permanent-unavailable). */
  rankClassifiedSampleCount: number;
  /** Samples still awaiting a successful terminal lookup. */
  rankUnresolvedSampleCount: number;
  /**
   * Permanent technical/data gaps (FAILED_PERMANENT).
   * Exposed separately — never counted as product UNKNOWN.
   */
  permanentUnavailableSampleCount: number;
  /**
   * (RESOLVED_RANKED + RESOLVED_UNRANKED + FAILED_PERMANENT) / eligible ranked denominator.
   * FAILED_PERMANENT remains a finalized terminal for resolution coverage, but is not UNKNOWN.
   * null when denominator is 0 (insufficient / N/A — never report 0% unhealthy).
   */
  rankResolutionCoverage: number | null;
  /**
   * RESOLVED_RANKED / eligible ranked denominator.
   * FAILED_PERMANENT stays in the denominator (no exact rank) — does not hide coverage gaps.
   * null when denominator is 0.
   */
  exactRankCoverage: number | null;
  stateCounts: RankResolutionStateCounts;
};

/**
 * Exact-coverage health bands (locked M12-v2 product semantics).
 * RED + RANK_COVERAGE_UNHEALTHY when exact < 0.60.
 */
export type ExactRankCoverageHealth =
  | 'INSUFFICIENT_DENOMINATOR'
  | 'RED'
  | 'YELLOW'
  | 'HEALTHY_ISH'
  | 'MATURE';

export const RANK_COVERAGE_UNHEALTHY_WARNING = 'RANK_COVERAGE_UNHEALTHY' as const;

export type ExactRankCoverageHealthResult = {
  health: ExactRankCoverageHealth;
  exactRankCoverage: number | null;
  warningCode: typeof RANK_COVERAGE_UNHEALTHY_WARNING | null;
};

const EMPTY_COUNTS: RankResolutionStateCounts = {
  PENDING: 0,
  FAILED_RETRYABLE: 0,
  RESOLVED_RANKED: 0,
  RESOLVED_UNRANKED: 0,
  FAILED_PERMANENT: 0,
  NOT_APPLICABLE: 0,
};

export function emptyRankResolutionStateCounts(): RankResolutionStateCounts {
  return { ...EMPTY_COUNTS };
}

/**
 * Eligible ranked-queue samples for coverage denominators.
 * Excludes NOT_APPLICABLE (non-ranked queues).
 */
export function rankCoverageDenominator(counts: RankResolutionStateCounts): number {
  return (
    counts.PENDING +
    counts.FAILED_RETRYABLE +
    counts.RESOLVED_RANKED +
    counts.RESOLVED_UNRANKED +
    counts.FAILED_PERMANENT
  );
}

export function computeRankQualityMetrics(
  counts: RankResolutionStateCounts,
): RankQualityMetrics {
  const denominator = rankCoverageDenominator(counts);
  const resolvedTerminal =
    counts.RESOLVED_RANKED + counts.RESOLVED_UNRANKED + counts.FAILED_PERMANENT;
  const unresolved = counts.PENDING + counts.FAILED_RETRYABLE;

  return {
    rankClassifiedSampleCount: resolvedTerminal,
    rankUnresolvedSampleCount: unresolved,
    permanentUnavailableSampleCount: counts.FAILED_PERMANENT,
    rankResolutionCoverage: denominator === 0 ? null : resolvedTerminal / denominator,
    exactRankCoverage: denominator === 0 ? null : counts.RESOLVED_RANKED / denominator,
    stateCounts: { ...counts },
  };
}

/**
 * Classify exactRankCoverage into locked health bands.
 * Boundaries: [0, 0.60) RED, [0.60, 0.80) YELLOW, [0.80, 0.90) HEALTHY_ISH, [0.90, 1] MATURE.
 */
export function classifyExactRankCoverageHealth(
  exactRankCoverage: number | null,
): ExactRankCoverageHealthResult {
  if (exactRankCoverage == null || !Number.isFinite(exactRankCoverage)) {
    return {
      health: 'INSUFFICIENT_DENOMINATOR',
      exactRankCoverage: null,
      warningCode: null,
    };
  }

  if (exactRankCoverage < 0.6) {
    return {
      health: 'RED',
      exactRankCoverage,
      warningCode: RANK_COVERAGE_UNHEALTHY_WARNING,
    };
  }
  if (exactRankCoverage < 0.8) {
    return {
      health: 'YELLOW',
      exactRankCoverage,
      warningCode: null,
    };
  }
  if (exactRankCoverage < 0.9) {
    return {
      health: 'HEALTHY_ISH',
      exactRankCoverage,
      warningCode: null,
    };
  }
  return {
    health: 'MATURE',
    exactRankCoverage,
    warningCode: null,
  };
}

export function bumpRankResolutionStateCount(
  counts: RankResolutionStateCounts,
  status: ParticipantRankResolutionStatus,
  amount = 1,
): void {
  counts[status] += amount;
}
