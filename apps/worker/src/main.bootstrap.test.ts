import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BULLMQ_DEFAULT_PREFIX,
  CHAMPION_AGGREGATION_JOB_NAME,
  CHAMPION_AGGREGATION_QUEUE_NAME,
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_QUEUE_NAME,
  resolveBullMqPrefix,
} from '@league-helper/shared';
import {
  QUEUE_NAME,
  loadChampionAggregationWorkerConfig,
  loadMatchIngestionWorkerConfig,
} from './config.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('worker bootstrap (dev:worker)', () => {
  it('registers match-ingestion as a primary queue config', () => {
    const config = loadMatchIngestionWorkerConfig({});
    expect(config.queueName).toBe(MATCH_INGESTION_QUEUE_NAME);
    expect(MATCH_INGESTION_JOB_NAME).toBe('INGEST_MATCH');
  });

  it('registers champion-aggregation as a primary queue config', () => {
    const config = loadChampionAggregationWorkerConfig({});
    expect(config.queueName).toBe(CHAMPION_AGGREGATION_QUEUE_NAME);
    expect(CHAMPION_AGGREGATION_JOB_NAME).toBe('RECALCULATE_CHAMPION_AGGREGATES');
    expect(config.sourceNormalizationVersion).toBe('1');
    expect(config.aggregationVersion).toBe('1');
  });

  it('does not treat league-helper-default as a production queue', () => {
    expect(QUEUE_NAME).toBe('league-helper-default');
    expect(QUEUE_NAME).not.toBe(MATCH_INGESTION_QUEUE_NAME);
    expect(QUEUE_NAME).not.toBe(CHAMPION_AGGREGATION_QUEUE_NAME);
  });

  it('shares the default BullMQ prefix with the API', () => {
    expect(resolveBullMqPrefix({})).toBe(BULLMQ_DEFAULT_PREFIX);
    expect(resolveBullMqPrefix({})).toBe('bull');
  });

  it('main.ts starts match-ingestion and champion-aggregation only', () => {
    const source = readFileSync(join(here, 'main.ts'), 'utf8');
    expect(source).toContain('createMatchIngestionWorker');
    expect(source).toContain('createChampionAggregationWorker');
    expect(source).toContain('MATCH_INGESTION_JOB_NAME');
    expect(source).toContain('CHAMPION_AGGREGATION_JOB_NAME');
    expect(source).not.toContain('createDefaultWorker');
    expect(source).not.toContain('createDefaultQueue');
    expect(source).toContain('both_consumers_initialized');
    expect(source).toContain('matchIngestionWorker.close()');
    expect(source).toContain('championAggregationWorker.close()');
  });

  it('smoke CLI remains available separately', () => {
    const source = readFileSync(join(here, 'cli/smoke-worker.ts'), 'utf8');
    expect(source).toContain('createDefaultWorker');
    expect(source).toContain('league-helper-default');
  });
});
