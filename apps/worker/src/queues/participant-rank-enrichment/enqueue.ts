import { Queue, type JobsOptions } from 'bullmq';
import {
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  ParticipantRankEnrichmentJobPayloadSchema,
  buildParticipantRankEnrichmentBullMqJobId,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import type { ParticipantRankEnrichmentWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';

export const PARTICIPANT_RANK_ENRICHMENT_REMOVE_ON_COMPLETE = {
  age: 3600,
  count: 1000,
} as const;
export const PARTICIPANT_RANK_ENRICHMENT_REMOVE_ON_FAIL = {
  age: 86400,
  count: 5000,
} as const;

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export type EnqueueParticipantRankEnrichmentInput = {
  queue: Queue<ParticipantRankEnrichmentJobPayload>;
  config: ParticipantRankEnrichmentWorkerConfig;
  payload: ParticipantRankEnrichmentJobPayload;
};

export type EnqueueParticipantRankEnrichmentResult = {
  published: boolean;
  jobId: string;
  alreadyLive: boolean;
};

export function buildParticipantRankEnrichmentJobOptions(
  jobId: string,
  config: ParticipantRankEnrichmentWorkerConfig,
): JobsOptions {
  return {
    jobId,
    attempts: config.jobAttempts,
    backoff: {
      type: 'exponential',
      delay: config.backoffBaseMs,
    },
    removeOnComplete: { ...PARTICIPANT_RANK_ENRICHMENT_REMOVE_ON_COMPLETE },
    removeOnFail: { ...PARTICIPANT_RANK_ENRICHMENT_REMOVE_ON_FAIL },
  };
}

/**
 * Enqueue ENRICH_PARTICIPANT_RANK with PUUID-level singleflight dedupe.
 * Live jobs for the same (platform, puuid, queueType) are not duplicated.
 */
export async function enqueueParticipantRankEnrichment(
  input: EnqueueParticipantRankEnrichmentInput,
): Promise<EnqueueParticipantRankEnrichmentResult> {
  const payload = ParticipantRankEnrichmentJobPayloadSchema.parse(input.payload);
  const jobId = buildParticipantRankEnrichmentBullMqJobId({
    platformRoute: payload.platformRoute,
    externalAccountId: payload.externalAccountId,
    queueType: payload.queueType,
  });

  const existing = await input.queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (LIVE_STATES.has(state)) {
      return { published: true, jobId, alreadyLive: true };
    }
    await existing.remove();
  }

  await input.queue.add(
    PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
    payload,
    buildParticipantRankEnrichmentJobOptions(jobId, input.config),
  );

  return { published: true, jobId, alreadyLive: false };
}

export type RankEnrichmentCandidate = {
  platformRoute: string;
  externalAccountId: string;
  queueType: ParticipantRankEnrichmentJobPayload['queueType'];
  matchId?: string;
};

/**
 * Best-effort post-commit enqueue for ranked-match participants needing resolution.
 * Never throws to the ingestion caller.
 */
export async function enqueueParticipantRankEnrichmentAfterCommit(input: {
  queue: Queue<ParticipantRankEnrichmentJobPayload> | null | undefined;
  config: ParticipantRankEnrichmentWorkerConfig | null | undefined;
  candidates: RankEnrichmentCandidate[];
  reason?: ParticipantRankEnrichmentJobPayload['reason'];
  correlationId?: string;
}): Promise<number> {
  if (!input.queue || !input.config || input.candidates.length === 0) {
    return 0;
  }

  const reason = input.reason ?? 'MATCH_INGESTION';
  const seen = new Set<string>();
  let published = 0;

  for (const candidate of input.candidates) {
    const puuid = candidate.externalAccountId.trim();
    if (puuid.length === 0) {
      continue;
    }
    const dedupeKey = `${candidate.platformRoute}\0${puuid}\0${candidate.queueType}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    try {
      const result = await enqueueParticipantRankEnrichment({
        queue: input.queue,
        config: input.config,
        payload: {
          platformRoute: candidate.platformRoute as ParticipantRankEnrichmentJobPayload['platformRoute'],
          externalAccountId: puuid,
          queueType: candidate.queueType,
          reason,
          ...(candidate.matchId ? { matchId: candidate.matchId } : {}),
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        },
      });
      if (result.published) {
        published += 1;
      }
    } catch (error: unknown) {
      logger.warn('participant_rank_enrichment_enqueue_failed', {
        platformRoute: candidate.platformRoute,
        queueType: candidate.queueType,
        matchId: candidate.matchId,
        correlationId: input.correlationId,
        code: 'PARTICIPANT_RANK_ENRICHMENT_ENQUEUE_FAILED',
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }

  if (published > 0) {
    logger.info('participant_rank_enrichment_enqueued', {
      published,
      candidateCount: input.candidates.length,
      uniqueIdentities: seen.size,
      correlationId: input.correlationId,
      reason,
    });
  }

  return published;
}
