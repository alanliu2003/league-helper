import { describe, expect, it } from 'vitest';
import { QUEUE_NAME, getRedisUrl } from './config.js';

describe('worker config', () => {
  it('uses the default redis url when unset', () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    expect(getRedisUrl()).toBe('redis://localhost:6379');
    if (previous === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previous;
    }
  });

  it('exposes a stable default queue name', () => {
    expect(QUEUE_NAME).toBe('league-helper-default');
  });

  it('keeps the smoke queue separate from match-ingestion', async () => {
    const { MATCH_INGESTION_QUEUE_NAME } = await import('@league-helper/shared');
    expect(QUEUE_NAME).not.toBe(MATCH_INGESTION_QUEUE_NAME);
  });
});

describe('match-ingestion worker config', () => {
  it('loads defaults for concurrency, attempts, and timeline flags', async () => {
    const { loadMatchIngestionWorkerConfig } = await import('./config.js');
    const config = loadMatchIngestionWorkerConfig({});
    expect(config.concurrency).toBe(2);
    expect(config.jobAttempts).toBe(5);
    expect(config.backoffBaseMs).toBe(2000);
    expect(config.backoffMaxMs).toBe(60_000);
    expect(config.riotShared429CooldownMinMs).toBe(15 * 60_000);
    expect(config.timelineFetchEnabled).toBe(true);
    expect(config.storeRawPayloads).toBe(false);
    expect(config.timelineRequiredForComplete).toBe(false);
    expect(config.normalizationVersion).toBe(1);
  });
});

describe('match-timeline worker config', () => {
  it('loads defaults for concurrency 1, attempts 5, and storeRawPayloads false', async () => {
    const { loadMatchTimelineWorkerConfig } = await import('./config.js');
    const config = loadMatchTimelineWorkerConfig({});
    expect(config.queueName).toBe('match-timeline');
    expect(config.concurrency).toBe(1);
    expect(config.jobAttempts).toBe(5);
    expect(config.backoffBaseMs).toBe(2000);
    expect(config.backoffMaxMs).toBe(60_000);
    expect(config.riotShared429CooldownMinMs).toBe(15 * 60_000);
    expect(config.storeRawPayloads).toBe(false);
    expect(config).not.toHaveProperty('timelineRequiredForComplete');
  });
});
