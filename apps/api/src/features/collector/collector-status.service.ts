import { Inject, Injectable, Optional } from '@nestjs/common';
import { CollectorRunStatus, type CollectorRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { isSchedulerLeaseOwnerPresent } from './collector-cli.output';
import { CollectorCoverageService } from './collector-coverage.service';
import { computeEffectivePlatforms } from './collector-eligibility.service';
import { COLLECTOR_CONFIG } from './collector-enrollment.service';
import { CollectorRunRepository } from './collector-run.repository';
import {
  COLLECTOR_PROVIDER,
  type CollectorRunCounters,
  type CollectorStatusReport,
  type CollectorStatusRunSummary,
} from './collector.types';
import { TrackedPlayerRepository } from './tracked-player.repository';

const RECENT_FINALIZED_LIMIT = 20;
const FAILURE_CODE_LIMIT = 20;

export type CollectorStatusInput = {
  platformFilter?: string | null;
  queueId?: number;
  /** When false, skip coverage snapshot (tests / faster path). Default true. */
  includeCoverage?: boolean;
};

function parseEffectivePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === 'string');
}

function toCounters(run: CollectorRun): CollectorRunCounters {
  return {
    playersClaimed: run.playersClaimed,
    playersAttempted: run.playersAttempted,
    playersSucceeded: run.playersSucceeded,
    playersFailed: run.playersFailed,
    ownershipLost: run.ownershipLost,
    matchIdsDiscovered: run.matchIdsDiscovered,
    matchesEnqueued: run.matchesEnqueued,
    matchesSkippedComplete: run.matchesSkippedComplete,
    rateLimitStops: run.rateLimitStops,
    budgetExhausted: run.budgetExhausted,
    failureCode: run.failureCode,
  };
}

function toExpansionCounters(run: CollectorRun): CollectorStatusRunSummary['expansionCounters'] {
  return {
    participantsConsidered: run.participantsConsidered,
    playersEnrolledFromParticipants: run.playersEnrolledFromParticipants,
    playersAlreadyTrackedFromParticipants: run.playersAlreadyTrackedFromParticipants,
    playersSkippedDepthLimit: run.playersSkippedDepthLimit,
    playersSkippedPopulationCap: run.playersSkippedPopulationCap,
  };
}

function toRunSummary(run: CollectorRun): CollectorStatusRunSummary {
  return {
    runId: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    effectivePlatforms: parseEffectivePlatforms(run.effectivePlatforms),
    queueId: run.queueId,
    counters: toCounters(run),
    failureCode: run.failureCode,
    expansionCounters: toExpansionCounters(run),
    expansionCountersLabel: 'ASYNC_POST_FINALIZATION_EXPANSION_METRICS',
  };
}

function countsByKey(
  rows: Array<{ key: string | null; count: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.key == null) {
      continue;
    }
    out[row.key] = row.count;
  }
  return out;
}

