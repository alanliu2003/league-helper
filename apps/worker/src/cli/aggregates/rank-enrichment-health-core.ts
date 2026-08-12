import type { PrismaClient } from '@prisma/client';
import { MatchIngestionStatus } from '@prisma/client';
import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  bumpRankResolutionStateCount,
  classifyExactRankCoverageHealth,
  computeRankQualityMetrics,
  emptyRankResolutionStateCounts,
  type ExactRankCoverageHealth,
  type ParticipantRankResolutionStatus,
  type RankQualityMetrics,
  type RankResolutionStateCounts,
} from '@league-helper/shared';
import type { AggregateCliFilters } from './parse-args.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

const RANKED_QUEUE_IDS = [RANKED_SOLO_QUEUE_ID, RANKED_FLEX_QUEUE_ID] as const;

export type RankEnrichmentHealthInput = {
  prisma: PrismaClient;
  filters?: AggregateCliFilters;
};

export type RankEnrichmentHealthReport = {
  ok: boolean;
  eligibleRankedParticipants: number;
  stateCounts: RankResolutionStateCounts;
  permanentUnavailableSampleCount: number;
  rankResolutionCoverage: number | null;
  exactRankCoverage: number | null;
  health: ExactRankCoverageHealth;
  warning: string | null;
  metrics: RankQualityMetrics;
  error?: string;
};

export type RankEnrichmentHealthResult = {
  exitCode: number;
  report: RankEnrichmentHealthReport;
};

/**
 * Operational rank-enrichment health from MatchParticipant resolution statuses.
 * Denominator excludes NOT_APPLICABLE. Zero denominator → INSUFFICIENT_DENOMINATOR (not RED).
 */
export async function runRankEnrichmentHealth(
  input: RankEnrichmentHealthInput,
): Promise<RankEnrichmentHealthResult> {
  try {
    const groups = await input.prisma.matchParticipant.groupBy({
      by: ['rankResolutionStatus'],
      where: {
        match: {
          ingestionStatus: MatchIngestionStatus.COMPLETED,
          remake: false,
          queueId: {
            in:
              input.filters?.queueId !== undefined
                ? [input.filters.queueId]
                : [...RANKED_QUEUE_IDS],
          },
          ...(input.filters?.patch ? { normalizedPatch: input.filters.patch } : {}),
          ...(input.filters?.platformRoute
            ? { platformRoute: input.filters.platformRoute }
            : {}),
        },
      },
      _count: { _all: true },
    });

    const counts = emptyRankResolutionStateCounts();
    for (const group of groups) {
      bumpRankResolutionStateCount(
        counts,
        group.rankResolutionStatus as ParticipantRankResolutionStatus,
        group._count._all,
      );
    }

    const metrics = computeRankQualityMetrics(counts);
    const healthResult = classifyExactRankCoverageHealth(metrics.exactRankCoverage);
    const eligible =
      counts.PENDING +
      counts.FAILED_RETRYABLE +
      counts.RESOLVED_RANKED +
      counts.RESOLVED_UNRANKED +
      counts.FAILED_PERMANENT;

    return {
      exitCode: EXIT_SUCCESS,
      report: {
        ok: true,
        eligibleRankedParticipants: eligible,
        stateCounts: metrics.stateCounts,
        permanentUnavailableSampleCount: metrics.permanentUnavailableSampleCount,
        rankResolutionCoverage: metrics.rankResolutionCoverage,
        exactRankCoverage: metrics.exactRankCoverage,
        health: healthResult.health,
        warning: healthResult.warningCode,
        metrics,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        eligibleRankedParticipants: 0,
        stateCounts: emptyRankResolutionStateCounts(),
        permanentUnavailableSampleCount: 0,
        rankResolutionCoverage: null,
        exactRankCoverage: null,
        health: 'INSUFFICIENT_DENOMINATOR',
        warning: null,
        metrics: computeRankQualityMetrics(emptyRankResolutionStateCounts()),
        error: message,
      },
    };
  }
}
