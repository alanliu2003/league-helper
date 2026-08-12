import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import { processParticipantRankEnrichmentJob } from './participant-rank-enrichment.processor.js';

vi.mock('./participant-rank-enrichment.service.js', () => ({
  enrichParticipantRank: vi.fn(),
}));

import { enrichParticipantRank } from './participant-rank-enrichment.service.js';

function makeJob(
  data: ParticipantRankEnrichmentJobPayload,
): Job<ParticipantRankEnrichmentJobPayload> {
  return {
    id: 'job-1',
    name: PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ParticipantRankEnrichmentJobPayload>;
}

const payload: ParticipantRankEnrichmentJobPayload = {
  platformRoute: 'na1',
  externalAccountId: 'puuid-1',
  queueType: 'RANKED_SOLO_5x5',
  reason: 'MATCH_INGESTION',
};

describe('processParticipantRankEnrichmentJob', () => {
  const deps = {
    prisma: {} as never,
    provider: { getRankedEntries: vi.fn() },
    redis: {} as never,
    config: {
      queueName: 'participant-rank-enrichment',
      concurrency: 1,
      jobAttempts: 5,
      backoffBaseMs: 2000,
      backoffMaxMs: 60_000,
      observationFreshnessMs: 6 * 60 * 60 * 1000,
      riotShared429CooldownMinMs: 900_000,
    },
    championAggregationQueue: {} as never,
    championAggregationConfig: {
      queueName: 'champion-aggregation',
      concurrency: 2,
      jobAttempts: 5,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      confidenceLevel: 0.95,
    },
    sharedCooldown: null,
  };

  it('defers retryable cooldown/429 outcomes via DelayedError', async () => {
    vi.mocked(enrichParticipantRank).mockResolvedValue({
      status: 'retryable',
      resolutionStatus: 'FAILED_RETRYABLE',
      riotCalled: false,
      cacheHit: false,
      observationId: null,
      updatedParticipantCount: 0,
      affectedMatchIds: [],
      providerResultCode: 'SHARED_COOLDOWN_ACTIVE',
      delayMs: 30_000,
      failClosed: false,
    });

    const job = makeJob(payload);
    await expect(processParticipantRankEnrichmentJob(job, 'token', deps)).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalled();
  });

  it('fail-closed auth becomes UnrecoverableError (no retry storm)', async () => {
    vi.mocked(enrichParticipantRank).mockResolvedValue({
      status: 'fail_closed',
      resolutionStatus: 'FAILED_RETRYABLE',
      riotCalled: true,
      cacheHit: false,
      observationId: 'obs-1',
      updatedParticipantCount: 1,
      affectedMatchIds: ['m1'],
      providerResultCode: 'HTTP_403',
      failClosed: true,
    });

    await expect(
      processParticipantRankEnrichmentJob(makeJob(payload), 'token', deps),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('returns completed result for provider resolution', async () => {
    vi.mocked(enrichParticipantRank).mockResolvedValue({
      status: 'resolved_from_provider',
      resolutionStatus: 'RESOLVED_RANKED',
      riotCalled: true,
      cacheHit: false,
      observationId: 'obs-2',
      updatedParticipantCount: 1,
      affectedMatchIds: ['m1'],
      providerResultCode: 'HTTP_200_RANKED',
      failClosed: false,
    });

    const result = await processParticipantRankEnrichmentJob(makeJob(payload), 'token', deps);
    expect(result.status).toBe('resolved_from_provider');
    expect(result.resolutionStatus).toBe('RESOLVED_RANKED');
  });
});
