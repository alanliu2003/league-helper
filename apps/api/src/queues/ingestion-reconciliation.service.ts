import { Inject, Injectable, Logger } from '@nestjs/common';
import { IngestionJobStatus } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  MatchIngestionJobPayloadSchema,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import { PLAYER_REFRESH_CONFIG, type PlayerRefreshConfig } from '../config/player-refresh.config';
import { IngestionJobRepository } from '../persistence/ingestion-job.repository';
import { MatchIngestionProducer } from './match-ingestion.producer';

export type ReconciliationSummary = {
  scanned: number;
  published: number;
  alreadyQueued: number;
  invalidMetadata: number;
  publicationFailed: number;
};

@Injectable()
export class IngestionReconciliationService {
  private readonly logger = new Logger(IngestionReconciliationService.name);

  constructor(
    @Inject(IngestionJobRepository) private readonly jobs: IngestionJobRepository,
    @Inject(MatchIngestionProducer) private readonly producer: MatchIngestionProducer,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
  ) {}

  async reconcilePending(batchSize?: number): Promise<ReconciliationSummary> {
    const limit = batchSize ?? this.config.matchIngestionReconcileBatchSize;
    const pending = await this.jobs.findPending(MATCH_INGESTION_JOB_NAME, limit);

    const summary: ReconciliationSummary = {
      scanned: pending.length,
      published: 0,
      alreadyQueued: 0,
      invalidMetadata: 0,
      publicationFailed: 0,
    };

    for (const record of pending) {
      const parsed = MatchIngestionJobPayloadSchema.safeParse(record.metadata);
      if (!parsed.success) {
        summary.invalidMetadata += 1;
        this.logger.warn({
          message: 'Reconciliation skipped invalid metadata',
          durableJobId: record.id,
          code: 'INVALID_METADATA',
        });
        continue;
      }

      const payload: MatchIngestionJobPayload = parsed.data;
      const result = await this.producer.enqueueMatch(payload, record.priority);

      if (!result.published) {
        summary.publicationFailed += 1;
        continue;
      }

      if (result.alreadyExists) {
        summary.alreadyQueued += 1;
      } else {
        summary.published += 1;
      }

      await this.jobs.updateStatus(record.id, IngestionJobStatus.QUEUED, {
        scheduledAt: new Date(),
      });
    }

    this.logger.log({
      message: 'Reconciliation batch complete',
      ...summary,
    });

    return summary;
  }
}
