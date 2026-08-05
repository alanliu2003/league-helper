import { Inject, Injectable, Logger } from '@nestjs/common';
import { IngestionJobStatus, MatchIngestionStatus } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  MatchIngestionJobPayloadSchema,
  buildMatchIngestionBullMqJobId,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import { PLAYER_REFRESH_CONFIG, type PlayerRefreshConfig } from '../config/player-refresh.config';
import { IngestionJobRepository } from '../persistence/ingestion-job.repository';
import { MatchRepository } from '../persistence/match.repository';
import { MatchIngestionProducer } from './match-ingestion.producer';

export type ReconciliationSummary = {
  examined: number;
  alreadyPresent: number;
  published: number;
  repairedQueuedWithoutRedisJob: number;
  invalid: number;
  failed: number;
  /** @deprecated Use examined */
  scanned: number;
  /** @deprecated Use alreadyPresent */
  alreadyQueued: number;
  /** @deprecated Use invalid */
  invalidMetadata: number;
  /** @deprecated Use failed */
  publicationFailed: number;
};

@Injectable()
export class IngestionReconciliationService {
  private readonly logger = new Logger(IngestionReconciliationService.name);

  constructor(
    @Inject(IngestionJobRepository) private readonly jobs: IngestionJobRepository,
    @Inject(MatchIngestionProducer) private readonly producer: MatchIngestionProducer,
    @Inject(MatchRepository) private readonly matches: MatchRepository,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
  ) {}

  async reconcilePending(batchSize?: number): Promise<ReconciliationSummary> {
    const limit = batchSize ?? this.config.matchIngestionReconcileBatchSize;
    const pending = await this.jobs.findPending(MATCH_INGESTION_JOB_NAME, limit);
    const queuedOrphanCandidates = await this.jobs.findQueued(MATCH_INGESTION_JOB_NAME, limit);

    const summary: ReconciliationSummary = {
      examined: 0,
      alreadyPresent: 0,
      published: 0,
      repairedQueuedWithoutRedisJob: 0,
      invalid: 0,
      failed: 0,
      scanned: 0,
      alreadyQueued: 0,
      invalidMetadata: 0,
      publicationFailed: 0,
    };

    const seen = new Set<string>();
    const records = [...pending, ...queuedOrphanCandidates].filter((record) => {
      if (seen.has(record.id)) {
        return false;
      }
      seen.add(record.id);
      return true;
    });

    summary.examined = records.length;
    summary.scanned = records.length;

    for (const record of records) {
      const parsed = MatchIngestionJobPayloadSchema.safeParse(record.metadata);
      if (!parsed.success) {
        summary.invalid += 1;
        summary.invalidMetadata += 1;
        this.logger.warn({
          message: 'Reconciliation skipped invalid metadata',
          durableJobId: record.id,
          code: 'INVALID_METADATA',
        });
        continue;
      }

      const payload: MatchIngestionJobPayload = parsed.data;

      const existingMatch = await this.matches.findByProviderExternalId(
        payload.provider,
        payload.externalMatchId,
      );
      if (
        existingMatch &&
        existingMatch.ingestionStatus === MatchIngestionStatus.COMPLETED &&
        Number(existingMatch.normalizationVersion) >= payload.normalizationVersion
      ) {
        await this.jobs.updateStatus(record.id, IngestionJobStatus.COMPLETED, {
          completedAt: new Date(),
        });
        summary.alreadyPresent += 1;
        summary.alreadyQueued += 1;
        continue;
      }

      const bullJobId = buildMatchIngestionBullMqJobId({
        provider: payload.provider,
        regionalRoute: payload.regionalRoute,
        externalMatchId: payload.externalMatchId,
        normalizationVersion: payload.normalizationVersion,
      });
      const bullState = await this.producer.getJobState(bullJobId);
      const needsRepair =
        bullState === null ||
        bullState === undefined ||
        bullState === 'completed' ||
        bullState === 'failed';
      const wasQueuedWithoutLiveJob = record.status === IngestionJobStatus.QUEUED && needsRepair;

      if (bullState === 'waiting' || bullState === 'active' || bullState === 'delayed') {
        if (record.status === IngestionJobStatus.PENDING) {
          await this.jobs.updateStatus(record.id, IngestionJobStatus.QUEUED, {
            scheduledAt: new Date(),
          });
        }
        summary.alreadyPresent += 1;
        summary.alreadyQueued += 1;
        continue;
      }

      const result = await this.producer.enqueueMatch(payload, record.priority);

      if (!result.published) {
        summary.failed += 1;
        summary.publicationFailed += 1;
        continue;
      }

      await this.jobs.updateStatus(record.id, IngestionJobStatus.QUEUED, {
        scheduledAt: new Date(),
      });

      if (wasQueuedWithoutLiveJob) {
        summary.repairedQueuedWithoutRedisJob += 1;
      } else if (result.alreadyExists) {
        summary.alreadyPresent += 1;
        summary.alreadyQueued += 1;
      } else {
        summary.published += 1;
      }
    }

    this.logger.log({
      message: 'Reconciliation batch complete',
      examined: summary.examined,
      alreadyPresent: summary.alreadyPresent,
      published: summary.published,
      repairedQueuedWithoutRedisJob: summary.repairedQueuedWithoutRedisJob,
      invalid: summary.invalid,
      failed: summary.failed,
    });

    return summary;
  }
}
