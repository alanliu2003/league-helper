import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type TrackedPlayer } from '@prisma/client';

export type QuotaRejectionReason =
  | 'total_cap'
  | 'population_cap'
  | 'run_cap'
  | 'source_cap'
  | 'missing_run_switch_unattributed';

export class QuotaRejectedError extends Error {
  readonly reason: QuotaRejectionReason;

  constructor(reason: QuotaRejectionReason) {
    super(`Participant expansion quota rejected: ${reason}`);
    this.name = 'QuotaRejectedError';
    this.reason = reason;
  }
}

/** Thrown inside TX on unique(playerAccountId) so reservations roll back. */
export class AlreadyTrackedRollbackError extends Error {
  constructor() {
    super('TrackedPlayer unique conflict — rolling back quota reservations');
    this.name = 'AlreadyTrackedRollbackError';
  }
}

export type ReserveAndCreateInput = {
  playerAccountId: string;
  provider: string;
  platformRoute: string;
  discoveryDepth: number;
  priority?: number;
  /** When set and run exists → attributed path; missing run → un-attributed. */
  sourceCollectorRunId?: string | null;
  sourceTrackedPlayerId: string;
  /** Global TrackedPlayer hard cap (all enrollment sources). */
  totalCap: number;
  /** Autonomous MATCH_PARTICIPANT population budget cap. */
  globalCap: number;
  runCap: number;
  sourceCap: number;
};

export type ReserveAndCreateResult =
  | { outcome: 'created'; trackedPlayer: TrackedPlayer; attributed: boolean }
  | { outcome: 'already_tracked'; trackedPlayer: TrackedPlayer }
  | {
      outcome:
        | 'skipped_total_cap'
        | 'skipped_population_cap'
        | 'skipped_run_cap'
        | 'skipped_source_cap';
    };

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

/**
 * Ensure CollectorTrackedPlayerBudget singleton exists (fail-closed after ensure).
 * Mirrors apps/api ladder-enrollment.budget ensureTrackedPlayerBudgetSingleton.
 */
