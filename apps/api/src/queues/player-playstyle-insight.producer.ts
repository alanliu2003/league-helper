import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import {
  PLAYER_AI_PLAYSTYLE_JOB_NAME,
  PlayerPlaystyleInsightJobPayloadSchema,
  buildPlayerPlaystyleInsightBullMqJobId,
  type PlayerPlaystyleInsightJobPayload,
} from '@league-helper/shared';
import {
  PLAYER_PLAYSTYLE_AI_CONFIG,
  type PlayerPlaystyleAiConfig,
} from '../config/player-playstyle-ai.config';
import { PLAYER_AI_PLAYSTYLE_QUEUE } from './queue.tokens';

export type EnqueuePlayerPlaystyleInsightResult = {
  jobId: string;
  published: boolean;
  alreadyExists: boolean;
};

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

@Injectable()
export class PlayerPlaystyleInsightProducer {
  private readonly logger = new Logger(PlayerPlaystyleInsightProducer.name);

  constructor(
    @Inject(PLAYER_AI_PLAYSTYLE_QUEUE)
    private readonly queue: Queue<PlayerPlaystyleInsightJobPayload>,
    @Inject(PLAYER_PLAYSTYLE_AI_CONFIG) private readonly config: PlayerPlaystyleAiConfig,
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
   * Publish a GENERATE_PLAYER_PLAYSTYLE_INSIGHT job.
   * Completed/failed BullMQ records with the same deterministic ID are removed and
   * re-queued. Redis errors return published:false so GET can stay 200 UNAVAILABLE.
   */
  async enqueueInsight(
    payload: PlayerPlaystyleInsightJobPayload,
  ): Promise<EnqueuePlayerPlaystyleInsightResult> {
    const parsed = PlayerPlaystyleInsightJobPayloadSchema.parse(payload);
    const jobId = buildPlayerPlaystyleInsightBullMqJobId({
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

      await this.queue.add(PLAYER_AI_PLAYSTYLE_JOB_NAME, parsed, this.jobOptions(jobId));
      this.logger.log({
        message: 'Player playstyle insight job published',
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
