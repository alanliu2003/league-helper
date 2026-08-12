import { describe, expect, it, vi } from 'vitest';
import { runRankEnrichmentHealth } from './rank-enrichment-health-core.js';

describe('runRankEnrichmentHealth', () => {
  it('reports INSUFFICIENT_DENOMINATOR when eligible denominator is 0', async () => {
    const prisma = {
      matchParticipant: {
        groupBy: vi.fn().mockResolvedValue([
          { rankResolutionStatus: 'NOT_APPLICABLE', _count: { _all: 12 } },
        ]),
      },
    };

    const result = await runRankEnrichmentHealth({ prisma: prisma as never });
    expect(result.report.eligibleRankedParticipants).toBe(0);
    expect(result.report.health).toBe('INSUFFICIENT_DENOMINATOR');
    expect(result.report.warning).toBeNull();
    expect(result.report.exactRankCoverage).toBeNull();
  });

  it('warns RANK_COVERAGE_UNHEALTHY when exact coverage < 60% with nonzero denominator', async () => {
    const prisma = {
      matchParticipant: {
        groupBy: vi.fn().mockResolvedValue([
          { rankResolutionStatus: 'PENDING', _count: { _all: 7 } },
          { rankResolutionStatus: 'RESOLVED_RANKED', _count: { _all: 2 } },
          { rankResolutionStatus: 'RESOLVED_UNRANKED', _count: { _all: 1 } },
        ]),
      },
    };

    const result = await runRankEnrichmentHealth({ prisma: prisma as never });
    expect(result.report.eligibleRankedParticipants).toBe(10);
    expect(result.report.stateCounts.PENDING).toBe(7);
    expect(result.report.stateCounts.RESOLVED_RANKED).toBe(2);
    expect(result.report.stateCounts.RESOLVED_UNRANKED).toBe(1);
    expect(result.report.exactRankCoverage).toBeCloseTo(0.2);
    expect(result.report.health).toBe('RED');
    expect(result.report.warning).toBe('RANK_COVERAGE_UNHEALTHY');
  });

  it('exposes permanentUnavailable separately from UNKNOWN semantics', async () => {
    const prisma = {
      matchParticipant: {
        groupBy: vi.fn().mockResolvedValue([
          { rankResolutionStatus: 'FAILED_PERMANENT', _count: { _all: 3 } },
          { rankResolutionStatus: 'RESOLVED_RANKED', _count: { _all: 7 } },
        ]),
      },
    };

    const result = await runRankEnrichmentHealth({ prisma: prisma as never });
    expect(result.report.permanentUnavailableSampleCount).toBe(3);
    expect(result.report.stateCounts.FAILED_PERMANENT).toBe(3);
    expect(result.report.exactRankCoverage).toBeCloseTo(0.7);
    expect(result.report.health).toBe('YELLOW');
    expect(result.report.warning).toBeNull();
  });
});
