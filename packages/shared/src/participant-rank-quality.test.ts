import { describe, expect, it } from 'vitest';
import {
  classifyExactRankCoverageHealth,
  computeRankQualityMetrics,
  emptyRankResolutionStateCounts,
  RANK_COVERAGE_UNHEALTHY_WARNING,
} from './participant-rank-quality';

describe('computeRankQualityMetrics', () => {
  it('returns null coverages for zero denominator (empty / N/A)', () => {
    const metrics = computeRankQualityMetrics(emptyRankResolutionStateCounts());
    expect(metrics.rankResolutionCoverage).toBeNull();
    expect(metrics.exactRankCoverage).toBeNull();
    expect(metrics.rankClassifiedSampleCount).toBe(0);
    expect(metrics.rankUnresolvedSampleCount).toBe(0);
  });

  it('ignores NOT_APPLICABLE in denominator', () => {
    const counts = emptyRankResolutionStateCounts();
    counts.NOT_APPLICABLE = 100;
    counts.RESOLVED_RANKED = 8;
    counts.PENDING = 2;
    const metrics = computeRankQualityMetrics(counts);
    expect(metrics.exactRankCoverage).toBe(0.8);
    expect(metrics.rankResolutionCoverage).toBe(0.8);
    expect(metrics.rankUnresolvedSampleCount).toBe(2);
  });

  it('counts unresolved and classified correctly', () => {
    const counts = emptyRankResolutionStateCounts();
    counts.PENDING = 10;
    counts.FAILED_RETRYABLE = 5;
    counts.RESOLVED_RANKED = 20;
    counts.RESOLVED_UNRANKED = 4;
    counts.FAILED_PERMANENT = 1;
    const metrics = computeRankQualityMetrics(counts);
    expect(metrics.rankUnresolvedSampleCount).toBe(15);
    expect(metrics.rankClassifiedSampleCount).toBe(25);
    expect(metrics.permanentUnavailableSampleCount).toBe(1);
    expect(metrics.rankResolutionCoverage).toBe(25 / 40);
    expect(metrics.exactRankCoverage).toBe(20 / 40);
  });

  it('exposes FAILED_PERMANENT separately and keeps it in exact coverage denominator', () => {
    const counts = emptyRankResolutionStateCounts();
    counts.RESOLVED_RANKED = 6;
    counts.FAILED_PERMANENT = 4;
    const metrics = computeRankQualityMetrics(counts);
    expect(metrics.permanentUnavailableSampleCount).toBe(4);
    expect(metrics.stateCounts.FAILED_PERMANENT).toBe(4);
    // 6/10 — permanent-unavailable penalizes exact coverage (not excluded from denom).
    expect(metrics.exactRankCoverage).toBe(0.6);
    expect(metrics.rankResolutionCoverage).toBe(1);
  });
});

describe('classifyExactRankCoverageHealth', () => {
  it('zero denominator → INSUFFICIENT_DENOMINATOR (not RED)', () => {
    expect(classifyExactRankCoverageHealth(null)).toEqual({
      health: 'INSUFFICIENT_DENOMINATOR',
      exactRankCoverage: null,
      warningCode: null,
    });
  });

  it('boundary 0 → RED + RANK_COVERAGE_UNHEALTHY', () => {
    expect(classifyExactRankCoverageHealth(0)).toEqual({
      health: 'RED',
      exactRankCoverage: 0,
      warningCode: RANK_COVERAGE_UNHEALTHY_WARNING,
    });
  });

  it('boundary just below 0.60 → RED', () => {
    expect(classifyExactRankCoverageHealth(0.599999)).toMatchObject({
      health: 'RED',
      warningCode: RANK_COVERAGE_UNHEALTHY_WARNING,
    });
  });

  it('boundary 0.60 → YELLOW', () => {
    expect(classifyExactRankCoverageHealth(0.6)).toEqual({
      health: 'YELLOW',
      exactRankCoverage: 0.6,
      warningCode: null,
    });
  });

  it('boundary just below 0.80 → YELLOW', () => {
    expect(classifyExactRankCoverageHealth(0.799999)).toMatchObject({ health: 'YELLOW' });
  });

  it('boundary 0.80 → HEALTHY_ISH', () => {
    expect(classifyExactRankCoverageHealth(0.8)).toEqual({
      health: 'HEALTHY_ISH',
      exactRankCoverage: 0.8,
      warningCode: null,
    });
  });

  it('boundary just below 0.90 → HEALTHY_ISH', () => {
    expect(classifyExactRankCoverageHealth(0.899999)).toMatchObject({ health: 'HEALTHY_ISH' });
  });

  it('boundary 0.90 → MATURE', () => {
    expect(classifyExactRankCoverageHealth(0.9)).toEqual({
      health: 'MATURE',
      exactRankCoverage: 0.9,
      warningCode: null,
    });
  });

  it('boundary 1.0 → MATURE', () => {
    expect(classifyExactRankCoverageHealth(1)).toMatchObject({ health: 'MATURE' });
  });
});