@Injectable()
export class CollectorStatusService {
  private readonly config: CollectorConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollectorRunRepository) private readonly runs: CollectorRunRepository,
    @Inject(TrackedPlayerRepository) private readonly trackedPlayers: TrackedPlayerRepository,
    @Inject(CollectorCoverageService) private readonly coverage: CollectorCoverageService,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /** Test / CLI factory with explicit deps. */
  static create(deps: {
    prisma: PrismaService;
    runs: CollectorRunRepository;
    trackedPlayers: TrackedPlayerRepository;
    coverage: CollectorCoverageService;
    config: CollectorConfig;
  }): CollectorStatusService {
    return new CollectorStatusService(
      deps.prisma,
      deps.runs,
      deps.trackedPlayers,
      deps.coverage,
      deps.config,
    );
  }

  /**
   * Read-only operational snapshot for discovery/enqueue orchestration.
   * Never mutates runs, leases, player status, or enqueues work.
   */
  async report(input: CollectorStatusInput = {}): Promise<CollectorStatusReport> {
    const queueId = input.queueId ?? 420;
    const effectivePlatforms = computeEffectivePlatforms(
      this.config.platformAllowlist,
      input.platformFilter,
    );
    const now = new Date();
    const warnings: string[] = [];

    const [
      activeRunningRows,
      staleRunningRows,
      recentFinalizedRows,
      byStatusRows,
      byPlatformRows,
      bySourceRows,
      byDepthRows,
      totalTrackedPlayers,
      eligibleNow,
      activelyLeased,
      expiredLeases,
      nextEligibleAgg,
      failureCodeRows,
      populationBudget,
      schedulerState,
    ] = await Promise.all([
      this.prisma.collectorRun.findMany({
        where: { status: CollectorRunStatus.RUNNING },
        orderBy: { startedAt: 'asc' },
        take: 100,
      }),
      // Stale threshold is staleRunAfterMs (COLLECTOR_STALE_RUN_AFTER_MS), NOT lease duration.
      this.runs.findStaleRunning(this.config.staleRunAfterMs),
      this.prisma.collectorRun.findMany({
        where: { status: { not: CollectorRunStatus.RUNNING } },
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        take: RECENT_FINALIZED_LIMIT,
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['platformRoute'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['enrollmentSource'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['discoveryDepth'],
        _count: { _all: true },
      }),
      this.prisma.trackedPlayer.count(),
      this.trackedPlayers.countEligible({
        platformRoutes: effectivePlatforms,
        provider: COLLECTOR_PROVIDER,
      }),
      this.prisma.trackedPlayer.count({
        where: {
          leaseOwner: { not: null },
          leaseExpiresAt: { gt: now },
        },
      }),
      this.prisma.trackedPlayer.count({
        where: {
          leaseOwner: { not: null },
          leaseExpiresAt: { lte: now },
        },
      }),
      this.prisma.trackedPlayer.aggregate({
        where: { status: 'ACTIVE' },
        _min: { nextEligibleAt: true },
      }),
      this.prisma.trackedPlayer.groupBy({
        by: ['lastFailureCode'],
        where: { lastFailureCode: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { lastFailureCode: 'desc' } },
        take: FAILURE_CODE_LIMIT,
      }),
      this.prisma.collectorPopulationBudget.findUnique({
        where: { id: 'singleton' },
      }),
      this.prisma.collectorSchedulerState.findUnique({
        where: { id: 'singleton' },
      }),
    ]);

    const activeRunning = activeRunningRows.map(toRunSummary);
    const staleRunning = staleRunningRows.map(toRunSummary);
    const recentFinalized = recentFinalizedRows.map(toRunSummary);

    if (staleRunning.length > 0) {
      warnings.push(
        `${staleRunning.length} RUNNING CollectorRun(s) older than staleRunAfterMs=${this.config.staleRunAfterMs} (read-only report; no repair).`,
      );
    }

    let coverage: CollectorStatusReport['coverage'] = null;
    if (input.includeCoverage !== false) {
      coverage = await this.coverage.snapshotSafe({
        effectivePlatforms,
        queueId,
      });
      if (coverage.status !== 'available') {
        warnings.push(
          coverage.warning
            ? `coverage ${coverage.status}: ${coverage.warning}`
            : `coverage ${coverage.status}`,
        );
      }
    }

    const budgetUsed = populationBudget?.matchParticipantEnrolledCount ?? 0;
    const budgetCap = this.config.expansionMaxTrackedPlayers;

    return {
      ok: true,
      mode: 'status',
      generatedAt: now.toISOString(),
      label: 'discovery_enqueue_orchestration',
      config: {
        staleRunAfterMs: this.config.staleRunAfterMs,
        leaseDurationMs: this.config.leaseDurationMs,
        platformAllowlist: [...this.config.platformAllowlist],
        schedulerEnabled: this.config.schedulerEnabled,
        expandFromParticipants: this.config.expandFromParticipants,
        expansionMaxTrackedPlayers: budgetCap,
        expansionMaxDepth: this.config.expansionMaxDepth,
      },
      runState: {
        activeRunning,
        staleRunning,
        recentFinalized,
      },
      trackedPopulation: {
        byStatus: countsByKey(
          byStatusRows.map((row) => ({ key: row.status, count: row._count._all })),
        ),
        byPlatform: countsByKey(
          byPlatformRows.map((row) => ({
            key: row.platformRoute,
            count: row._count._all,
          })),
        ),
        byEnrollmentSource: countsByKey(
          bySourceRows.map((row) => ({
            key: row.enrollmentSource,
            count: row._count._all,
          })),
        ),
        byDiscoveryDepth: countsByKey(
          byDepthRows.map((row) => ({
            key: String(row.discoveryDepth),
            count: row._count._all,
          })),
        ),
        totalTrackedPlayers,
        autonomousParticipantBudget: {
          matchParticipantEnrolledCount: budgetUsed,
          expansionMaxTrackedPlayers: budgetCap,
          remainingAutonomousSlots: Math.max(0, budgetCap - budgetUsed),
        },
        eligibleNow,
        activelyLeased,
        expiredLeases,
        nextEligibleAt: nextEligibleAgg._min.nextEligibleAt?.toISOString() ?? null,
        recentFailureCodes: failureCodeRows
          .filter((row): row is typeof row & { lastFailureCode: string } => row.lastFailureCode != null)
          .map((row) => ({
            code: row.lastFailureCode,
            count: row._count._all,
          })),
      },
      scheduler: {
        enabled: this.config.schedulerEnabled,
        leaseOwnerPresent: isSchedulerLeaseOwnerPresent(schedulerState?.leaseOwner),
        leaseExpiresAt: schedulerState?.leaseExpiresAt?.toISOString() ?? null,
        lastTriggerAt: schedulerState?.lastTriggerAt?.toISOString() ?? null,
        lastOutcome: schedulerState?.lastOutcome ?? null,
        lastCollectorRunId: schedulerState?.lastCollectorRunId ?? null,
        lastErrorCode: schedulerState?.lastErrorCode ?? null,
        cooldownUntil: schedulerState?.cooldownUntil?.toISOString() ?? null,
      },
      coverage,
      warnings,
    };
  }
}
