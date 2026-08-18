import { describe, expect, it, vi } from 'vitest';
import { MATCH_TIMELINE_JOB_NAME } from '@league-helper/shared';
import { MatchTimelineProducer } from './match-timeline.producer';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

describe('MatchTimelineProducer', () => {
  it('does not duplicate live waiting jobs', async () => {
    const remove = vi.fn();
    const add = vi.fn();
    const getJob = vi.fn(async () => ({
      getState: async () => 'waiting' as const,
      remove,
    }));
    const producer = new MatchTimelineProducer(
      { getJob, add, name: 'match-timeline' } as never,
      { matchTimelineJobAttempts: 5 } as never,
    );

    const result = await producer.enqueueEnrichment({
      matchId: MATCH_ID,
      correlationId: 'corr-1',
    });

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(result.published).toBe(true);
    expect(result.alreadyExists).toBe(true);
  });

  it('republishes when an existing BullMQ job is completed', async () => {
    const remove = vi.fn(async () => undefined);
    const add = vi.fn(async () => ({ id: 'tl_test' }));
    const getJob = vi.fn(async () => ({
      getState: async () => 'completed' as const,
      remove,
    }));
    const producer = new MatchTimelineProducer(
      { getJob, add, name: 'match-timeline' } as never,
      { matchTimelineJobAttempts: 5 } as never,
    );

    const result = await producer.enqueueEnrichment({
      matchId: MATCH_ID,
      correlationId: 'corr-1',
    });

    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      MATCH_TIMELINE_JOB_NAME,
      { matchId: MATCH_ID, correlationId: 'corr-1' },
      expect.objectContaining({ jobId: `tl_${MATCH_ID}`, attempts: 5 }),
    );
    expect(result.published).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('never includes includeIneligible on the published payload', async () => {
    const add = vi.fn(async () => ({ id: 'tl_test' }));
    const producer = new MatchTimelineProducer(
      { getJob: vi.fn(async () => undefined), add, name: 'match-timeline' } as never,
      { matchTimelineJobAttempts: 5 } as never,
    );

    await producer.enqueueEnrichment({
      matchId: MATCH_ID,
      correlationId: 'corr-1',
      includeIneligible: true,
    });

    expect(add).toHaveBeenCalledWith(
      MATCH_TIMELINE_JOB_NAME,
      { matchId: MATCH_ID, correlationId: 'corr-1' },
      expect.objectContaining({ jobId: `tl_${MATCH_ID}` }),
    );
    const publishedPayload = add.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(publishedPayload).not.toHaveProperty('includeIneligible');
  });

  it('always attempts Redis rather than no-opping on an enabled flag', async () => {
    const getJob = vi.fn(async () => undefined);
    const add = vi.fn(async () => ({ id: 'tl_test' }));
    const producer = new MatchTimelineProducer(
      { getJob, add, name: 'match-timeline' } as never,
      { matchTimelineJobAttempts: 5 } as never,
    );

    const result = await producer.enqueueEnrichment({ matchId: MATCH_ID });

    expect(getJob).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
    expect(result.published).toBe(true);
  });

  it('returns published false on Redis errors instead of throwing', async () => {
    const producer = new MatchTimelineProducer(
      {
        getJob: vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
        add: vi.fn(),
        name: 'match-timeline',
      } as never,
      { matchTimelineJobAttempts: 5 } as never,
    );

    const result = await producer.enqueueEnrichment({
      matchId: MATCH_ID,
      correlationId: 'corr-1',
    });

    expect(result.published).toBe(false);
    expect(result.alreadyExists).toBe(false);
  });
});
