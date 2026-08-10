import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TrackedPlayer, TrackedPlayerEnrollmentSource, TrackedPlayerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isPermanentCollectorFailureCode,
  isRateLimitedCollectorFailureCode,
} from './collector.failure-codes';
import {
  TRACKED_PLAYER_ELIGIBILITY_ORDER_SQL,
  TRACKED_PLAYER_ELIGIBILITY_WHERE_SQL,
} from './tracked-player.eligibility';

function cryptoRandomUuid(): string {
  return randomUUID();
}

type ClaimQueryClient = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

export type ClaimEligibleWaveInput = {
  platformRoutes: string[];
  provider: string;
  limit: number;
  ownerToken: string;
  leaseDurationMs: number;
};

export type ListEligiblePreviewInput = {
  platformRoutes: string[];
  provider: string;
  limit: number;
};

export type UpsertTrackedPlayerEnrollmentInput = {
  playerAccountId: string;
  provider: string;
  platformRoute: string;
  enrollmentSource: TrackedPlayerEnrollmentSource;
  /** Proposed discovery depth; INSERT uses it, UPDATE applies LEAST(existing, proposed). */
  discoveryDepth: number;
  priority: number;
  /** When true, PAUSED/SUSPENDED become ACTIVE with nextEligibleAt = now(). */
  reactivate: boolean;
};

export type UpsertTrackedPlayerEnrollmentResult = {
  trackedPlayer: TrackedPlayer;
  created: boolean;
  reactivated: boolean;
};

export type SetTrackedPlayerStatusInput = {
  trackedPlayerId: string;
  status: TrackedPlayerStatus;
  force: boolean;
  resetFailures: boolean;
};

export type FinalizeSuccessInput = {
  trackedPlayerId: string;
  ownerToken: string;
  /** Delay until next eligibility (from activity refresh policy). */
  nextEligibleDelayMs: number;
  /** Absolute activity-tier priority (bounded by caller/config). */
  priority: number;
  /** Persisted successful zero-new streak after this finalize. */
  consecutiveZeroNewMatchRuns: number;
};

export type FinalizeFailureInput = {
  trackedPlayerId: string;
  ownerToken: string;
  failureCode: string;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxBackoffExponent: number;
  /** Normalized retry-after for RATE_LIMITED; ignored otherwise. */
  retryAfterMs?: number | null;
};

export type OwnerProtectedUpdateResult = {
  updated: boolean;
  status?: TrackedPlayer['status'];
};

function msIntervalLiteral(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0 || !Number.isInteger(ms)) {
    throw new Error(`Invalid interval milliseconds: ${ms}`);
  }
  return `${ms} milliseconds`;
}

