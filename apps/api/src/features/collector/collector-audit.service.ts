import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CollectorRunStatus,
  TrackedPlayerEnrollmentSource,
  type CollectorRun,
  type TrackedPlayer,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { COLLECTOR_CONFIG } from './collector-enrollment.service';
import { CollectorRunRepository } from './collector-run.repository';
import type {
  CollectorAuditFinding,
  CollectorAuditFindingCode,
  CollectorAuditReport,
  CollectorAuditSeverity,
} from './collector.types';

/** Mirrors collector.config lease safety margin for injected-config audit. */
const LEASE_SAFETY_MARGIN_MS = 60_000;
const FINALIZED_RUN_AUDIT_LIMIT = 500;
const LEASED_PLAYER_AUDIT_LIMIT = 500;
const MISMATCH_AUDIT_LIMIT = 200;
const DEPTH_AUDIT_LIMIT = 50;
/** Hard max discoveryDepth from Task 4 design (config may be lower). */
const HARD_MAX_DISCOVERY_DEPTH = 3;
const HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS = 5000;

function ownerTokenPrefix(token: string): string {
  return token.length <= 8 ? token : `${token.slice(0, 8)}…`;
}

function finding(
  code: CollectorAuditFindingCode,
  severity: CollectorAuditSeverity,
  safeId: string,
  message: string,
): CollectorAuditFinding {
  return { code, severity, safeId, message };
}

