import { describe, expect, it } from 'vitest';
import { loadChampionStaticSyncConfig } from './sync-champion-static.config';

describe('loadChampionStaticSyncConfig', () => {
  it('defaults version to latest and min champions to 100', () => {
    const cfg = loadChampionStaticSyncConfig({});
    expect(cfg.version).toBe('latest');
    expect(cfg.minChampions).toBe(100);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.baseUrl).toBe('https://ddragon.leagueoflegends.com');
  });

  it('accepts pinned DATA_DRAGON_VERSION', () => {
    const cfg = loadChampionStaticSyncConfig({ DATA_DRAGON_VERSION: '16.10.1' });
    expect(cfg.version).toBe('16.10.1');
  });

  it('reads locale and timeout from existing Data Dragon env vars', () => {
    const cfg = loadChampionStaticSyncConfig({
      DATA_DRAGON_LOCALE: 'ko_KR',
      DATA_DRAGON_REQUEST_TIMEOUT_MS: '5000',
    });
    expect(cfg.locale).toBe('ko_KR');
    expect(cfg.requestTimeoutMs).toBe(5000);
  });

  it('rejects invalid min champions', () => {
    expect(() =>
      loadChampionStaticSyncConfig({ DATA_DRAGON_SYNC_MIN_CHAMPIONS: '0' }),
    ).toThrow(/DATA_DRAGON_SYNC_MIN_CHAMPIONS/);
  });
});
