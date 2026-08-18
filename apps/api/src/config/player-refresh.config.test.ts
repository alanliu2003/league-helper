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

  it('defaults match timeline search backfill to false', () => {
    delete process.env.MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED;
    delete process.env.MATCH_TIMELINE_QUEUE_NAME;
    delete process.env.MATCH_TIMELINE_JOB_ATTEMPTS;
    const config = loadPlayerRefreshConfig(process.env);
    expect(config.matchTimelineSearchBackfillEnabled).toBe(false);
    expect(config.matchTimelineQueueName).toBe('match-timeline');
    expect(config.matchTimelineJobAttempts).toBe(5);
  });

  it('enables match timeline search backfill when the env flag is true', () => {
    process.env.MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED = 'true';
    const config = loadPlayerRefreshConfig(process.env);
    expect(config.matchTimelineSearchBackfillEnabled).toBe(true);
  });

  it('rejects match timeline job attempts above 20', () => {
    process.env.MATCH_TIMELINE_JOB_ATTEMPTS = '21';
    expect(() => loadPlayerRefreshConfig(process.env)).toThrow(
      /MATCH_TIMELINE_JOB_ATTEMPTS must be at most 20/,
    );
  });
});
