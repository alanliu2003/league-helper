import type { Prisma, PrismaClient } from '@prisma/client';

export type TrackedPlayerBudgetUsage = {
  trackedPlayerCount: number;
  ladderEnrolledCount: number;
};

export type ReserveTotalTrackedOutcome =
  | { outcome: 'reserved' }
  | { outcome: 'skipped_total_cap' };

export type ReserveLadderTrackedOutcome =
  | { outcome: 'reserved' }
  | { outcome: 'skipped_total_cap' }
  | { outcome: 'skipped_ladder_cap' };

/**
 * Thrown inside a TX on unique(playerAccountId) so prior budget reservations roll back.
 * Callers catch this after the transaction aborts and treat the player as already tracked.
 */
export class AlreadyTrackedRollbackError extends Error {
  constructor() {
    super('TrackedPlayer unique conflict — rolling back TrackedPlayer budget reservations');
    this.name = 'AlreadyTrackedRollbackError';
  }
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Race-safe reservation helpers for CollectorTrackedPlayerBudget.
 *
 * Lock/reservation order for future enrollment transactions (deadlock-safe):
 * 1. CollectorTrackedPlayerBudget
 *    - total-only creates: increment trackedPlayerCount vs totalCap
 *    - LADDER creates: prefer a single UPDATE with both totalCap + ladderCap predicates
 * 2. (participant path only) CollectorPopulationBudget …
 * 3. TrackedPlayer INSERT — unique conflict MUST throw AlreadyTrackedRollbackError
 *    (or otherwise abort the TX) so reservations roll back
 *
 * Per-run create ceiling (CollectorConfig.ladderMaxNewPerRun) is NOT a DB counter.
 * It is enforced in-memory by the ladder seed service later.
 *
 * LADDER does not consume CollectorPopulationBudget (MATCH_PARTICIPANT-only).
 */

export async function getTrackedPlayerBudgetUsage(
  prisma: DbClient,
): Promise<TrackedPlayerBudgetUsage> {
  const row = await prisma.collectorTrackedPlayerBudget.findUnique({
    where: { id: 'singleton' },
    select: { trackedPlayerCount: true, ladderEnrolledCount: true },
  });
  if (!row) {
    throw new Error('CollectorTrackedPlayerBudget singleton row is missing.');
  }
  return row;
}

/**
 * Ensure singleton exists, bootstrapping counters from live TrackedPlayer rows when inserting.
 * Idempotent: never overwrites an existing singleton (matches migration ON CONFLICT DO NOTHING).
 */
export async function ensureTrackedPlayerBudgetSingleton(
  prisma: DbClient,
): Promise<TrackedPlayerBudgetUsage> {
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
  return getTrackedPlayerBudgetUsage(prisma);
}

/**
 * Recompute singleton counters from live TrackedPlayer rows (ops/reconcile helper).
 * Does not delete TrackedPlayer rows or rewrite enrollmentSource.
 */
export async function reconcileTrackedPlayerBudgetFromRows(
  prisma: DbClient,
): Promise<TrackedPlayerBudgetUsage> {
  await ensureTrackedPlayerBudgetSingleton(prisma);
  const rows = await prisma.$queryRaw<
    Array<{ trackedPlayerCount: number; ladderEnrolledCount: number }>
  >`
    UPDATE "CollectorTrackedPlayerBudget"
    SET
      "trackedPlayerCount" = (SELECT COUNT(*)::int FROM "TrackedPlayer"),
      "ladderEnrolledCount" = (
        SELECT COUNT(*)::int FROM "TrackedPlayer" WHERE "enrollmentSource" = 'LADDER'
      ),
      "updatedAt" = now()
    WHERE id = 'singleton'
    RETURNING "trackedPlayerCount", "ladderEnrolledCount"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to reconcile CollectorTrackedPlayerBudget singleton.');
  }
  return row;
}

/**
 * Reserve one slot against the global TrackedPlayer ceiling (any enrollmentSource).
 * Call inside the enrollment TX before INSERT.
 */
export async function reserveTotalTrackedCreate(
  tx: Prisma.TransactionClient,
  input: { totalCap: number },
): Promise<ReserveTotalTrackedOutcome> {
  assertNonNegativeCap(input.totalCap, 'totalCap');

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "CollectorTrackedPlayerBudget"
    SET
      "trackedPlayerCount" = "trackedPlayerCount" + 1,
      "updatedAt" = now()
    WHERE id = 'singleton'
      AND "trackedPlayerCount" < ${input.totalCap}
    RETURNING id
  `;

  if (rows.length === 0) {
    return { outcome: 'skipped_total_cap' };
  }
  return { outcome: 'reserved' };
}

/**
 * Reserve one LADDER create: atomically increment BOTH trackedPlayerCount and ladderEnrolledCount
 * when under both caps. Call inside the enrollment TX before INSERT.
 */
export async function reserveLadderTrackedCreate(
  tx: Prisma.TransactionClient,
  input: { totalCap: number; ladderCap: number },
): Promise<ReserveLadderTrackedOutcome> {
  assertNonNegativeCap(input.totalCap, 'totalCap');
  assertNonNegativeCap(input.ladderCap, 'ladderCap');

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "CollectorTrackedPlayerBudget"
    SET
      "trackedPlayerCount" = "trackedPlayerCount" + 1,
      "ladderEnrolledCount" = "ladderEnrolledCount" + 1,
      "updatedAt" = now()
    WHERE id = 'singleton'
      AND "trackedPlayerCount" < ${input.totalCap}
      AND "ladderEnrolledCount" < ${input.ladderCap}
    RETURNING id
  `;

  if (rows.length > 0) {
    return { outcome: 'reserved' };
  }

  const usage = await getTrackedPlayerBudgetUsage(tx);
  if (usage.trackedPlayerCount >= input.totalCap) {
    return { outcome: 'skipped_total_cap' };
  }
  if (usage.ladderEnrolledCount >= input.ladderCap) {
    return { outcome: 'skipped_ladder_cap' };
  }
  // Lost a race between UPDATE and read; treat as total-cap miss (safe fail-closed).
  return { outcome: 'skipped_total_cap' };
}

function assertNonNegativeCap(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
