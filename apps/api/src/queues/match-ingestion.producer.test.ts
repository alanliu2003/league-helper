import { describe, expect, it, vi } from 'vitest';
import { MATCH_INGESTION_JOB_NAME } from '@league-helper/shared';
import { MatchIngestionProducer } from './match-ingestion.producer';

describe('MatchIngestionProducer', () => {
  it('republishes when an existing BullMQ job is completed', async () => {
    const remove = vi.fn(async () => undefined);
    const add = vi.fn(async () => ({ id: 'ingest_test' }));
    const getJob = vi.fn(async () => ({
      getState: async () => 'completed' as const,
      remove,
    }));
    const queue = { getJob, add, name: 'match-ingestion' };
    const producer = new MatchIngestionProducer(
      queue as never,
      {
        matchIngestionJobAttempts: 5,
      } as never,
    );

    const result = await producer.enqueueMatch({
      provider: 'RIOT',
      externalMatchId: 'NA1_123',
      regionalRoute: 'americas',
      requestedByPlayerAccountId: '11111111-1111-1111-1111-111111111111',
      correlationId: 'corr-1',
      normalizationVersion: 1,
      discoveredAt: new Date().toISOString(),
    });

    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      MATCH_INGESTION_JOB_NAME,
      expect.objectContaining({ externalMatchId: 'NA1_123' }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(result.published).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('does not duplicate live waiting jobs', async () => {
    const remove = vi.fn();
    const add = vi.fn();
    const getJob = vi.fn(async () => ({
      getState: async () => 'waiting' as const,
      remove,
    }));
    const producer = new MatchIngestionProducer(
      { getJob, add, name: 'match-ingestion' } as never,
      { matchIngestionJobAttempts: 5 } as never,
    );

    const result = await producer.enqueueMatch({
      provider: 'RIOT',
      externalMatchId: 'NA1_123',
      regionalRoute: 'americas',
      requestedByPlayerAccountId: '11111111-1111-1111-1111-111111111111',
      correlationId: 'corr-1',
      normalizationVersion: 1,
      discoveredAt: new Date().toISOString(),
    });

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(result.alreadyExists).toBe(true);
    expect(result.published).toBe(true);
  });
});
