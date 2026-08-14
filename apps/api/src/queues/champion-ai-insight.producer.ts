import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import {
  CHAMPION_AI_INSIGHT_JOB_NAME,
  ChampionAiInsightJobPayloadSchema,
  buildChampionAiInsightBullMqJobId,
  type ChampionAiInsightJobPayload,
} from '@league-helper/shared';
import { CHAMPION_AI_CONFIG, type ChampionAiConfig } from '../config/champion-ai.config';
import { CHAMPION_AI_INSIGHT_QUEUE } from './queue.tokens';

export type EnqueueChampionAiInsightResult = {
  jobId: string;
  published: boolean;
  alreadyExists: boolean;
};

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

@Injectable()
export class ChampionAiInsightProducer {
  private readonly logger = new Logger(ChampionAiInsightProducer.name);

  constructor(
    @Inject(CHAMPION_AI_INSIGHT_QUEUE)
    private readonly queue: Queue<ChampionAiInsightJobPayload>,
    @Inject(CHAMPION_AI_CONFIG) private readonly config: ChampionAiConfig,
  ) {}

  private jobOptions(jobId: string): JobsOptions {
    return {
      jobId,
      attempts: this.config.jobAttempts,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    };
  }

  /**
   * Publish a GENERATE_CHAMPION_AI_INSIGHT job.
   * Completed/failed BullMQ records with the same deterministic ID are removed and
   * re-queued. Redis errors return published:false so GET can stay 200 UNAVAILABLE.
   */
  async enqueueInsight(
    payload: ChampionAiInsightJobPayload,
  ): Promise<EnqueueChampionAiInsightResult> {
    const parsed = ChampionAiInsightJobPayloadSchema.parse(payload);
    const jobId = buildChampionAiInsightBullMqJobId({
      contextFingerprint: parsed.contextFingerprint,
    });

    if (!this.config.enabled) {
      return { jobId, published: false, alreadyExists: false };
    }

    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (LIVE_STATES.has(state)) {
          return { jobId, published: true, alreadyExists: true };
        }

        await existing.remove();
        this.logger.log({
          message: 'Removed stale BullMQ job before republish',
          correlationId: parsed.correlationId,
          jobId,
          previousState: state,
          insightId: parsed.insightId,
        });
      }

      await this.queue.add(CHAMPION_AI_INSIGHT_JOB_NAME, parsed, this.jobOptions(jobId));
      this.logger.log({
        message: 'Champion AI insight job published',
        correlationId: parsed.correlationId,
        jobId,
        insightId: parsed.insightId,
      });
      return { jobId, published: true, alreadyExists: false };
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Queue publication failed',
        correlationId: parsed.correlationId,
        jobId,
        insightId: parsed.insightId,
        code: 'QUEUE_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { jobId, published: false, alreadyExists: false };
    }
  }
}
