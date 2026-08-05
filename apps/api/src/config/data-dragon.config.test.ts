import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import { loadDataDragonConfig } from './data-dragon.config';

describe('loadDataDragonConfig', () => {
  it('applies defaults', () => {
    const config = loadDataDragonConfig({});
    expect(config).toEqual({
      locale: 'en_US',
      cacheTtlSeconds: 21_600,
      requestTimeoutMs: 10_000,
      baseUrl: 'https://ddragon.leagueoflegends.com',
    });
  });

  it('reads env overrides', () => {
    const config = loadDataDragonConfig({
      DATA_DRAGON_LOCALE: 'ko_KR',
      DATA_DRAGON_CACHE_TTL_SECONDS: '3600',
      DATA_DRAGON_REQUEST_TIMEOUT_MS: '5000',
    });
    expect(config.locale).toBe('ko_KR');
    expect(config.cacheTtlSeconds).toBe(3600);
    expect(config.requestTimeoutMs).toBe(5000);
  });

  it('rejects invalid locale', () => {
    expect(() => loadDataDragonConfig({ DATA_DRAGON_LOCALE: 'en-us' })).toThrow(
      ValidationFailureError,
    );
  });

  it('rejects out-of-range TTL', () => {
    expect(() => loadDataDragonConfig({ DATA_DRAGON_CACHE_TTL_SECONDS: '10' })).toThrow(
      ValidationFailureError,
    );
  });
});
