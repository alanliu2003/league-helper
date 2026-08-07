import { Inject, Injectable } from '@nestjs/common';
import {
  CollectorRunStatus,
  type CollectorRun,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type CreateCollectorRunInput = {
  ownerToken: string;
  platformFilter?: string | null;
  effectivePlatforms: string[];
  queueId: number;
  batchLimit: number;
  concurrency: number;
  startedAt?: Date;
};

export type CollectorRunCounters = {
  playersClaimed: number;
  playersAttempted: number;
  playersSucceeded: number;
  playersFailed: number;
  ownershipLost: number;
  matchIdsDiscovered: number;
  matchesEnqueued: number;
  matchesSkippedComplete: number;
  rateLimitStops: number;
  budgetExhausted: boolean;
  failureCode?: string | null;
};

export type FinalizeCollectorRunInput = {
  id: string;
  ownerToken: string;
  status: Exclude<CollectorRunStatus, 'RUNNING'>;
  counters: CollectorRunCounters;
  finishedAt?: Date;
};

@Injectable()
export class CollectorRunRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  createRunning(input: CreateCollectorRunInput): Promise<CollectorRun> {
    return this.prisma.collectorRun.create({
      data: {
        ownerToken: input.ownerToken,
        status: CollectorRunStatus.RUNNING,
        startedAt: input.startedAt ?? new Date(),
        platformFilter: input.platformFilter ?? null,
        effectivePlatforms: input.effectivePlatforms as Prisma.InputJsonValue,
        queueId: input.queueId,
        batchLimit: input.batchLimit,
        concurrency: input.concurrency,
      },
    });
  }

  /**
   * Finalize only when still RUNNING for the owning token.
   * Returns null when already finalized or ownership does not match.
   */
  async finalizeIfRunning(input: FinalizeCollectorRunInput): Promise<CollectorRun | null> {
    const rows = await this.prisma.$queryRawUnsafe<CollectorRun[]>(
      `
      UPDATE "CollectorRun"
      SET
        status = $1::"CollectorRunStatus",
        "finishedAt" = COALESCE($2::timestamptz, now()),
        "playersClaimed" = $3::int,
        "playersAttempted" = $4::int,
        "playersSucceeded" = $5::int,
        "playersFailed" = $6::int,
        "ownershipLost" = $7::int,
        "matchIdsDiscovered" = $8::int,
        "matchesEnqueued" = $9::int,
        "matchesSkippedComplete" = $10::int,
        "rateLimitStops" = $11::int,
        "budgetExhausted" = $12::boolean,
        "failureCode" = $13::text,
        "updatedAt" = now()
      WHERE id = $14::text
        AND "ownerToken" = $15::text
        AND status = 'RUNNING'
      RETURNING *
      `,
      input.status,
      input.finishedAt ?? null,
      input.counters.playersClaimed,
      input.counters.playersAttempted,
      input.counters.playersSucceeded,
      input.counters.playersFailed,
      input.counters.ownershipLost,
      input.counters.matchIdsDiscovered,
      input.counters.matchesEnqueued,
      input.counters.matchesSkippedComplete,
      input.counters.rateLimitStops,
      input.counters.budgetExhausted,
      input.counters.failureCode ?? null,
      input.id,
      input.ownerToken,
    );

    return rows[0] ?? null;
  }

  /**
   * Stale RUNNING runs: startedAt older than staleRunAfterMs (NOT lease duration).
   */
  findStaleRunning(staleRunAfterMs: number): Promise<CollectorRun[]> {
    if (!Number.isFinite(staleRunAfterMs) || staleRunAfterMs < 0 || !Number.isInteger(staleRunAfterMs)) {
      throw new Error(`Invalid staleRunAfterMs: ${staleRunAfterMs}`);
    }

    return this.prisma.$queryRaw<CollectorRun[]>`
      SELECT *
      FROM "CollectorRun"
      WHERE status = 'RUNNING'
        AND "finishedAt" IS NULL
        AND "startedAt" < now() - (${`${staleRunAfterMs} milliseconds`}::text)::interval
      ORDER BY "startedAt" ASC
    `;
  }

  findById(id: string): Promise<CollectorRun | null> {
    return this.prisma.collectorRun.findUnique({ where: { id } });
  }
}
