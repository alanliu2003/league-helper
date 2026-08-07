import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import { loadCollectorConfig } from './collector.config';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe('loadCollectorConfig', () => {
  it('returns approved defaults when env is empty', () => {
    const config = loadCollectorConfig({});

    expect(config).toEqual({
      batchSize: 10,
      concurrency: 2,
      matchesPerPlayer: 20,
      maxMatchIdsPerRun: 200,
      maxEnqueuePerRun: 200,
      minRefreshIntervalMs: 6 * HOUR_MS,
      baseBackoffMs: 15 * MINUTE_MS,
      maxBackoffMs: 24 * HOUR_MS,
      maxBackoffExponent: 8,
      playerTimeoutMs: 10 * MINUTE_MS,
      leaseDurationMs: 15 * MINUTE_MS,
      staleRunAfterMs: 2 * HOUR_MS,
      platformAllowlist: ['na1'],
      estimatedRequestsPerEnqueuedMatch: 2,
      priorityMin: 0,
      priorityMax: 1000,
      enrollFromBootstrap: false,
      enrollFromSearch: false,
    });
  });

  it('clamps batch/concurrency/matches/budgets to hard caps', () => {
    const config = loadCollectorConfig({
      COLLECTOR_BATCH_SIZE: '999',
      COLLECTOR_CONCURRENCY: '99',
      COLLECTOR_MATCHES_PER_PLAYER: '500',
      COLLECTOR_MAX_MATCH_IDS_PER_RUN: '5000',
      COLLECTOR_MAX_ENQUEUE_PER_RUN: '5000',
    });

    expect(config.batchSize).toBe(50);
    expect(config.concurrency).toBe(5);
    expect(config.matchesPerPlayer).toBe(100);
    expect(config.maxMatchIdsPerRun).toBe(1000);
    expect(config.maxEnqueuePerRun).toBe(1000);
  });

  it('rejects lease duration that is not greater than player timeout + 60s margin', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_PLAYER_TIMEOUT_MS: String(10 * MINUTE_MS),
        COLLECTOR_LEASE_DURATION_MS: String(10 * MINUTE_MS + 60_000),
      }),
    ).toThrow(ValidationFailureError);

    expect(() =>
      loadCollectorConfig({
        COLLECTOR_PLAYER_TIMEOUT_MS: String(10 * MINUTE_MS),
        COLLECTOR_LEASE_DURATION_MS: String(10 * MINUTE_MS + 60_000 - 1),
      }),
    ).toThrow(/lease/i);
  });

  it('rejects stale-run threshold that is not greater than lease duration', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_LEASE_DURATION_MS: String(15 * MINUTE_MS),
        COLLECTOR_STALE_RUN_AFTER_MS: String(15 * MINUTE_MS),
      }),
    ).toThrow(ValidationFailureError);

    expect(() =>
      loadCollectorConfig({
        COLLECTOR_LEASE_DURATION_MS: String(15 * MINUTE_MS),
        COLLECTOR_STALE_RUN_AFTER_MS: String(15 * MINUTE_MS - 1),
      }),
    ).toThrow(/stale/i);
  });

  it('accepts valid lease/timeout/stale relationships', () => {
    const config = loadCollectorConfig({
      COLLECTOR_PLAYER_TIMEOUT_MS: String(10 * MINUTE_MS),
      COLLECTOR_LEASE_DURATION_MS: String(10 * MINUTE_MS + 60_000 + 1),
      COLLECTOR_STALE_RUN_AFTER_MS: String(10 * MINUTE_MS + 60_000 + 2),
    });

    expect(config.leaseDurationMs).toBe(10 * MINUTE_MS + 60_000 + 1);
    expect(config.staleRunAfterMs).toBe(10 * MINUTE_MS + 60_000 + 2);
  });

  it('parses and normalizes platform allowlist', () => {
    const config = loadCollectorConfig({
      COLLECTOR_PLATFORM_ALLOWLIST: ' NA1 , euw1 , KR ',
    });

    expect(config.platformAllowlist).toEqual(['na1', 'euw1', 'kr']);
  });

  it('rejects unsupported platforms in allowlist', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_PLATFORM_ALLOWLIST: 'na1,cn1',
      }),
    ).toThrow();
  });

  it('defaults enrollment flags to false and parses true when set', () => {
    expect(loadCollectorConfig({}).enrollFromBootstrap).toBe(false);
    expect(loadCollectorConfig({}).enrollFromSearch).toBe(false);

    const enabled = loadCollectorConfig({
      COLLECTOR_ENROLL_FROM_BOOTSTRAP: 'true',
      COLLECTOR_ENROLL_FROM_SEARCH: 'TRUE',
    });
    expect(enabled.enrollFromBootstrap).toBe(true);
    expect(enabled.enrollFromSearch).toBe(true);
  });

  it('exposes priority clamp bounds from env', () => {
    const config = loadCollectorConfig({
      COLLECTOR_PRIORITY_MIN: '10',
      COLLECTOR_PRIORITY_MAX: '500',
    });

    expect(config.priorityMin).toBe(10);
    expect(config.priorityMax).toBe(500);
  });

  it('rejects priority min greater than priority max', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_PRIORITY_MIN: '100',
        COLLECTOR_PRIORITY_MAX: '50',
      }),
    ).toThrow(ValidationFailureError);
  });

  it('enforces min refresh interval of 1 minute', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_MIN_REFRESH_INTERVAL_MS: String(MINUTE_MS - 1),
      }),
    ).toThrow(ValidationFailureError);

    const config = loadCollectorConfig({
      COLLECTOR_MIN_REFRESH_INTERVAL_MS: String(MINUTE_MS),
    });
    expect(config.minRefreshIntervalMs).toBe(MINUTE_MS);
  });
});
