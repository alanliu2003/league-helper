import { Inject, Injectable } from '@nestjs/common';
import type { CollectorSchedulerOutcome, CollectorSchedulerState } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SINGLETON_ID = 'singleton';

function msIntervalLiteral(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0 || !Number.isInteger(ms)) {
    throw new Error(`Invalid interval milliseconds: ${ms}`);
  }
  return `${ms} milliseconds`;
}

@Injectable()
export class CollectorSchedulerStateRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Idempotent upsert of the singleton scheduler state row.
   * Migration seeds it; tests/ops may still need ensure.
   */
  async ensureSingleton(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "CollectorSchedulerState" (id, "createdAt", "updatedAt")
      VALUES ($1::text, now(), now())
      ON CONFLICT (id) DO NOTHING
      `,
      SINGLETON_ID,
    );
  }

  readState(): Promise<CollectorSchedulerState | null> {
    return this.prisma.collectorSchedulerState.findUnique({
      where: { id: SINGLETON_ID },
    });
  }

  /**
   * Atomic guarded acquire: one UPDATE, no SELECT-then-UPDATE.
   * Succeeds when lease is free or expired.
   */
  async tryAcquireLease(owner: string, leaseMs: number): Promise<boolean> {
    const leaseInterval = msIntervalLiteral(leaseMs);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CollectorSchedulerState"
      SET
        "leaseOwner" = $1::text,
        "leaseExpiresAt" = now() + ($2::text)::interval,
        "updatedAt" = now()
      WHERE id = $3::text
        AND (
          "leaseOwner" IS NULL
          OR "leaseExpiresAt" IS NULL
          OR "leaseExpiresAt" < now()
        )
      RETURNING id
      `,
      owner,
      leaseInterval,
      SINGLETON_ID,
    );
    return rows.length === 1;
  }

  async renewLease(owner: string, leaseMs: number): Promise<boolean> {
    const leaseInterval = msIntervalLiteral(leaseMs);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CollectorSchedulerState"
      SET
        "leaseExpiresAt" = now() + ($1::text)::interval,
        "updatedAt" = now()
      WHERE id = $2::text
        AND "leaseOwner" = $3::text
      RETURNING id
      `,
      leaseInterval,
      SINGLETON_ID,
      owner,
    );
    return rows.length === 1;
  }

  async recordTrigger(owner: string, collectorRunId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CollectorSchedulerState"
      SET
        "lastTriggerAt" = now(),
        "lastCollectorRunId" = $1::text,
        "updatedAt" = now()
      WHERE id = $2::text
        AND "leaseOwner" = $3::text
      RETURNING id
      `,
      collectorRunId,
      SINGLETON_ID,
      owner,
    );
    return rows.length === 1;
  }

  async recordOutcome(
    owner: string,
    outcome: CollectorSchedulerOutcome,
    errorCode?: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CollectorSchedulerState"
      SET
        "lastOutcome" = $1::"CollectorSchedulerOutcome",
        "lastErrorCode" = $2::text,
        "updatedAt" = now()
      WHERE id = $3::text
        AND "leaseOwner" = $4::text
      RETURNING id
      `,
      outcome,
      errorCode ?? null,
      SINGLETON_ID,
      owner,
    );
    return rows.length === 1;
  }

  async setCooldown(owner: string, cooldownUntil: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CollectorSchedulerState"
      SET
        "cooldownUntil" = $1::timestamptz,
        "updatedAt" = now()
      WHERE id = $2::text
        AND "leaseOwner" = $3::text
      RETURNING id
      `,
      cooldownUntil,
      SINGLETON_ID,
      owner,
    );
    return rows.length === 1;
  }

  /**
   * Clears leaseOwner / leaseExpiresAt only. Preserves trigger/outcome/cooldown history.
   */
  async releaseLease(owner: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CollectorSchedulerState"
      SET
        "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = now()
      WHERE id = $1::text
        AND "leaseOwner" = $2::text
      RETURNING id
      `,
      SINGLETON_ID,
      owner,
    );
    return rows.length === 1;
  }
}
