import { describe, expect, it } from 'vitest';
import { loadMatchBootstrapConfig } from './bootstrap-player.config';

describe('loadMatchBootstrapConfig', () => {
  it('uses ops defaults when env is empty', () => {
    const cfg = loadMatchBootstrapConfig({});
    expect(cfg.defaultQueueId).toBe(420);
    expect(cfg.defaultMaxMatches).toBe(100);
    expect(cfg.hardMaxMatches).toBe(500);
    expect(cfg.pageSize).toBe(100);
    expect(cfg.fileMaxPlayers).toBe(25);
    expect(cfg.maxConcurrency).toBe(3);
    expect(cfg.waitTimeoutMs).toBe(120_000);
    expect(cfg.waitPollIntervalMs).toBe(2_000);
  });

  it('reads override env vars', () => {
    const cfg = loadMatchBootstrapConfig({
      MATCH_BOOTSTRAP_DEFAULT_MAX_MATCHES: '50',
      MATCH_BOOTSTRAP_MAX_CONCURRENCY: '2',
    });
    expect(cfg.defaultMaxMatches).toBe(50);
    expect(cfg.maxConcurrency).toBe(2);
  });

  it('rejects page size above Riot limit', () => {
    expect(() =>
      loadMatchBootstrapConfig({ MATCH_BOOTSTRAP_PAGE_SIZE: '101' }),
    ).toThrow(/MATCH_BOOTSTRAP_PAGE_SIZE/);
  });
});
