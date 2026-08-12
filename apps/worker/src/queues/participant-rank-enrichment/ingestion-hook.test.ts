import { describe, expect, it, vi } from 'vitest';
import { enqueueRankEnrichmentForCompletedMatch } from './ingestion-hook.js';

vi.mock('./enqueue.js', () => ({
  enqueueParticipantRankEnrichmentAfterCommit: vi.fn().mockResolvedValue(2),
}));

import { enqueueParticipantRankEnrichmentAfterCommit } from './enqueue.js';

describe('enqueueRankEnrichmentForCompletedMatch', () => {
  it('enqueues enrichment for PENDING ranked participants only', async () => {
    const prisma = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'm1',
          platformRoute: 'na1',
          queueId: 420,
          participants: [
            { externalAccountId: 'puuid-a', rankResolutionStatus: 'PENDING' },
            { externalAccountId: 'puuid-b', rankResolutionStatus: 'FAILED_RETRYABLE' },
            { externalAccountId: 'puuid-c', rankResolutionStatus: 'RESOLVED_RANKED' },
            { externalAccountId: null, rankResolutionStatus: 'FAILED_PERMANENT' },
          ],
        }),
      },
    };

    const published = await enqueueRankEnrichmentForCompletedMatch({
      prisma: prisma as never,
      matchId: 'm1',
      queue: {} as never,
      config: {
        queueName: 'participant-rank-enrichment',
        concurrency: 1,
        jobAttempts: 5,
        backoffBaseMs: 2000,
        backoffMaxMs: 60_000,
        observationFreshnessMs: 6 * 60 * 60 * 1000,
        riotShared429CooldownMinMs: 900_000,
      },
      correlationId: 'corr-1',
    });

    expect(published).toBe(2);
    expect(enqueueParticipantRankEnrichmentAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'MATCH_INGESTION',
        candidates: [
          expect.objectContaining({
            externalAccountId: 'puuid-a',
            queueType: 'RANKED_SOLO_5x5',
          }),
          expect.objectContaining({
            externalAccountId: 'puuid-b',
            queueType: 'RANKED_SOLO_5x5',
          }),
        ],
      }),
    );
  });

  it('does not enqueue for non-ranked matches', async () => {
    vi.mocked(enqueueParticipantRankEnrichmentAfterCommit).mockClear();
    const prisma = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'm2',
          platformRoute: 'na1',
          queueId: 400,
          participants: [{ externalAccountId: 'puuid-a', rankResolutionStatus: 'PENDING' }],
        }),
      },
    };

    const published = await enqueueRankEnrichmentForCompletedMatch({
      prisma: prisma as never,
      matchId: 'm2',
      queue: {} as never,
      config: {
        queueName: 'participant-rank-enrichment',
        concurrency: 1,
        jobAttempts: 5,
        backoffBaseMs: 2000,
        backoffMaxMs: 60_000,
        observationFreshnessMs: 6 * 60 * 60 * 1000,
        riotShared429CooldownMinMs: 900_000,
      },
    });

    expect(published).toBe(0);
    expect(enqueueParticipantRankEnrichmentAfterCommit).not.toHaveBeenCalled();
  });

  it('is a no-op when enrichment queue is not wired (ingestion does not block)', async () => {
    const prisma = {
      match: { findUnique: vi.fn() },
    };
    const published = await enqueueRankEnrichmentForCompletedMatch({
      prisma: prisma as never,
      matchId: 'm3',
      queue: null,
      config: null,
    });
    expect(published).toBe(0);
    expect(prisma.match.findUnique).not.toHaveBeenCalled();
  });
});
