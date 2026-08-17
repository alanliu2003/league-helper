import type { PrismaClient } from '@prisma/client';
import { ChampionAggregationProcessingStatus, MatchIngestionStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { ChampionAggregationJobPayload } from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { evaluateMatchEligibility } from '../../queues/champion-aggregation/eligibility.js';
import type { AggregateCliFilters } from './parse-args.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

export type StatusChampionAggregatesInput = {
  prisma: PrismaClient;
  queue: Queue<ChampionAggregationJobPayload>;
  config: ChampionAggregationWorkerConfig;
  minSample: number;
  filters?: AggregateCliFilters;
};

export type StatusChampionAggregatesReport = {
  ok: boolean;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  eligibleMatches: number;
  eligibleParticipants: number;
  aggregateRowCountCurrentVersions: number;
  aggregateRowCountOlderVersions: number;
  rowsByPatch: Array<{ patch: string; count: number }>;
  rowsBelowMinimumSample: number;
  minimumSample: number;
  latestCalculatedAt: string | null;
  latestEligibleMatchAt: string | null;
  processingMarkers: {
    completed: number;
    failed: number;
  };
  pendingRecalculationScopes: number;
  queue: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  };
  workerCount: number | null;
  error?: string;
};

export type StatusChampionAggregatesResult = {
  exitCode: number;
  report: StatusChampionAggregatesReport;
};

/**
 * Read-only champion aggregation status. Exit nonzero only when the command fails —
 * presence of failed BullMQ jobs does not fail the command.
 */
export async function runStatusChampionAggregates(
  input: StatusChampionAggregatesInput,
): Promise<StatusChampionAggregatesResult> {
  const versions = {
    sourceNormalizationVersion: input.config.sourceNormalizationVersion,
    aggregationVersion: input.config.aggregationVersion,
  };

  try {
    const matches = await input.prisma.match.findMany({
      where: {
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        remake: false,
        normalizationVersion: versions.sourceNormalizationVersion,
        ...(input.filters?.patch ? { normalizedPatch: input.filters.patch } : {}),
        ...(input.filters?.queueId !== undefined ? { queueId: input.filters.queueId } : {}),
        ...(input.filters?.platformRoute
          ? { platformRoute: input.filters.platformRoute }
          : {}),
      },
      select: {
        id: true,
        ingestionStatus: true,
        remake: true,
        normalizationVersion: true,
        normalizedPatch: true,
        platformRoute: true,
        regionalRoute: true,
        queueId: true,
        mapId: true,
        gameMode: true,
        gameCreation: true,
        gameEndTimestamp: true,
        gameDurationSeconds: true,
        participants: {
          select: {
            participantId: true,
            championId: true,
            teamId: true,
            teamPosition: true,
            individualPosition: true,
            lane: true,
            role: true,
            rankTierAtIngestion: true,
            rankResolutionStatus: true,
            win: true,
            kills: true,
            deaths: true,
            assists: true,
            totalCs: true,
            timePlayedSeconds: true,
            totalDamageDealtToChampions: true,
            visionScore: true,
            goldEarned: true,
            goldDifferenceAt10: true,
            goldDifferenceAt15: true,
            csDifferenceAt10: true,
            csDifferenceAt15: true,
          },
        },
      },
    });

    let eligibleMatches = 0;
    let eligibleParticipants = 0;
    for (const match of matches) {
      const { participants, ...matchRow } = match;
      const eligibility = evaluateMatchEligibility(matchRow, participants, versions);
      if (!eligibility.eligible) {
        continue;
      }
      eligibleMatches += 1;
      eligibleParticipants += eligibility.contributors.length;
    }

    const currentWhere = {
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
    };

    const [
      aggregateRowCountCurrentVersions,
      aggregateRowCountOlderVersions,
      rowsByPatchGrouped,
      rowsBelowMinimumSample,
      latestCalculated,
      latestEligible,
      completedMarkers,
      failedMarkers,
      pendingRecalculationScopes,
      queueCounts,
    ] = await Promise.all([
      input.prisma.championAggregate.count({ where: currentWhere }),
      input.prisma.championAggregate.count({
        where: {
          OR: [
            { sourceNormalizationVersion: { not: versions.sourceNormalizationVersion } },
            { aggregationVersion: { not: versions.aggregationVersion } },
          ],
        },
      }),
      input.prisma.championAggregate.groupBy({
        by: ['patch'],
        where: currentWhere,
        _count: { _all: true },
        orderBy: { patch: 'asc' },
      }),
      input.prisma.championAggregate.count({
        where: { ...currentWhere, sampleSize: { lt: input.minSample } },
      }),
      input.prisma.championAggregate.findFirst({
        where: currentWhere,
        orderBy: { calculatedAt: 'desc' },
        select: { calculatedAt: true },
      }),
      input.prisma.championAggregate.findFirst({
        where: { ...currentWhere, latestEligibleMatchAt: { not: null } },
        orderBy: { latestEligibleMatchAt: 'desc' },
        select: { latestEligibleMatchAt: true },
      }),
      input.prisma.championAggregationProcessing.count({
        where: {
          ...currentWhere,
          status: ChampionAggregationProcessingStatus.COMPLETED,
        },
      }),
      input.prisma.championAggregationProcessing.count({
        where: {
          ...currentWhere,
          status: ChampionAggregationProcessingStatus.FAILED,
        },
      }),
      input.prisma.championAggregationRecalcScope.count({
        where: currentWhere,
      }),
      input.queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    ]);

    let workerCount: number | null = null;
    try {
      const workers = await input.queue.getWorkers();
      workerCount = workers.length;
    } catch {
      workerCount = null;
    }

    const report: StatusChampionAggregatesReport = {
      ok: true,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      eligibleMatches,
      eligibleParticipants,
      aggregateRowCountCurrentVersions,
      aggregateRowCountOlderVersions,
      rowsByPatch: rowsByPatchGrouped.map((row) => ({
        patch: row.patch,
        count: row._count._all,
      })),
      rowsBelowMinimumSample,
      minimumSample: input.minSample,
      latestCalculatedAt: latestCalculated?.calculatedAt.toISOString() ?? null,
      latestEligibleMatchAt: latestEligible?.latestEligibleMatchAt?.toISOString() ?? null,
      processingMarkers: {
        completed: completedMarkers,
        failed: failedMarkers,
      },
      pendingRecalculationScopes,
      queue: {
        waiting: queueCounts.waiting ?? 0,
        active: queueCounts.active ?? 0,
        delayed: queueCounts.delayed ?? 0,
        completed: queueCounts.completed ?? 0,
        failed: queueCounts.failed ?? 0,
      },
      workerCount,
    };

    return { exitCode: EXIT_SUCCESS, report };
  } catch (error: unknown) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
        eligibleMatches: 0,
        eligibleParticipants: 0,
        aggregateRowCountCurrentVersions: 0,
        aggregateRowCountOlderVersions: 0,
        rowsByPatch: [],
        rowsBelowMinimumSample: 0,
        minimumSample: input.minSample,
        latestCalculatedAt: null,
        latestEligibleMatchAt: null,
        processingMarkers: { completed: 0, failed: 0 },
        pendingRecalculationScopes: 0,
        queue: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
        workerCount: null,
        error: error instanceof Error ? error.message.slice(0, 200) : 'STATUS_FAILED',
      },
    };
  }
}
