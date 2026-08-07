import { Inject, Injectable, Optional } from '@nestjs/common';
import { CollectorRunStatus, type CollectorRun, type TrackedPlayer } from '@prisma/client';
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
