import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  resolveBullMqPrefix,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import type { ParticipantRankEnrichmentWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  processParticipantRankEnrichmentJob,
  type ParticipantRankEnrichmentJobResult,
  type ParticipantRankEnrichmentProcessorDeps,
} from './participant-rank-enrichment.processor.js';

export type CreateParticipantRankEnrichmentWorkerOptions = {
  connection: ConnectionOptions;
  deps: ParticipantRankEnrichmentProcessorDeps;
  config: ParticipantRankEnrichmentWorkerConfig;
};

/**
 * BullMQ Worker for PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME / ENRICH_PARTICIPANT_RANK.
 * Developer-key default concurrency is 1 (loaded via config).
 */
export function createParticipantRankEnrichmentWorker(
  options: CreateParticipantRankEnrichmentWorkerOptions,
): Worker<ParticipantRankEnrichmentJobPayload, ParticipantRankEnrichmentJobResult> {
  const { connection, deps, config } = options;
  const prefix = resolveBullMqPrefix();

  const worker = new Worker<ParticipantRankEnrichmentJobPayload, ParticipantRankEnrichmentJobResult>(
    config.queueName,
    async (job: Job<ParticipantRankEnrichmentJobPayload>, token?: string) => {
      if (job.name !== PARTICIPANT_RANK_ENRICHMENT_JOB_NAME) {
        logger.warn('Rejecting unsupported participant-rank-enrichment job name', {
          jobId: safeJobId(job.id),
          jobName: job.name,
          expectedJobName: PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
        });
        throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
      }

      return processParticipantRankEnrichmentJob(job, token, deps);
    },
    {
      connection,
      concurrency: config.concurrency,
      prefix,
    },
  );

  worker.on('ready', () => {
    logger.info('Worker started', {
      queue: config.queueName,
      supportedJob: PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
      concurrency: config.concurrency,
      observationFreshnessMs: config.observationFreshnessMs,
      bullmqPrefix: prefix,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Participant-rank-enrichment job failed', {
      jobId: safeJobId(job?.id),
      jobName: job?.name,
      code: error.name,
      error: error.message.slice(0, 240),
      attempt: job?.attemptsMade,
    });
  });

  return worker;
}
