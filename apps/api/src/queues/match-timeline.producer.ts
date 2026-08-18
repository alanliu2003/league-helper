import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import {
  MATCH_TIMELINE_JOB_NAME,
  MatchTimelineJobPayloadSchema,
  buildMatchTimelineBullMqJobId,
  type MatchTimelineJobPayload,
} from '@league-helper/shared';
import { PLAYER_REFRESH_CONFIG, type PlayerRefreshConfig } from '../config/player-refresh.config';
import { MATCH_TIMELINE_QUEUE } from './queue.tokens';

export type EnqueueMatchTimelineResult = {
  jobId: string;
  published: boolean;
  alreadyExists: boolean;
};

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

function toPublishedPayload(parsed: MatchTimelineJobPayload): MatchTimelineJobPayload {
  return {
    matchId: parsed.matchId,
    ...(parsed.correlationId !== undefined ? { correlationId: parsed.correlationId } : {}),
  };
}

@Injectable()
export class MatchTimelineProducer {
  private readonly logger = new Logger(MatchTimelineProducer.name);

  constructor(
    @Inject(MATCH_TIMELINE_QUEUE) private readonly queue: Queue<MatchTimelineJobPayload>,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
  ) {}

  private jobOptions(jobId: string): JobsOptions {
    return {
      jobId,
      attempts: this.config.matchTimelineJobAttempts,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    };
  }

  /**
   * Publish an ENRICH_MATCH_TIMELINE job.
   * Completed/failed BullMQ records with the same deterministic ID are removed and
   * re-queued. Redis errors return published:false so search can stay 200.
   * The API producer always attempts Redis; search backfill is gated by callers.
   * `includeIneligible` is never published from this producer.
   */
  async enqueueEnrichment(payload: MatchTimelineJobPayload): Promise<EnqueueMatchTimelineResult> {
    const parsed = MatchTimelineJobPayloadSchema.parse(payload);
    const jobId = buildMatchTimelineBullMqJobId({ matchId: parsed.matchId });
    const jobPayload = toPublishedPayload(parsed);

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
          matchId: parsed.matchId,
        });
      }

      await this.queue.add(MATCH_TIMELINE_JOB_NAME, jobPayload, this.jobOptions(jobId));
      this.logger.log({
        message: 'Match timeline enrichment job published',
        correlationId: parsed.correlationId,
        jobId,
        matchId: parsed.matchId,
      });
      return { jobId, published: true, alreadyExists: false };
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Queue publication failed',
        correlationId: parsed.correlationId,
        jobId,
        matchId: parsed.matchId,
        code: 'QUEUE_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { jobId, published: false, alreadyExists: false };
    }
  }
}
