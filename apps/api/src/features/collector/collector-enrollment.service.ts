import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  UnsupportedPlatformRouteError,
  parsePlatformRoute,
} from '@league-helper/shared';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import type {
  CollectorEnrollmentInput,
  CollectorEnrollmentResult,
  CollectorSetStatusInput,
  CollectorSetStatusResult,
} from './collector.types';
import { TrackedPlayerRepository } from './tracked-player.repository';

export const COLLECTOR_CONFIG = Symbol('COLLECTOR_CONFIG');

@Injectable()
export class CollectorEnrollmentService {
  private readonly config: CollectorConfig;

  constructor(
    @Inject(TrackedPlayerRepository) private readonly trackedPlayers: TrackedPlayerRepository,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /** Test / CLI factory with explicit config. */
  static create(
    trackedPlayers: TrackedPlayerRepository,
    config: CollectorConfig,
  ): CollectorEnrollmentService {
    return new CollectorEnrollmentService(trackedPlayers, config);
  }

  /**
   * Idempotent enroll keyed by playerAccountId.
   * Preserves first enrollmentSource; repairs denormalized routes;
   * does not silently reactivate PAUSED/SUSPENDED.
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
      priority = clampPriority(0, this.config.priorityMin, this.config.priorityMax);
    }

    // Preserve first enrollmentSource on re-enroll; only used for INSERT path.
    const enrollmentSource = existing?.enrollmentSource ?? input.source;

    // Explicit seed/search/bootstrap paths always propose depth 0 (root).
    // Does not consume or consult CollectorPopulationBudget.
    const discoveryDepth = input.discoveryDepth ?? 0;

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
