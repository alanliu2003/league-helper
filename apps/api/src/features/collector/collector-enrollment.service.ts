import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  UnsupportedPlatformRouteError,
  parsePlatformRoute,
} from '@league-helper/shared';
import { Prisma, type TrackedPlayer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { COLLECTOR_CONFIG } from './collector.tokens';
import type {
  CollectorEnrollmentInput,
  CollectorEnrollmentResult,
  CollectorSetStatusInput,
  CollectorSetStatusResult,
} from './collector.types';
import {
  AlreadyTrackedRollbackError,
  ensureTrackedPlayerBudgetSingleton,
  reserveLadderTrackedCreate,
  reserveTotalTrackedCreate,
} from './ladder/ladder-enrollment.budget';
import { TrackedPlayerRepository } from './tracked-player.repository';

export { COLLECTOR_CONFIG };

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

class TotalTrackedCapRejectedError extends Error {
  constructor() {
    super('TOTAL_TRACKED_CAP');
    this.name = 'TotalTrackedCapRejectedError';
  }
}

class LadderTrackedCapRejectedError extends Error {
  constructor() {
    super('LADDER_TRACKED_CAP');
    this.name = 'LadderTrackedCapRejectedError';
  }
}

@Injectable()
export class CollectorEnrollmentService {
  private readonly config: CollectorConfig;

  constructor(
    @Inject(TrackedPlayerRepository) private readonly trackedPlayers: TrackedPlayerRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /** Test / CLI factory with explicit config. */
  static create(
    trackedPlayers: TrackedPlayerRepository,
    config: CollectorConfig,
    prisma?: PrismaService,
  ): CollectorEnrollmentService {
    return new CollectorEnrollmentService(
      trackedPlayers,
      prisma ?? (null as unknown as PrismaService),
      config,
    );
  }

  /**
   * Idempotent enroll keyed by playerAccountId.
   * Preserves first enrollmentSource; repairs denormalized routes;
   * does not silently reactivate PAUSED/SUSPENDED.
   * New creates reserve against the global TrackedPlayer hard cap (and LADDER cap when source=LADDER).
   */
  async enroll(input: CollectorEnrollmentInput): Promise<CollectorEnrollmentResult> {
    const platformRoute = input.account.platformRoute;
    let normalizedPlatform: string;
    try {
      normalizedPlatform = parsePlatformRoute(platformRoute);
    } catch (error: unknown) {
      const message =
        error instanceof UnsupportedPlatformRouteError
          ? error.message
          : `Unsupported platform route: ${platformRoute}`;
      return {
        ok: false,
        playerAccountId: input.account.id,
        code: 'UNSUPPORTED_PLATFORM',
        message,
        platformRoute,
      };
    }

    if (!this.config.platformAllowlist.includes(normalizedPlatform)) {
      return {
        ok: false,
        playerAccountId: input.account.id,
        code: 'UNSUPPORTED_PLATFORM',
        message: `Platform ${normalizedPlatform} is outside COLLECTOR_PLATFORM_ALLOWLIST.`,
        platformRoute: normalizedPlatform,
      };
    }

    const existing = await this.trackedPlayers.findByPlayerAccountId(input.account.id);
    const reactivate = input.reactivate === true;

    let priority: number;
    if (input.priority !== undefined) {
      priority = clampPriority(input.priority, this.config.priorityMin, this.config.priorityMax);
    } else if (existing) {
      priority = existing.priority;
    } else {
      // Fresh roots: product/admin/bootstrap start competitive; LADDER uses ladder initial.
      // MATCH_PARTICIPANT (and other non-root paths) stay at warm baseline until activity policy runs.
      const initial =
        input.source === 'LADDER'
          ? this.config.ladderInitialPriority
          : input.source === 'MATCH_PARTICIPANT'
            ? this.config.warmPriority
            : this.config.productRootInitialPriority;
      priority = clampPriority(initial, this.config.priorityMin, this.config.priorityMax);
    }

    // Preserve first enrollmentSource on re-enroll; only used for INSERT path.
    const enrollmentSource = existing?.enrollmentSource ?? input.source;

    // Explicit seed/search/bootstrap paths always propose depth 0 (root).
    // Does not consume or consult CollectorPopulationBudget.
    const discoveryDepth = input.discoveryDepth ?? 0;

    if (existing) {
      const result = await this.trackedPlayers.upsertEnrollment({
        playerAccountId: input.account.id,
        provider: input.account.provider,
        platformRoute: normalizedPlatform,
        enrollmentSource,
        discoveryDepth,
        priority,
        reactivate,
      });

      return {
        ok: true,
        trackedPlayerId: result.trackedPlayer.id,
        playerAccountId: result.trackedPlayer.playerAccountId,
        status: result.trackedPlayer.status,
        enrollmentSource: result.trackedPlayer.enrollmentSource,
        created: result.created,
        reactivated: result.reactivated,
        platformRoute: result.trackedPlayer.platformRoute,
      };
    }

    // Prefer LadderEnrollmentService for LADDER creates; if source=LADDER reaches here,
    // still reserve ladder+total so ladderEnrolledCount stays accurate.
    try {
      const tracked = await this.createWithHardCapReservation({
        playerAccountId: input.account.id,
        provider: input.account.provider,
        platformRoute: normalizedPlatform,
        enrollmentSource: input.source,
        discoveryDepth,
        priority,
      });

      return {
        ok: true,
        trackedPlayerId: tracked.id,
        playerAccountId: tracked.playerAccountId,
        status: tracked.status,
        enrollmentSource: tracked.enrollmentSource,
        created: true,
        reactivated: false,
        platformRoute: tracked.platformRoute,
      };
    } catch (error: unknown) {
      if (error instanceof TotalTrackedCapRejectedError) {
        return {
          ok: false,
          playerAccountId: input.account.id,
          code: 'TOTAL_TRACKED_CAP',
          message: `Global TrackedPlayer hard cap reached (${this.config.totalTrackedPlayersHardCap}).`,
          platformRoute: normalizedPlatform,
        };
      }
      if (error instanceof LadderTrackedCapRejectedError) {
        return {
          ok: false,
          playerAccountId: input.account.id,
          code: 'LADDER_TRACKED_CAP',
          message: `LADDER TrackedPlayer hard cap reached (${this.config.ladderMaxTotal}).`,
          platformRoute: normalizedPlatform,
        };
      }
      if (error instanceof AlreadyTrackedRollbackError) {
        const result = await this.trackedPlayers.upsertEnrollment({
          playerAccountId: input.account.id,
          provider: input.account.provider,
          platformRoute: normalizedPlatform,
          enrollmentSource: input.source,
          discoveryDepth,
          priority,
          reactivate,
        });
        return {
          ok: true,
          trackedPlayerId: result.trackedPlayer.id,
          playerAccountId: result.trackedPlayer.playerAccountId,
          status: result.trackedPlayer.status,
          enrollmentSource: result.trackedPlayer.enrollmentSource,
          created: result.created,
          reactivated: result.reactivated,
          platformRoute: result.trackedPlayer.platformRoute,
        };
      }
      throw error;
    }
  }

  /**
   * Reserve hard-cap slot(s) then INSERT. Unique conflict → AlreadyTrackedRollbackError (TX abort).
   */
  private async createWithHardCapReservation(input: {
    playerAccountId: string;
    provider: string;
    platformRoute: string;
    enrollmentSource: CollectorEnrollmentInput['source'];
    discoveryDepth: number;
    priority: number;
  }): Promise<TrackedPlayer> {
    if (!this.prisma) {
      // Unit-test factory without prisma: fall back to legacy upsert (no hard-cap).
      const result = await this.trackedPlayers.upsertEnrollment({
        playerAccountId: input.playerAccountId,
        provider: input.provider,
        platformRoute: input.platformRoute,
        enrollmentSource: input.enrollmentSource,
        discoveryDepth: input.discoveryDepth,
        priority: input.priority,
        reactivate: false,
      });
      return result.trackedPlayer;
    }

    await ensureTrackedPlayerBudgetSingleton(this.prisma);

    return this.prisma.$transaction(async (tx) => {
      if (input.enrollmentSource === 'LADDER') {
        const reserved = await reserveLadderTrackedCreate(tx, {
          totalCap: this.config.totalTrackedPlayersHardCap,
          ladderCap: this.config.ladderMaxTotal,
        });
        if (reserved.outcome === 'skipped_total_cap') {
          throw new TotalTrackedCapRejectedError();
        }
        if (reserved.outcome === 'skipped_ladder_cap') {
          throw new LadderTrackedCapRejectedError();
        }
      } else {
        const reserved = await reserveTotalTrackedCreate(tx, {
          totalCap: this.config.totalTrackedPlayersHardCap,
        });
        if (reserved.outcome === 'skipped_total_cap') {
          throw new TotalTrackedCapRejectedError();
        }
      }

      try {
        return await tx.trackedPlayer.create({
          data: {
            playerAccountId: input.playerAccountId,
            provider: input.provider,
            platformRoute: input.platformRoute,
            enrollmentSource: input.enrollmentSource,
            discoveryDepth: input.discoveryDepth,
            status: 'ACTIVE',
            priority: input.priority,
            nextEligibleAt: new Date(),
            consecutiveFailureCount: 0,
          },
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new AlreadyTrackedRollbackError();
        }
        throw error;
      }
    });
  }

  async setPlayerStatus(input: CollectorSetStatusInput): Promise<CollectorSetStatusResult> {
    const force = input.force === true;
    const resetFailures = input.resetFailures === true;

    const updated = await this.trackedPlayers.setStatus({
      trackedPlayerId: input.trackedPlayerId,
      status: input.status,
      force,
      resetFailures,
    });

    if (!updated) {
      return {
        ok: false,
        code: 'TRACKED_PLAYER_NOT_FOUND',
        message: `Tracked player not found: ${input.trackedPlayerId}`,
        trackedPlayerId: input.trackedPlayerId,
      };
    }

    return {
      ok: true,
      trackedPlayerId: updated.id,
      status: updated.status,
      leaseCleared: force,
      failuresReset: resetFailures,
    };
  }
}

function clampPriority(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
