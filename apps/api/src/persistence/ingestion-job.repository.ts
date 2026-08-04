import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
        status: input.status ?? IngestionJobStatus.QUEUED,
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
      attemptCount?: number;
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
        attemptCount: extras?.attemptCount,
      },
    });
  }
}
