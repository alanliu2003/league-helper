import { describe, expect, it, vi } from 'vitest';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  buildChampionAggregationBullMqJobId,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import type { ChampionAggregationRepository } from './champion-aggregation.repository.js';
import {
  CHAMPION_AGGREGATION_REMOVE_ON_COMPLETE,
  CHAMPION_AGGREGATION_REMOVE_ON_FAIL,
  enqueueChampionAggregationAfterCommit,
  storeScopeAndEnqueueChampionAggregation,
} from './enqueue.js';

const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function config(): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation',
    concurrency: 2,
    jobAttempts: 5,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    matchupAggregationVersion: '1',
    confidenceLevel: 0.95,
  };
}

describe('enqueue champion aggregation', () => {
  it('stores durable previous keys then enqueues with retention opts', async () => {
    const upsertRecalcScope = vi.fn().mockResolvedValue(undefined);
    const repository = { upsertRecalcScope } as unknown as ChampionAggregationRepository;
    const add = vi.fn().mockResolvedValue({ id: 'job' });
    const queue = {
      getJob: vi.fn().mockResolvedValue(null),
      add,
    };

    const result = await storeScopeAndEnqueueChampionAggregation({
      queue: queue as never,
      repository,
      config: config(),
      matchId: MATCH_ID,
      previousSnapshots: [],
      correlationId: 'corr-1',
    });

    expect(upsertRecalcScope).toHaveBeenCalledWith({
      matchId: MATCH_ID,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      previousDimensionKeys: [],
    });
    expect(add).toHaveBeenCalledWith(
      CHAMPION_AGGREGATION_JOB_NAME,
      expect.objectContaining({
        matchId: MATCH_ID,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        correlationId: 'corr-1',
      }),
      expect.objectContaining({
        jobId: buildChampionAggregationBullMqJobId({
          matchId: MATCH_ID,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        }),
        removeOnComplete: { ...CHAMPION_AGGREGATION_REMOVE_ON_COMPLETE },
        removeOnFail: { ...CHAMPION_AGGREGATION_REMOVE_ON_FAIL },
      }),
    );
    expect(result.published).toBe(true);
  });

  it('removes completed retained job so retention re-enqueue works', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({ id: 'job' });
    const queue = {
      getJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        remove,
      }),
      add,
    };
    const repository = {
      upsertRecalcScope: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChampionAggregationRepository;

    await storeScopeAndEnqueueChampionAggregation({
      queue: queue as never,
      repository,
      config: config(),
      matchId: MATCH_ID,
      previousSnapshots: [],
    });

    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
  });

  it('dedupes live waiting jobs without re-add', async () => {
    const add = vi.fn();
    const queue = {
      getJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn(),
      }),
      add,
    };
    const repository = {
      upsertRecalcScope: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChampionAggregationRepository;

    const result = await storeScopeAndEnqueueChampionAggregation({
      queue: queue as never,
      repository,
      config: config(),
      matchId: MATCH_ID,
      previousSnapshots: [],
    });

    expect(result.published).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  it('best-effort enqueue returns null on failure without throwing', async () => {
    const result = await enqueueChampionAggregationAfterCommit({
      queue: {
        getJob: vi.fn().mockRejectedValue(new Error('redis down')),
        add: vi.fn(),
      } as never,
      repository: {
        upsertRecalcScope: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChampionAggregationRepository,
      config: config(),
      matchId: MATCH_ID,
      previousSnapshots: [],
    });

    expect(result).toBeNull();
  });
});