@Injectable()
export class CollectorAuditService {
  private readonly config: CollectorConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollectorRunRepository) private readonly runs: CollectorRunRepository,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /** Test / CLI factory with explicit deps. */
  static create(deps: {
    prisma: PrismaService;
    runs: CollectorRunRepository;
    config: CollectorConfig;
  }): CollectorAuditService {
    return new CollectorAuditService(deps.prisma, deps.runs, deps.config);
  }

  /**
   * Read-only invariant audit for discovery/enqueue orchestration.
   * Never repairs findings, clears leases, or mutates runs.
   */
  async audit(): Promise<CollectorAuditReport> {
    const findings: CollectorAuditFinding[] = [];
    const now = new Date();

    findings.push(...this.auditTimingConfig());

    const [
      duplicateIdentityRows,
      staleRunning,
      finalizedRuns,
      leasedPlayers,
      runningRuns,
      providerMismatches,
      platformMismatches,
    ] = await Promise.all([
      this.prisma.trackedPlayer.groupBy({
        by: ['playerAccountId'],
        _count: { _all: true },
        having: { playerAccountId: { _count: { gt: 1 } } },
      }),
      // Stale threshold is staleRunAfterMs (COLLECTOR_STALE_RUN_AFTER_MS), NOT lease duration.
      this.runs.findStaleRunning(this.config.staleRunAfterMs),
      this.prisma.collectorRun.findMany({
        where: { status: { not: CollectorRunStatus.RUNNING } },
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        take: FINALIZED_RUN_AUDIT_LIMIT,
      }),
      this.prisma.trackedPlayer.findMany({
        where: { leaseOwner: { not: null } },
        select: {
          id: true,
          leaseOwner: true,
          leaseExpiresAt: true,
          platformRoute: true,
        },
        take: LEASED_PLAYER_AUDIT_LIMIT,
      }),
      this.prisma.collectorRun.findMany({
        where: { status: CollectorRunStatus.RUNNING },
        select: { id: true, ownerToken: true },
        take: 100,
      }),
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT tp.id
        FROM "TrackedPlayer" tp
        INNER JOIN "PlayerAccount" pa ON pa.id = tp."playerAccountId"
        WHERE tp.provider <> pa.provider
        LIMIT ${MISMATCH_AUDIT_LIMIT}
      `,
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT tp.id
        FROM "TrackedPlayer" tp
        INNER JOIN "PlayerAccount" pa ON pa.id = tp."playerAccountId"
        WHERE tp."platformRoute" <> pa."platformRoute"
        LIMIT ${MISMATCH_AUDIT_LIMIT}
      `,
    ]);

    for (const row of duplicateIdentityRows) {
      findings.push(
        finding(
          'DUPLICATE_TRACKED_PLAYER_IDENTITY',
          'error',
          `playerAccountId:${row.playerAccountId}`,
          `Duplicate TrackedPlayer rows for the same playerAccountId (count=${row._count._all}).`,
        ),
      );
    }

    for (const run of staleRunning) {
      findings.push(
        finding(
          'STALE_RUNNING_COLLECTOR_RUN',
          'error',
          run.id,
          `RUNNING CollectorRun startedAt is older than staleRunAfterMs=${this.config.staleRunAfterMs} (not leaseDurationMs).`,
        ),
      );
    }

    findings.push(...this.auditFinalizedRuns(finalizedRuns));
    findings.push(
      ...this.auditLeases({
        leasedPlayers,
        runningOwnerTokens: new Set(runningRuns.map((run) => run.ownerToken)),
        finalizedByOwnerToken: new Map(
          finalizedRuns.map((run) => [run.ownerToken, run] as const),
        ),
        now,
      }),
    );

    for (const row of providerMismatches) {
      findings.push(
        finding(
          'DENORMALIZED_PROVIDER_MISMATCH',
          'error',
          row.id,
          'TrackedPlayer.provider does not match linked PlayerAccount.provider.',
        ),
      );
    }

    for (const row of platformMismatches) {
      findings.push(
        finding(
          'DENORMALIZED_PLATFORM_ROUTE_MISMATCH',
          'error',
          row.id,
          'TrackedPlayer.platformRoute does not match linked PlayerAccount.platformRoute.',
        ),
      );
    }

    findings.push(...(await this.auditTask4ExpansionState(finalizedRuns)));

    return {
      ok: findings.length === 0,
      mode: 'audit',
      generatedAt: now.toISOString(),
      label: 'discovery_enqueue_orchestration',
      findingCount: findings.length,
      findings,
    };
  }

  private auditTimingConfig(): CollectorAuditFinding[] {
    const findings: CollectorAuditFinding[] = [];
    const { staleRunAfterMs, leaseDurationMs, playerTimeoutMs } = this.config;

    if (!(staleRunAfterMs > leaseDurationMs)) {
      findings.push(
        finding(
          'UNSAFE_TIMING_CONFIG',
          'error',
          'config:staleRunAfterMs',
          `staleRunAfterMs (${staleRunAfterMs}) must be greater than leaseDurationMs (${leaseDurationMs}).`,
        ),
      );
    }

    if (!(leaseDurationMs > playerTimeoutMs + LEASE_SAFETY_MARGIN_MS)) {
      findings.push(
        finding(
          'UNSAFE_TIMING_CONFIG',
          'error',
          'config:leaseDurationMs',
          `leaseDurationMs (${leaseDurationMs}) must be greater than playerTimeoutMs (${playerTimeoutMs}) + ${LEASE_SAFETY_MARGIN_MS}ms safety margin.`,
        ),
      );
    }

    return findings;
  }

  private auditFinalizedRuns(runs: CollectorRun[]): CollectorAuditFinding[] {
    const findings: CollectorAuditFinding[] = [];

    for (const run of runs) {
      if (run.finishedAt == null) {
        findings.push(
          finding(
            'FINALIZED_RUN_MISSING_FINISHED_AT',
            'error',
            run.id,
            `Non-RUNNING CollectorRun status=${run.status} is missing finishedAt.`,
          ),
        );
      }

      const outcomeSum = run.playersSucceeded + run.playersFailed + run.ownershipLost;
      if (outcomeSum !== run.playersAttempted) {
        findings.push(
          finding(
            'FINALIZED_COUNTER_MISMATCH',
            'error',
            run.id,
            `playersSucceeded+playersFailed+ownershipLost (${outcomeSum}) != playersAttempted (${run.playersAttempted}).`,
          ),
        );
      }

      if (run.playersAttempted > run.playersClaimed) {
        findings.push(
          finding(
            'PLAYERS_ATTEMPTED_EXCEEDS_CLAIMED',
            'error',
            run.id,
            `playersAttempted (${run.playersAttempted}) > playersClaimed (${run.playersClaimed}).`,
          ),
        );
      }

      if (run.matchesEnqueued > run.matchIdsDiscovered) {
        findings.push(
          finding(
            'MATCHES_ENQUEUED_EXCEEDS_DISCOVERED',
            'error',
            run.id,
            `matchesEnqueued (${run.matchesEnqueued}) > matchIdsDiscovered (${run.matchIdsDiscovered}).`,
          ),
        );
      }

      if (run.matchesSkippedComplete > run.matchIdsDiscovered) {
        findings.push(
          finding(
            'MATCHES_SKIPPED_COMPLETE_EXCEEDS_DISCOVERED',
            'error',
            run.id,
            `matchesSkippedComplete (${run.matchesSkippedComplete}) > matchIdsDiscovered (${run.matchIdsDiscovered}).`,
          ),
        );
      }
    }

    return findings;
  }

  /**
   * Task 4 read-only checks. Must NOT flag Task 3 counter equality failures
   * merely because expansion counters changed after terminal status.
   */
  private async auditTask4ExpansionState(
    finalizedRuns: CollectorRun[],
  ): Promise<CollectorAuditFinding[]> {
    const findings: CollectorAuditFinding[] = [];

    const negativeDepth = await this.prisma.trackedPlayer.findMany({
      where: { discoveryDepth: { lt: 0 } },
      select: { id: true, discoveryDepth: true },
      take: DEPTH_AUDIT_LIMIT,
    });
    for (const row of negativeDepth) {
      findings.push(
        finding(
          'NEGATIVE_DISCOVERY_DEPTH',
          'error',
          row.id,
          `TrackedPlayer.discoveryDepth=${row.discoveryDepth} is negative.`,
        ),
      );
    }

    const aboveHard = await this.prisma.trackedPlayer.findMany({
      where: { discoveryDepth: { gt: HARD_MAX_DISCOVERY_DEPTH } },
      select: { id: true, discoveryDepth: true },
      take: DEPTH_AUDIT_LIMIT,
    });
    for (const row of aboveHard) {
      findings.push(
        finding(
          'DISCOVERY_DEPTH_ABOVE_HARD_MAX',
          'error',
          row.id,
          `TrackedPlayer.discoveryDepth=${row.discoveryDepth} exceeds hard max ${HARD_MAX_DISCOVERY_DEPTH}.`,
        ),
      );
    }

    const configuredMax = this.config.expansionMaxDepth;
    if (configuredMax < HARD_MAX_DISCOVERY_DEPTH) {
      const aboveConfigured = await this.prisma.trackedPlayer.findMany({
        where: {
          discoveryDepth: { gt: configuredMax, lte: HARD_MAX_DISCOVERY_DEPTH },
        },
        select: { id: true, discoveryDepth: true },
        take: DEPTH_AUDIT_LIMIT,
      });
      for (const row of aboveConfigured) {
        findings.push(
          finding(
            'DISCOVERY_DEPTH_ABOVE_CONFIGURED_MAX',
            'warning',
            row.id,
            `TrackedPlayer.discoveryDepth=${row.discoveryDepth} exceeds configured COLLECTOR_EXPANSION_MAX_DEPTH=${configuredMax} (may predate a config lower).`,
          ),
        );
      }
    }

    const budget = await this.prisma.collectorPopulationBudget.findUnique({
      where: { id: 'singleton' },
    });
    if (!budget) {
      findings.push(
        finding(
          'MISSING_POPULATION_BUDGET_SINGLETON',
          'error',
          'CollectorPopulationBudget:singleton',
          'CollectorPopulationBudget singleton row is missing.',
        ),
      );
    } else {
      if (budget.matchParticipantEnrolledCount < 0) {
        findings.push(
          finding(
            'NEGATIVE_POPULATION_BUDGET',
            'error',
            'CollectorPopulationBudget:singleton',
            `matchParticipantEnrolledCount=${budget.matchParticipantEnrolledCount} is negative.`,
          ),
        );
      }

      const matchParticipantCount = await this.prisma.trackedPlayer.count({
        where: { enrollmentSource: TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT },
      });

      if (budget.matchParticipantEnrolledCount !== matchParticipantCount) {
        findings.push(
          finding(
            'POPULATION_BUDGET_DRIFT',
            'error',
            'CollectorPopulationBudget:singleton',
            `matchParticipantEnrolledCount=${budget.matchParticipantEnrolledCount} != COUNT(MATCH_PARTICIPANT)=${matchParticipantCount} (tolerance 0).`,
          ),
        );
      }

      if (matchParticipantCount > HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS) {
        findings.push(
          finding(
            'MATCH_PARTICIPANT_ABOVE_HARD_CAP',
            'error',
            'TrackedPlayer:MATCH_PARTICIPANT',
            `COUNT(MATCH_PARTICIPANT)=${matchParticipantCount} exceeds hard max ${HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS}.`,
          ),
        );
      } else if (matchParticipantCount > this.config.expansionMaxTrackedPlayers) {
        findings.push(
          finding(
            'MATCH_PARTICIPANT_ABOVE_CONFIGURED_CAP',
            'error',
            'TrackedPlayer:MATCH_PARTICIPANT',
            `COUNT(MATCH_PARTICIPANT)=${matchParticipantCount} exceeds configured autonomous cap ${this.config.expansionMaxTrackedPlayers}.`,
          ),
        );
      }
    }

    for (const run of finalizedRuns) {
      const expansionFields: Array<[string, number]> = [
        ['participantsConsidered', run.participantsConsidered],
        ['playersEnrolledFromParticipants', run.playersEnrolledFromParticipants],
        ['playersAlreadyTrackedFromParticipants', run.playersAlreadyTrackedFromParticipants],
        ['playersSkippedDepthLimit', run.playersSkippedDepthLimit],
        ['playersSkippedPopulationCap', run.playersSkippedPopulationCap],
      ];
      for (const [name, value] of expansionFields) {
        if (value < 0) {
          findings.push(
            finding(
              'NEGATIVE_EXPANSION_COUNTER',
              'error',
              run.id,
              `CollectorRun.${name}=${value} is negative.`,
            ),
          );
        }
      }

      // Attributed creates always reserve source quota in the same TX → equality expected.
      const sourceQuotaSum = await this.prisma.collectorRunSourceQuota.aggregate({
        where: { collectorRunId: run.id },
        _sum: { newPlayersEnrolled: true },
      });
      const sum = sourceQuotaSum._sum.newPlayersEnrolled ?? 0;
      if (sum !== run.playersEnrolledFromParticipants) {
        findings.push(
          finding(
            'SOURCE_QUOTA_RUN_MISMATCH',
            'warning',
            run.id,
            `SUM(CollectorRunSourceQuota.newPlayersEnrolled)=${sum} != playersEnrolledFromParticipants=${run.playersEnrolledFromParticipants}.`,
          ),
        );
      }
    }

    const scheduler = await this.prisma.collectorSchedulerState.findUnique({
      where: { id: 'singleton' },
    });
    if (!scheduler) {
      findings.push(
        finding(
          'MISSING_SCHEDULER_STATE_SINGLETON',
          'error',
          'CollectorSchedulerState:singleton',
          'CollectorSchedulerState singleton row is missing.',
        ),
      );
    } else {
      const ownerSet = scheduler.leaseOwner != null && scheduler.leaseOwner.length > 0;
      const expirySet = scheduler.leaseExpiresAt != null;
      if (ownerSet !== expirySet) {
        findings.push(
          finding(
            'MALFORMED_SCHEDULER_LEASE_STATE',
            'warning',
            'CollectorSchedulerState:singleton',
            ownerSet
              ? 'leaseOwner is set but leaseExpiresAt is null.'
              : 'leaseExpiresAt is set but leaseOwner is null.',
          ),
        );
      }
    }

    return findings;
  }

  private auditLeases(input: {
    leasedPlayers: Array<
      Pick<TrackedPlayer, 'id' | 'leaseOwner' | 'leaseExpiresAt' | 'platformRoute'>
    >;
    runningOwnerTokens: Set<string>;
    finalizedByOwnerToken: Map<string, CollectorRun>;
    now: Date;
  }): CollectorAuditFinding[] {
    const findings: CollectorAuditFinding[] = [];
    const allowlist = new Set(this.config.platformAllowlist);

    for (const player of input.leasedPlayers) {
      const owner = player.leaseOwner;
      if (owner == null) {
        continue;
      }

      const leaseActive =
        player.leaseExpiresAt != null && player.leaseExpiresAt.getTime() > input.now.getTime();
      const finalizedOwner = input.finalizedByOwnerToken.get(owner);
      const matchesRunning = input.runningOwnerTokens.has(owner);

      if (finalizedOwner) {
        findings.push(
          finding(
            'LEFTOVER_LEASE_FINALIZED_OWNER',
            'error',
            player.id,
            `TrackedPlayer leaseOwner prefix=${ownerTokenPrefix(owner)} matches finalized CollectorRun ${finalizedOwner.id} (status=${finalizedOwner.status}).`,
          ),
        );
      } else if (leaseActive && !matchesRunning) {
        findings.push(
          finding(
            'ORPHAN_LEASE_OWNER',
            'error',
            player.id,
            `Active leaseOwner prefix=${ownerTokenPrefix(owner)} does not match any RUNNING CollectorRun.`,
          ),
        );
      }

      if (leaseActive && !allowlist.has(player.platformRoute)) {
        findings.push(
          finding(
            'ACTIVE_LEASE_UNSUPPORTED_PLATFORM',
            'warning',
            player.id,
            `Active lease on platformRoute=${player.platformRoute} outside COLLECTOR_PLATFORM_ALLOWLIST.`,
          ),
        );
      }
    }

    return findings;
  }
}
