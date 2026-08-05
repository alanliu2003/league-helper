import { afterEach, describe, expect, it } from 'vitest';
import { loadPlayerRefreshConfig } from './player-refresh.config';

describe('loadPlayerRefreshConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('defaults general match discovery queue filter to null (all queues)', () => {
    delete process.env.PLAYER_DEFAULT_MATCH_QUEUE_ID;
    delete process.env.PLAYER_DEFAULT_QUEUE_ID;
    const config = loadPlayerRefreshConfig(process.env);
    expect(config.defaultMatchQueueId).toBeNull();
    expect(config.rankedSoloQueueId).toBe(420);
  });

  it('treats empty PLAYER_DEFAULT_MATCH_QUEUE_ID as all queues', () => {
    process.env.PLAYER_DEFAULT_MATCH_QUEUE_ID = '';
    const config = loadPlayerRefreshConfig(process.env);
    expect(config.defaultMatchQueueId).toBeNull();
  });

  it('accepts an explicit default match queue id when set', () => {
    process.env.PLAYER_DEFAULT_MATCH_QUEUE_ID = '440';
    const config = loadPlayerRefreshConfig(process.env);
    expect(config.defaultMatchQueueId).toBe(440);
  });
});
