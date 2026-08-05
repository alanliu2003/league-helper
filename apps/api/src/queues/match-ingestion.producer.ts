import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import {
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_NORMALIZATION_VERSION,
  MatchIngestionJobPayloadSchema,
  buildMatchIngestionBullMqJobId,
  type MatchIngestionJobPayload,
  type PlayerSafeWarning,
} from '@league-helper/shared';
import { PLAYER_REFRESH_CONFIG, type PlayerRefreshConfig } from '../config/player-refresh.config';
import { MATCH_INGESTION_QUEUE } from './queue.tokens';

export type EnqueueMatchResult = {
  externalMatchId: string;
  jobId: string;
  published: boolean;
  alreadyExists: boolean;
  warning?: PlayerSafeWarning;
};

@Injectable()
export class MatchIngestionProducer {
  private readonly logger = new Logger(MatchIngestionProducer.name);

  constructor(
    @Inject(MATCH_INGESTION_QUEUE) private readonly queue: Queue<MatchIngestionJobPayload>,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
  ) {}

  private jobOptions(jobId: string, priority = 0): JobsOptions {
    return {
      jobId,
      priority,
      attempts: this.config.matchIngestionJobAttempts,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      // Keep waiting jobs indefinitely until Milestone 6 implements a processor.
      removeOnComplete: 1000,
      removeOnFail: 1000,
    };
  }

  async enqueueMatch(payload: MatchIngestionJobPayload, priority = 0): Promise<EnqueueMatchResult> {
    const parsed = MatchIngestionJobPayloadSchema.parse({
      ...payload,
      normalizationVersion: payload.normalizationVersion ?? MATCH_INGESTION_NORMALIZATION_VERSION,
    });
    const jobId = buildMatchIngestionBullMqJobId({
      provider: parsed.provider,
      regionalRoute: parsed.regionalRoute,
      externalMatchId: parsed.externalMatchId,
      normalizationVersion: parsed.normalizationVersion,
    });

    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        return {
          externalMatchId: parsed.externalMatchId,
          jobId,
          published: true,
          alreadyExists: true,
        };
      }

      await this.queue.add(MATCH_INGESTION_JOB_NAME, parsed, this.jobOptions(jobId, priority));
      this.logger.log({
        message: 'Queue jobs published',
        correlationId: parsed.correlationId,
        jobId,
        externalMatchId: parsed.externalMatchId,
        regionalRoute: parsed.regionalRoute,
      });
      return {
        externalMatchId: parsed.externalMatchId,
        jobId,
        published: true,
        alreadyExists: false,
      };
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Queue publication failed',
        correlationId: parsed.correlationId,
        jobId,
        externalMatchId: parsed.externalMatchId,
        code: 'QUEUE_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return {
        externalMatchId: parsed.externalMatchId,
        jobId,
        published: false,
        alreadyExists: false,
        warning: {
          code: 'QUEUE_UNAVAILABLE',
          message:
            'Match discovery was saved, but queue publication failed. Reconciliation can retry.',
        },
      };
    }
  }

  async enqueueMatches(
    payloads: MatchIngestionJobPayload[],
    priority = 0,
  ): Promise<EnqueueMatchResult[]> {
    const results: EnqueueMatchResult[] = [];
    for (const payload of payloads) {
      results.push(await this.enqueueMatch(payload, priority));
    }
    return results;
  }

  async getJobState(jobId: string): Promise<string | null> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        return null;
      }
      return job.getState();
    } catch {
      return null;
    }
  }

  async getJobStates(jobIds: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    await Promise.all(
      jobIds.map(async (jobId) => {
        map.set(jobId, await this.getJobState(jobId));
      }),
    );
    return map;
  }

  async getQueueCounts(): Promise<{
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  }> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    };
  }
}
