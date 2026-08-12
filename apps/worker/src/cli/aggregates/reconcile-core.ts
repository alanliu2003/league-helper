import type { PrismaClient } from '@prisma/client';
import { ChampionAggregationProcessingStatus, MatchIngestionStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  ChampionAggregationJobPayloadSchema,
  buildChampionAggregationBullMqJobId,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { createChampionAggregationRepository } from '../../queues/champion-aggregation/champion-aggregation.repository.js';
import { evaluateMatchEligibility } from '../../queues/champion-aggregation/eligibility.js';
import {
  buildChampionAggregationJobOptions,
} from '../../queues/champion-aggregation/enqueue.js';
import { expandCurrentDimensionKeys } from '../../queues/champion-aggregation/previous-keys.js';
import type { AggregateCliFilters } from './parse-args.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export type ReconcileChampionAggregatesInput = {
  prisma: PrismaClient;
  queue: Queue<ChampionAggregationJobPayload>;
  config: ChampionAggregationWorkerConfig;
  dryRun: boolean;
  filters: AggregateCliFilters;
};

export type ReconcileChampionAggregatesReport = {
  ok: boolean;
  dryRun: boolean;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  scanned: number;
  current: number;
  missingMarker: number;
  failedMarker: number;
  pendingRecalculationScope: number;
  jobsEnqueued: number;
  jobsDeduplicated: number;
  failures: number;
  error?: string;
};

export type ReconcileChampionAggregatesResult = {
  exitCode: number;
  report: ReconcileChampionAggregatesReport;
};

type ActionReason = 'missing_marker' | 'failed_marker' | 'pending_scope';

/**
 * Reconcile durable processing markers / recalc scopes against eligible COMPLETED matches.
 * Enqueues deterministic jobs; safe to re-run. Does not infer currency from aggregate rows.
 */
export async function runReconcileChampionAggregates(
  input: ReconcileChampionAggregatesInput,
): Promise<ReconcileChampionAggregatesResult> {
  const versions = {
    sourceNormalizationVersion: input.config.sourceNormalizationVersion,
    aggregationVersion: input.config.aggregationVersion,
  };

  const report: ReconcileChampionAggregatesReport = {
    ok: true,
    dryRun: input.dryRun,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
    scanned: 0,
    current: 0,
    missingMarker: 0,
    failedMarker: 0,
    pendingRecalculationScope: 0,
    jobsEnqueued: 0,
    jobsDeduplicated: 0,
    failures: 0,
  };

  try {
    const repository = createChampionAggregationRepository(input.prisma);

    const matches = await input.prisma.match.findMany({
      where: {
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        remake: false,
        normalizationVersion: versions.sourceNormalizationVersion,
        ...(input.filters.patch ? { normalizedPatch: input.filters.patch } : {}),
        ...(input.filters.queueId !== undefined ? { queueId: input.filters.queueId } : {}),
        ...(input.filters.platformRoute
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
            goldDifferenceAt10: true,
            goldDifferenceAt15: true,
            csDifferenceAt10: true,
            csDifferenceAt15: true,
          },
          ...(input.filters.championId !== undefined
            ? { where: { championId: input.filters.championId } }
            : {}),
        },
      },
    });

    const actions = new Map<string, ActionReason>();

    for (const match of matches) {
      const { participants, ...matchRow } = match;
      const eligibility = evaluateMatchEligibility(matchRow, participants, versions);
      if (!eligibility.eligible) {
        continue;
      }
      report.scanned += 1;

      const marker = await repository.findProcessingMarker({
        matchId: match.id,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
      });
      const scope = await repository.loadRecalcScope({
        matchId: match.id,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
      });

      if (scope) {
        report.pendingRecalculationScope += 1;
        actions.set(match.id, 'pending_scope');
        continue;
      }

      if (!marker) {
        report.missingMarker += 1;
        actions.set(match.id, 'missing_marker');
        continue;
      }

      if (marker.status === ChampionAggregationProcessingStatus.FAILED) {
        report.failedMarker += 1;
        actions.set(match.id, 'failed_marker');
        continue;
      }

      report.current += 1;
    }

    for (const [matchId, reason] of actions) {
      const jobId = buildChampionAggregationBullMqJobId({
        matchId,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
      });

      if (input.dryRun) {
        if (reason === 'pending_scope') {
          // Scope already durable — would enqueue follow-up / re-enqueue.
        } else {
          // Would upsert empty/current scope then enqueue.
        }
        report.jobsEnqueued += 1;
        continue;
      }

      try {
        const { participants, ...matchRow } = matches.find((m) => m.id === matchId)!;
        const eligibility = evaluateMatchEligibility(matchRow, participants, versions);
        const currentKeys = eligibility.eligible
          ? expandCurrentDimensionKeys(eligibility.contributors)
          : [];

        await repository.upsertRecalcScope({
          matchId,
          sourceNormalizationVersion: versions.sourceNormalizationVersion,
          aggregationVersion: versions.aggregationVersion,
          previousDimensionKeys: currentKeys,
        });

        const payload = ChampionAggregationJobPayloadSchema.parse({
          matchId,
          sourceNormalizationVersion: versions.sourceNormalizationVersion,
          aggregationVersion: versions.aggregationVersion,
        });

        const existing = await input.queue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (LIVE_STATES.has(state)) {
            report.jobsDeduplicated += 1;
            continue;
          }
          await existing.remove();
        }

        await input.queue.add(
          CHAMPION_AGGREGATION_JOB_NAME,
          payload,
          buildChampionAggregationJobOptions(jobId, input.config.jobAttempts),
        );
        report.jobsEnqueued += 1;
      } catch {
        report.failures += 1;
      }
    }

    if (!input.dryRun && report.failures > 0) {
      report.ok = false;
      return { exitCode: EXIT_COMMAND_FAILURE, report };
    }

    return { exitCode: EXIT_SUCCESS, report };
  } catch (error: unknown) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ...report,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 200) : 'RECONCILE_FAILED',
      },
    };
  }
}
