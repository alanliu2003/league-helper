import { describe, expect, it } from 'vitest';
import {
  BULLMQ_DEFAULT_PREFIX,
  createBullMqConnectionOptions,
  parseBullMqRedisConnectionInfo,
  resolveBullMqPrefix,
} from './bullmq-connection';
import { MATCH_INGESTION_QUEUE_NAME } from './queue-names';

describe('bullmq connection shared config', () => {
  it('defaults prefix to bull', () => {
    expect(resolveBullMqPrefix({})).toBe(BULLMQ_DEFAULT_PREFIX);
  });

  it('parses redis database without exposing credentials', () => {
    const info = parseBullMqRedisConnectionInfo('redis://:secret@localhost:6379/2');
    expect(info.database).toBe(2);
    expect(info.host).toBe('localhost');
    expect(info.port).toBe(6379);
    expect(JSON.stringify(info)).not.toContain('secret');
  });

  it('builds connection options with shared maxRetriesPerRequest', () => {
    const options = createBullMqConnectionOptions('redis://localhost:6379/0');
    expect(options.maxRetriesPerRequest).toBeNull();
    expect(options.url).toContain('localhost');
  });

  it('keeps match-ingestion queue name stable for API and worker', () => {
    expect(MATCH_INGESTION_QUEUE_NAME).toBe('match-ingestion');
  });
});
