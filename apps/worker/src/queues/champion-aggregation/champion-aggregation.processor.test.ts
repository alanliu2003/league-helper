import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { processChampionAggregationJob } from './champion-aggregation.processor.js';
import type { ChampionAggregationRepository } from './champion-aggregation.repository.js';

const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const here = dirname(fileURLToPath(import.meta.url));

function config(
  overrides: Partial<ChampionAggregationWorkerConfig> = {},
): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation',
    concurrency: 2,
    jobAttempts: 5,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    matchupAggregationVersion: '1',
    confidenceLevel: 0.95,
    ...overrides,
  };
}

function makeJob(
  data: unknown,
  opts: { name?: string; attemptsMade?: number; attempts?: number } = {},
): Job<ChampionAggregationJobPayload> {
  return {
    id: 'agg_test_1',
    name: opts.name ?? CHAMPION_AGGREGATION_JOB_NAME,
    data: data as ChampionAggregationJobPayload,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 5 },
  } as unknown as Job<ChampionAggregationJobPayload>;
}

function validPayload(
  overrides: Partial<ChampionAggregationJobPayload> = {},
): ChampionAggregationJobPayload {
  return {
    matchId: MATCH_ID,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    correlationId: 'corr-agg-1',
    ...overrides,
  };
}

describe('processChampionAggregationJob', () => {
  it('rejects unsupported job names', async () => {
    await expect(
      processChampionAggregationJob(makeJob(validPayload(), { name: 'OTHER' }), {
        prisma: {} as never,
        redis: { incr: vi.fn() } as never,
        config: config(),
        repository: {
          loadRecalcScope: vi.fn(),
        } as unknown as ChampionAggregationRepository,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects invalid payload', async () => {
    await expect(
      processChampionAggregationJob(makeJob({ matchId: 'not-a-uuid' }), {
        prisma: {} as never,
        redis: { incr: vi.fn() } as never,
        config: config(),
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('does not accept PUUID or previous keys in job payload', () => {
    const schemaSource = readFileSync(
      join(here, '../../../../../packages/shared/src/job-queues/champion-aggregation-job.ts'),
      'utf8',
    );
    expect(schemaSource).not.toMatch(/puuid/i);
    expect(schemaSource).not.toContain('previousKeys');
    expect(schemaSource).toContain('matchId');
    expect(schemaSource).toContain('sourceNormalizationVersion');
    expect(schemaSource).toContain('aggregationVersion');
  });

  it('marks FAILED on terminal exhausted failure', async () => {
    const markProcessingFailed = vi.fn().mockResolvedValue(undefined);
    const repository = {
      loadRecalcScope: vi.fn().mockResolvedValue(null),
      markProcessingFailed,
    } as unknown as ChampionAggregationRepository;

    await expect(
      processChampionAggregationJob(makeJob(validPayload(), { attemptsMade: 4, attempts: 5 }), {
        prisma: {} as never,
        redis: { incr: vi.fn() } as never,
        config: config(),
        repository,
      }),
    ).rejects.toThrow('RECALC_SCOPE_MISSING');

    expect(markProcessingFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: MATCH_ID,
        lastErrorCode: 'RECALC_SCOPE_MISSING',
      }),
    );
  });

  it('does not mark FAILED on transient non-exhausted failure', async () => {
    const markProcessingFailed = vi.fn().mockResolvedValue(undefined);
    const repository = {
      loadRecalcScope: vi.fn().mockResolvedValue(null),
      markProcessingFailed,
    } as unknown as ChampionAggregationRepository;

    await expect(
      processChampionAggregationJob(makeJob(validPayload(), { attemptsMade: 0, attempts: 5 }), {
        prisma: {} as never,
        redis: { incr: vi.fn() } as never,
        config: config(),
        repository,
      }),
    ).rejects.toThrow('RECALC_SCOPE_MISSING');

    expect(markProcessingFailed).not.toHaveBeenCalled();
  });
});

describe('champion-aggregation source safety', () => {
  it('contains no Riot or Data Dragon calls in aggregation modules', () => {
    const files = readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const file of files) {
      const source = readFileSync(join(here, file), 'utf8');
      expect(source.toLowerCase()).not.toContain('ddragon');
      expect(source).not.toMatch(/getMatch\s*\(/);
      expect(source).not.toMatch(/getTimeline\s*\(/);
      expect(source).not.toContain('RIOT_API_KEY');
      expect(source).not.toContain('createGameDataProvider');
    }
  });

  it('logs only safe identifiers (no puuid field names in log calls)', () => {
    const source = readFileSync(join(here, 'champion-aggregation.processor.ts'), 'utf8');
    expect(source.toLowerCase()).not.toContain('puuid');
    expect(source).not.toContain('rawPayload');
  });
});