@Injectable()
export class TrackedPlayerRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<TrackedPlayer | null> {
    return this.prisma.trackedPlayer.findUnique({ where: { id } });
  }

  findByPlayerAccountId(playerAccountId: string): Promise<TrackedPlayer | null> {
    return this.prisma.trackedPlayer.findUnique({ where: { playerAccountId } });
  }

  /**
   * Idempotent enrollment keyed by playerAccountId.
   * Preserves first enrollmentSource; repairs denormalized provider/platform;
   * applies discoveryDepth via LEAST on update (never increases depth);
   * does not silently reactivate PAUSED/SUSPENDED unless reactivate=true.
   * Uses DB now() for initial / reactivation eligibility.
   * Does not read or mutate CollectorPopulationBudget.
   */
  async upsertEnrollment(
    input: UpsertTrackedPlayerEnrollmentInput,
  ): Promise<UpsertTrackedPlayerEnrollmentResult> {
    if (!Number.isInteger(input.discoveryDepth) || input.discoveryDepth < 0) {
      throw new Error(`Invalid discoveryDepth: ${input.discoveryDepth}`);
    }

    const existing = await this.findByPlayerAccountId(input.playerAccountId);

    if (!existing) {
      const rows = await this.prisma.$queryRawUnsafe<TrackedPlayer[]>(
        `
        INSERT INTO "TrackedPlayer" (
          id,
          "playerAccountId",
          provider,
          "platformRoute",
          "enrollmentSource",
          "discoveryDepth",
          status,
          priority,
          "nextEligibleAt",
          "consecutiveFailureCount",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          $1::text,
          $2::text,
          $3::text,
          $4::text,
          $5::"TrackedPlayerEnrollmentSource",
          $6::int,
          'ACTIVE'::"TrackedPlayerStatus",
          $7::int,
          now(),
          0,
          now(),
          now()
        )
        RETURNING *
        `,
        cryptoRandomUuid(),
        input.playerAccountId,
        input.provider,
        input.platformRoute,
        input.enrollmentSource,
        input.discoveryDepth,
        input.priority,
      );
      const created = rows[0];
      if (!created) {
        throw new Error('Failed to create TrackedPlayer enrollment');
      }
      return { trackedPlayer: created, created: true, reactivated: false };
    }

    const wasHold =
      existing.status === 'PAUSED' || existing.status === 'SUSPENDED';
    const shouldReactivate = input.reactivate && wasHold;

    const rows = await this.prisma.$queryRawUnsafe<TrackedPlayer[]>(
      `
      UPDATE "TrackedPlayer"
      SET
        provider = $1::text,
        "platformRoute" = $2::text,
        priority = $3::int,
        "discoveryDepth" = LEAST("discoveryDepth", $4::int),
        status = CASE
          WHEN $5::boolean THEN 'ACTIVE'::"TrackedPlayerStatus"
          ELSE status
        END,
        "nextEligibleAt" = CASE
          WHEN $5::boolean THEN now()
          ELSE "nextEligibleAt"
        END,
        "updatedAt" = now()
      WHERE id = $6::text
      RETURNING *
      `,
      input.provider,
      input.platformRoute,
      input.priority,
      input.discoveryDepth,
      shouldReactivate,
      existing.id,
    );

    const updated = rows[0];
    if (!updated) {
      throw new Error('Failed to update TrackedPlayer enrollment');
    }
    return {
      trackedPlayer: updated,
      created: false,
      reactivated: shouldReactivate,
    };
  }

  /**
   * Operator status transition. ACTIVE sets nextEligibleAt = DB now().
   * Lease cleared only with force. Failure history cleared only with resetFailures.
   */
  async setStatus(input: SetTrackedPlayerStatusInput): Promise<TrackedPlayer | null> {
    const rows = await this.prisma.$queryRawUnsafe<TrackedPlayer[]>(
      `
      UPDATE "TrackedPlayer"
      SET
        status = $1::"TrackedPlayerStatus",
        "nextEligibleAt" = CASE
          WHEN $1::"TrackedPlayerStatus" = 'ACTIVE'::"TrackedPlayerStatus" THEN now()
          ELSE "nextEligibleAt"
        END,
        "consecutiveFailureCount" = CASE
          WHEN $2::boolean THEN 0
          ELSE "consecutiveFailureCount"
        END,
        "lastFailureCode" = CASE
          WHEN $2::boolean THEN NULL
          ELSE "lastFailureCode"
        END,
        "leaseOwner" = CASE
          WHEN $3::boolean THEN NULL
          ELSE "leaseOwner"
        END,
        "leaseExpiresAt" = CASE
          WHEN $3::boolean THEN NULL
          ELSE "leaseExpiresAt"
        END,
        "updatedAt" = now()
      WHERE id = $4::text
      RETURNING *
      `,
      input.status,
      input.resetFailures,
      input.force,
      input.trackedPlayerId,
    );
    return rows[0] ?? null;
  }

  /**
   * Claim up to `limit` eligible ACTIVE players with PostgreSQL FOR UPDATE SKIP LOCKED.
   *
   * Eligibility + order shared with {@link listEligiblePreview} via tracked-player.eligibility.ts.
   *
   * @param tx Optional interactive transaction client. When omitted, runs in its own short `$transaction`.
   */
  async claimEligibleWave(
    input: ClaimEligibleWaveInput,
    tx?: ClaimQueryClient,
  ): Promise<TrackedPlayer[]> {
    if (input.limit <= 0) {
      return [];
    }
    if (input.platformRoutes.length === 0) {
      return [];
    }

    const leaseInterval = msIntervalLiteral(input.leaseDurationMs);

    const claim = async (client: ClaimQueryClient): Promise<TrackedPlayer[]> => {
      // Parameterized raw SQL — no network I/O inside this transaction.
      return client.$queryRawUnsafe<TrackedPlayer[]>(
        `
        WITH candidates AS (
          SELECT id
          FROM "TrackedPlayer"
          WHERE ${TRACKED_PLAYER_ELIGIBILITY_WHERE_SQL}
          ${TRACKED_PLAYER_ELIGIBILITY_ORDER_SQL}
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        ),
        updated AS (
          UPDATE "TrackedPlayer" AS tp
          SET
            "leaseOwner" = $4,
            "leaseExpiresAt" = now() + ($5::text)::interval,
            "lastClaimedAt" = now(),
            "updatedAt" = now()
          FROM candidates
          WHERE tp.id = candidates.id
          RETURNING tp.*
        )
        SELECT *
        FROM updated
        ${TRACKED_PLAYER_ELIGIBILITY_ORDER_SQL}
        `,
        input.platformRoutes,
        input.provider,
        input.limit,
        input.ownerToken,
        leaseInterval,
      );
    };

    if (tx) {
      return claim(tx);
    }

    return this.prisma.$transaction(async (inner) => claim(inner));
  }

  /**
   * Read-only eligibility preview: same predicates/order as claim, no FOR UPDATE / mutations.
   */
  async listEligiblePreview(input: ListEligiblePreviewInput): Promise<TrackedPlayer[]> {
    if (input.limit <= 0 || input.platformRoutes.length === 0) {
      return [];
    }

    return this.prisma.$queryRawUnsafe<TrackedPlayer[]>(
      `
      SELECT *
      FROM "TrackedPlayer"
      WHERE ${TRACKED_PLAYER_ELIGIBILITY_WHERE_SQL}
      ${TRACKED_PLAYER_ELIGIBILITY_ORDER_SQL}
      LIMIT $3
      `,
      input.platformRoutes,
      input.provider,
      input.limit,
    );
  }

  /** Count currently eligible players (same predicates as claim/preview). */
  async countEligible(input: Omit<ListEligiblePreviewInput, 'limit'>): Promise<number> {
    if (input.platformRoutes.length === 0) {
      return 0;
    }
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `
      SELECT COUNT(*)::bigint AS count
      FROM "TrackedPlayer"
      WHERE ${TRACKED_PLAYER_ELIGIBILITY_WHERE_SQL}
      `,
      input.platformRoutes,
      input.provider,
    );
    return Number(rows[0]?.count ?? 0n);
  }

  /**
   * Owner-protected success finalize. ACTIVE resets failures; PAUSED/SUSPENDED preserve them.
   * Always clears only the owned lease and advances cadence via activity policy delay.
   * Atomically persists priority + consecutiveZeroNewMatchRuns with success cadence.
   */
  async finalizeSuccess(input: FinalizeSuccessInput): Promise<OwnerProtectedUpdateResult> {
    const interval = msIntervalLiteral(input.nextEligibleDelayMs);
    if (!Number.isInteger(input.priority)) {
      throw new Error(`Invalid priority: ${input.priority}`);
    }
    if (
      !Number.isInteger(input.consecutiveZeroNewMatchRuns) ||
      input.consecutiveZeroNewMatchRuns < 0
    ) {
      throw new Error(
        `Invalid consecutiveZeroNewMatchRuns: ${input.consecutiveZeroNewMatchRuns}`,
      );
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; status: TrackedPlayer['status'] }>>(
      `
      UPDATE "TrackedPlayer"
      SET
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "lastSuccessfulRefreshAt" = now(),
        "nextEligibleAt" = now() + ($1::text)::interval,
        priority = $2::int,
        "consecutiveZeroNewMatchRuns" = $3::int,
        "consecutiveFailureCount" = CASE WHEN status = 'ACTIVE' THEN 0 ELSE "consecutiveFailureCount" END,
        "lastFailureCode" = CASE WHEN status = 'ACTIVE' THEN NULL ELSE "lastFailureCode" END,
        "updatedAt" = now()
      WHERE id = $4::text
        AND "leaseOwner" = $5::text
      RETURNING id, status
      `,
      interval,
      input.priority,
      input.consecutiveZeroNewMatchRuns,
      input.trackedPlayerId,
      input.ownerToken,
    );

    const row = rows[0];
    if (!row) {
      return { updated: false };
    }
    return { updated: true, status: row.status };
  }

  /**
   * Owner-protected failure finalize with bounded exponential backoff computed atomically from
   * count-before-increment. Permanent suspension only when failureCode is a known permanent code.
   */
  async finalizeFailure(input: FinalizeFailureInput): Promise<OwnerProtectedUpdateResult> {
    const suspendPermanent = isPermanentCollectorFailureCode(input.failureCode);
    const retryAfterMs =
      isRateLimitedCollectorFailureCode(input.failureCode) &&
      input.retryAfterMs != null &&
      Number.isFinite(input.retryAfterMs) &&
      input.retryAfterMs > 0
        ? Math.floor(input.retryAfterMs)
        : 0;

    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; status: TrackedPlayer['status'] }>>(
      `
      UPDATE "TrackedPlayer"
      SET
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "lastFailureCode" = $1::text,
        "status" = CASE
          WHEN $2::boolean THEN 'SUSPENDED'::"TrackedPlayerStatus"
          ELSE status
        END,
        "nextEligibleAt" = now() + (
          (
            LEAST(
              $3::bigint,
              GREATEST(
                (
                  $4::numeric * power(
                    2::numeric,
                    LEAST("consecutiveFailureCount", $5::int)::numeric
                  )
                )::bigint,
                $6::bigint
              )
            )
          )::text || ' milliseconds'
        )::interval,
        "consecutiveFailureCount" = "consecutiveFailureCount" + 1,
        "updatedAt" = now()
      WHERE id = $7::text
        AND "leaseOwner" = $8::text
      RETURNING id, status
      `,
      input.failureCode,
      suspendPermanent,
      input.maxBackoffMs,
      input.baseBackoffMs,
      input.maxBackoffExponent,
      retryAfterMs,
      input.trackedPlayerId,
      input.ownerToken,
    );

    const row = rows[0];
    if (!row) {
      return { updated: false };
    }
    return { updated: true, status: row.status };
  }

  /**
   * Count unreleased leases still owned by a run token (for run finalization guards).
   * Design predicate: leaseOwner = ownerToken AND leaseExpiresAt IS NOT NULL
   * (includes expired-but-uncleared leases — do not filter on expiry vs now()).
   */
  async countOwnedUnreleasedLeases(ownerToken: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "TrackedPlayer"
      WHERE "leaseOwner" = ${ownerToken}
        AND "leaseExpiresAt" IS NOT NULL
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  /**
   * Owner-protected lease clear for a single tracked player.
   * Clears lease fields only; does not change status, cadence, or failure history.
   */
  async releaseOwnedLease(input: {
    trackedPlayerId: string;
    ownerToken: string;
  }): Promise<OwnerProtectedUpdateResult> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; status: TrackedPlayer['status'] }>>(
      `
      UPDATE "TrackedPlayer"
      SET
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = now()
      WHERE id = $1::text
        AND "leaseOwner" = $2::text
      RETURNING id, status
      `,
      input.trackedPlayerId,
      input.ownerToken,
    );
    const row = rows[0];
    if (!row) {
      return { updated: false };
    }
    return { updated: true, status: row.status };
  }

  /**
   * Best-effort release of leases still owned by a run token (unreleased-lease guard).
   * Clears lease fields only; does not change status/scheduling/failures.
   */
  async forceReleaseOwnedLeases(ownerToken: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "TrackedPlayer"
      SET
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = now()
      WHERE "leaseOwner" = $1::text
        AND "leaseExpiresAt" IS NOT NULL
      RETURNING id
      `,
      ownerToken,
    );
    return rows.length;
  }

  /** Explain plan helper for claim SQL (integration/ops diagnostics). */
  async explainClaimPlan(input: Omit<ClaimEligibleWaveInput, 'ownerToken' | 'leaseDurationMs'>): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `
      EXPLAIN
      SELECT id
      FROM "TrackedPlayer"
      WHERE ${TRACKED_PLAYER_ELIGIBILITY_WHERE_SQL}
      ${TRACKED_PLAYER_ELIGIBILITY_ORDER_SQL}
      LIMIT $3
      FOR UPDATE SKIP LOCKED
      `,
      input.platformRoutes,
      input.provider,
      input.limit,
    );

    return rows.map((row) => row['QUERY PLAN']).join('\n');
  }
}
