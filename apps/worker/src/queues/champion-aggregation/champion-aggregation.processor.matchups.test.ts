import { describe, expect, it, vi } from 'vitest';
import { type Job } from 'bullmq';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { processChampionAggregationJob } from './champion-aggregation.processor.js';
import { recalculateForMatch } from './champion-aggregation.service.js';

vi.mock('./champion-aggregation.service.js', () => ({
  recalculateForMatch: vi.fn(),
}));

const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function config(): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation',
    concurrency: 2,
    jobAttempts: 5,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    matchupAggregationVersion: 'matchup-v1',
    confidenceLevel: 0.95,
  };
}

describe('champion aggregation matchup hook', () => {
  it('recomputes matchups from source after a completed champion aggregation', async () => {
    vi.mocked(recalculateForMatch).mockResolvedValue({
      outcome: 'completed',
      keysRecalculated: 1,
      rowsUpserted: 1,
      rowsDeleted: 0,
      cacheGenerationsIncremented: 1,
      wrote: true,
      scopeRemains: false,
    });
    const recalculateMatchups = vi.fn().mockResolvedValue({ upserts: 4, deletions: 2 });
    const prisma = {} as never;
    const redis = { incr: vi.fn() } as never;

    await processChampionAggregationJob(
      {
        id: 'agg_matchup_hook',
        name: CHAMPION_AGGREGATION_JOB_NAME,
        data: {
          matchId: MATCH_ID,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
          correlationId: 'corr-matchup',
        },
        attemptsMade: 0,
        opts: { attempts: 5 },
      } as unknown as Job<ChampionAggregationJobPayload>,
      {
        prisma,
        redis,
        config: config(),
        repository: { loadRecalcScope: vi.fn() } as never,
        recalculateMatchups,
      },
    );

    expect(recalculateMatchups).toHaveBeenCalledWith({
      prisma,
      redis,
      matchId: MATCH_ID,
      sourceNormalizationVersion: '1',
      aggregationVersion: 'matchup-v1',
    });
  });

  it('does not recompute matchups when champion aggregation is skipped', async () => {
    vi.mocked(recalculateForMatch).mockResolvedValue({
      outcome: 'skipped_version_mismatch',
      reason: 'VERSION_MISMATCH',
      wrote: false,
      scopeRemains: false,
    });
    const recalculateMatchups = vi.fn();

    await processChampionAggregationJob(
      {
        id: 'agg_matchup_skip',
        name: CHAMPION_AGGREGATION_JOB_NAME,
        data: {
          matchId: MATCH_ID,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
        attemptsMade: 0,
        opts: { attempts: 5 },
      } as unknown as Job<ChampionAggregationJobPayload>,
      {
        prisma: {} as never,
        redis: { incr: vi.fn() } as never,
        config: config(),
        recalculateMatchups,
      },
    );

    expect(recalculateMatchups).not.toHaveBeenCalled();
  });
});
