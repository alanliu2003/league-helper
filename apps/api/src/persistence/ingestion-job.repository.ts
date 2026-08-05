import { Inject, Injectable } from '@nestjs/common';
import { IngestionJobStatus, type IngestionJobRecord, type Prisma } from '@prisma/client';
import { ProviderIdSchema } from '@league-helper/shared';
import { PrismaService } from '../prisma/prisma.service';

export type UpsertIngestionJobInput = {
  jobType: string;
  idempotencyKey: string;
  provider: string;
  externalResourceId?: string | null;
  status?: IngestionJobStatus;
  priority?: number;
  maxAttempts?: number;
  metadata?: Prisma.InputJsonValue | null;
  scheduledAt?: Date | null;
};

@Injectable()
export class IngestionJobRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByIdempotency(jobType: string, idempotencyKey: string): Promise<IngestionJobRecord | null> {
    return this.prisma.ingestionJobRecord.findUnique({
      where: {
        jobType_idempotencyKey: { jobType, idempotencyKey },
      },
    });
  }

  /** Creates a durable job row or returns the existing one for the same idempotency key. */
  async createIdempotent(
    input: UpsertIngestionJobInput,
  ): Promise<{ job: IngestionJobRecord; created: boolean }> {
    const provider = ProviderIdSchema.parse(input.provider);
    const existing = await this.findByIdempotency(input.jobType, input.idempotencyKey);
    if (existing) {
      return { job: existing, created: false };
    }

    const job = await this.prisma.ingestionJobRecord.create({
      data: {
        jobType: input.jobType,
        idempotencyKey: input.idempotencyKey,
        provider,
        externalResourceId: input.externalResourceId ?? null,
        status: input.status ?? IngestionJobStatus.PENDING,
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 5,
        metadata: input.metadata ?? undefined,
        scheduledAt: input.scheduledAt ?? null,
      },
    });

    return { job, created: true };
  }

  updateStatus(
    id: string,
    status: IngestionJobStatus,
    extras?: {
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
      deadLetteredAt?: Date | null;
      scheduledAt?: Date | null;
      attemptCount?: number;
      metadata?: Prisma.InputJsonValue | null;
    },
  ): Promise<IngestionJobRecord> {
    return this.prisma.ingestionJobRecord.update({
      where: { id },
      data: {
        status,
        lastErrorCode: extras?.lastErrorCode,
        lastErrorMessage: extras?.lastErrorMessage,
        startedAt: extras?.startedAt,
        completedAt: extras?.completedAt,
        deadLetteredAt: extras?.deadLetteredAt,
        scheduledAt: extras?.scheduledAt,
        attemptCount: extras?.attemptCount,
        ...(extras?.metadata !== undefined ? { metadata: extras.metadata ?? undefined } : {}),
      },
    });
  }

  findPending(jobType: string, batchSize: number): Promise<IngestionJobRecord[]> {
    return this.prisma.ingestionJobRecord.findMany({
      where: { jobType, status: IngestionJobStatus.PENDING },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: batchSize,
    });
  }

  findQueued(jobType: string, batchSize: number): Promise<IngestionJobRecord[]> {
    return this.prisma.ingestionJobRecord.findMany({
      where: { jobType, status: IngestionJobStatus.QUEUED },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: batchSize,
    });
  }

  findByExternalResourceIds(
    jobType: string,
    provider: string,
    externalResourceIds: string[],
  ): Promise<IngestionJobRecord[]> {
    if (externalResourceIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.ingestionJobRecord.findMany({
      where: {
        jobType,
        provider: ProviderIdSchema.parse(provider),
        externalResourceId: { in: externalResourceIds },
      },
    });
  }

  async countByStatuses(
    jobType: string,
    provider: string,
    externalResourceIds: string[],
  ): Promise<Array<{ status: IngestionJobStatus; count: number }>> {
    if (externalResourceIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.ingestionJobRecord.findMany({
      where: {
        jobType,
        provider: ProviderIdSchema.parse(provider),
        externalResourceId: { in: externalResourceIds },
      },
      select: { status: true },
    });

    const counts = new Map<IngestionJobStatus, number>();
    for (const row of rows) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }

    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  }

  findRetryEligible(
    jobType: string,
    provider: string,
    externalResourceIds: string[],
  ): Promise<IngestionJobRecord[]> {
    if (externalResourceIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.ingestionJobRecord.findMany({
      where: {
        jobType,
        provider: ProviderIdSchema.parse(provider),
        externalResourceId: { in: externalResourceIds },
        status: { in: [IngestionJobStatus.PENDING, IngestionJobStatus.FAILED] },
      },
    });
  }
}