export async function ensureTrackedPlayerBudgetSingleton(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "CollectorTrackedPlayerBudget" (id, "trackedPlayerCount", "ladderEnrolledCount", "createdAt", "updatedAt")
    SELECT
      'singleton',
      (SELECT COUNT(*)::int FROM "TrackedPlayer"),
      (SELECT COUNT(*)::int FROM "TrackedPlayer" WHERE "enrollmentSource" = 'LADDER'),
      now(),
      now()
    ON CONFLICT (id) DO NOTHING
  `;

  const row = await prisma.collectorTrackedPlayerBudget.findUnique({
    where: { id: 'singleton' },
    select: { id: true },
  });
  if (!row) {
    throw new Error('CollectorTrackedPlayerBudget singleton row is missing.');
  }
}

/**
 * Race-safe reservation + TrackedPlayer create for MATCH_PARTICIPANT.
 *
 * Lock/reservation order (deadlock-safe):
 * 1. CollectorTrackedPlayerBudget (total hard cap)
 * 2. CollectorPopulationBudget
 * 3. CollectorRun (attributed only)
 * 4. CollectorRunSourceQuota (attributed only)
 * 5. TrackedPlayer INSERT
 *
 * Unique races MUST throw inside the transaction so prior reservations roll back.
 */
export async function reserveAndCreateTrackedParticipant(
  prisma: PrismaClient,
  input: ReserveAndCreateInput,
): Promise<ReserveAndCreateResult> {
  if (!Number.isInteger(input.discoveryDepth) || input.discoveryDepth < 0) {
    throw new Error(`Invalid discoveryDepth: ${input.discoveryDepth}`);
  }
  if (!Number.isInteger(input.totalCap) || input.totalCap < 0) {
    throw new Error(`Invalid totalCap: ${input.totalCap}`);
  }

  await ensureTrackedPlayerBudgetSingleton(prisma);

  let attributed = false;
  if (input.sourceCollectorRunId) {
    const run = await prisma.collectorRun.findUnique({
      where: { id: input.sourceCollectorRunId },
      select: { id: true },
    });
    attributed = run != null;
  }

  try {
    return await executeReservationTransaction(prisma, input, attributed);
  } catch (error: unknown) {
    if (
      error instanceof QuotaRejectedError &&
      error.reason === 'missing_run_switch_unattributed'
    ) {
      // Run disappeared after pre-check — retry un-attributed (non-fatal).
      return executeReservationTransaction(prisma, input, false);
    }
    if (error instanceof AlreadyTrackedRollbackError) {
      const existing = await prisma.trackedPlayer.findUnique({
        where: { playerAccountId: input.playerAccountId },
      });
      if (!existing) {
        throw new Error('Unique conflict without existing TrackedPlayer row');
      }
      return { outcome: 'already_tracked', trackedPlayer: existing };
    }
    if (error instanceof QuotaRejectedError) {
      if (error.reason === 'total_cap') {
        return { outcome: 'skipped_total_cap' };
      }
      if (error.reason === 'population_cap') {
        return { outcome: 'skipped_population_cap' };
      }
      if (error.reason === 'run_cap') {
        return { outcome: 'skipped_run_cap' };
      }
      if (error.reason === 'source_cap') {
        return { outcome: 'skipped_source_cap' };
      }
    }
    throw error;
  }
}

async function executeReservationTransaction(
  prisma: PrismaClient,
  input: ReserveAndCreateInput,
  attributed: boolean,
): Promise<Extract<ReserveAndCreateResult, { outcome: 'created' }>> {
  const trackedPlayer = await prisma.$transaction(async (tx) => {
    // A) global TrackedPlayer hard cap (all sources)
    const totalRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "CollectorTrackedPlayerBudget"
      SET
        "trackedPlayerCount" = "trackedPlayerCount" + 1,
        "updatedAt" = now()
      WHERE id = 'singleton'
        AND "trackedPlayerCount" < ${input.totalCap}
      RETURNING id
    `;
    if (totalRows.length === 0) {
      throw new QuotaRejectedError('total_cap');
    }

    // B) global autonomous MATCH_PARTICIPANT budget
    const budgetRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "CollectorPopulationBudget"
      SET
        "matchParticipantEnrolledCount" = "matchParticipantEnrolledCount" + 1,
        "updatedAt" = now()
      WHERE id = 'singleton'
        AND "matchParticipantEnrolledCount" < ${input.globalCap}
      RETURNING id
    `;
    if (budgetRows.length === 0) {
      throw new QuotaRejectedError('population_cap');
    }

    if (attributed && input.sourceCollectorRunId) {
      // C) per-run reservation
      const runRows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "CollectorRun"
        SET
          "playersEnrolledFromParticipants" = "playersEnrolledFromParticipants" + 1,
          "updatedAt" = now()
        WHERE id = ${input.sourceCollectorRunId}
          AND "playersEnrolledFromParticipants" < ${input.runCap}
        RETURNING id
      `;
      if (runRows.length === 0) {
        const stillExists = await tx.collectorRun.findUnique({
          where: { id: input.sourceCollectorRunId },
          select: { id: true },
        });
        if (!stillExists) {
          throw new QuotaRejectedError('missing_run_switch_unattributed');
        }
        throw new QuotaRejectedError('run_cap');
      }

      // D) per-source-per-run reservation
      await tx.$executeRaw`
        INSERT INTO "CollectorRunSourceQuota" (
          id,
          "collectorRunId",
          "sourceTrackedPlayerId",
          "newPlayersEnrolled",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${randomUUID()},
          ${input.sourceCollectorRunId},
          ${input.sourceTrackedPlayerId},
          0,
          now(),
          now()
        )
        ON CONFLICT ("collectorRunId", "sourceTrackedPlayerId") DO NOTHING
      `;

      const sourceRows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "CollectorRunSourceQuota"
        SET
          "newPlayersEnrolled" = "newPlayersEnrolled" + 1,
          "updatedAt" = now()
        WHERE "collectorRunId" = ${input.sourceCollectorRunId}
          AND "sourceTrackedPlayerId" = ${input.sourceTrackedPlayerId}
          AND "newPlayersEnrolled" < ${input.sourceCap}
        RETURNING id
      `;
      if (sourceRows.length === 0) {
        throw new QuotaRejectedError('source_cap');
      }
    }

    // E) TrackedPlayer INSERT — unique must throw to roll back reservations
    try {
      return await tx.trackedPlayer.create({
        data: {
          playerAccountId: input.playerAccountId,
          provider: input.provider,
          platformRoute: input.platformRoute,
          enrollmentSource: 'MATCH_PARTICIPANT',
          discoveryDepth: input.discoveryDepth,
          status: 'ACTIVE',
          priority: input.priority ?? 0,
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

  return { outcome: 'created', trackedPlayer, attributed };
}

/**
 * Apply depth-min update for an already-tracked player (no quota).
 * Never increases discoveryDepth.
 */
export async function applyDiscoveryDepthMin(
  prisma: PrismaClient,
  input: { playerAccountId: string; proposedDepth: number },
): Promise<TrackedPlayer | null> {
  if (!Number.isInteger(input.proposedDepth) || input.proposedDepth < 0) {
    throw new Error(`Invalid proposedDepth: ${input.proposedDepth}`);
  }

  const rows = await prisma.$queryRaw<TrackedPlayer[]>`
    UPDATE "TrackedPlayer"
    SET
      "discoveryDepth" = LEAST("discoveryDepth", ${input.proposedDepth}),
      "updatedAt" = now()
    WHERE "playerAccountId" = ${input.playerAccountId}
    RETURNING *
  `;
  return rows[0] ?? null;
}
