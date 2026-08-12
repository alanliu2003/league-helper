import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import {
  computeMinimumSchedulerLeaseMs,
  loadCollectorConfig,
  PARTICIPANT_EXPANSION_CONFIG_VECTORS,
  readCollectorSchedulerEnabled,
} from './collector.config';

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
      hotRefreshIntervalMs: 1 * HOUR_MS,
      warmRefreshIntervalMs: 6 * HOUR_MS,
      coldRefreshIntervalMs: 48 * HOUR_MS,
      coldAfterZeroNewRuns: 3,
      hotPriority: 100,
      warmPriority: 50,
      coldPriority: 10,
      maxConsecutiveZeroNewMatchRuns: 100,
      ladderInitialPriority: 50,
      productRootInitialPriority: 100,
      schedulerEnabled: false,
      scheduleIntervalMs: 15 * MINUTE_MS,
      scheduleBatchSize: 10,
      scheduleConcurrency: 2,
      scheduleMaxMatchesPerPlayer: 20,
      scheduleMaxMatchIds: 200,
      scheduleMaxEnqueue: 200,
      schedulerLeaseSafetyMarginMs: 5 * MINUTE_MS,
      schedulerLeaseMs: 60 * MINUTE_MS,
      schedulerRateLimitCooldownMs: 15 * MINUTE_MS,
      riotShared429CooldownMinMs: 15 * MINUTE_MS,
      maxPendingIngestionJobs: 500,
      scheduleQueueId: 420,
      schedulePlatform: null,
      expandFromParticipants: false,
      expansionMaxDepth: 1,
      expansionMaxNewPlayersPerMatch: 3,
      expansionMaxNewPlayersPerSourcePlayer: 5,
      expansionMaxNewPlayersPerRun: 20,
      expansionMaxTrackedPlayers: 500,
      expansionQueueId: 420,
      totalTrackedPlayersHardCap: 5000,
      ladderMaxTotal: 3000,
      ladderMaxNewPerRun: 100,
      ladderQueueType: 'RANKED_SOLO_5x5',
      ladderTiers: ['CHALLENGER', 'GRANDMASTER'],
      ladderRepresentativeTiers: ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD'],
      ladderMaxPagesPerTierDivision: 1,
      ladderMaxCandidatesScanned: 500,
      ladderPlatform: null,
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

  it('enforces min warm refresh interval of 1 minute (legacy MIN_REFRESH alias)', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_MIN_REFRESH_INTERVAL_MS: String(MINUTE_MS - 1),
        COLLECTOR_HOT_REFRESH_INTERVAL_MS: String(30_000),
      }),
    ).toThrow(ValidationFailureError);

    const config = loadCollectorConfig({
      COLLECTOR_MIN_REFRESH_INTERVAL_MS: String(MINUTE_MS),
      COLLECTOR_HOT_REFRESH_INTERVAL_MS: String(30_000),
      COLLECTOR_COLD_REFRESH_INTERVAL_MS: String(2 * MINUTE_MS),
    });
    expect(config.minRefreshIntervalMs).toBe(MINUTE_MS);
    expect(config.warmRefreshIntervalMs).toBe(MINUTE_MS);
  });

  it('rejects activity intervals that are not HOT < WARM < COLD', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_HOT_REFRESH_INTERVAL_MS: String(6 * HOUR_MS),
        COLLECTOR_WARM_REFRESH_INTERVAL_MS: String(6 * HOUR_MS),
        COLLECTOR_COLD_REFRESH_INTERVAL_MS: String(48 * HOUR_MS),
      }),
    ).toThrow(/HOT < WARM < COLD/i);
  });

  it('rejects activity priorities that are not HOT >= WARM >= COLD', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_HOT_PRIORITY: '10',
        COLLECTOR_WARM_PRIORITY: '50',
        COLLECTOR_COLD_PRIORITY: '100',
      }),
    ).toThrow(/HOT >= WARM >= COLD/i);
  });

  it('rejects ladder initial priority above product root initial priority', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_LADDER_INITIAL_PRIORITY: '200',
        COLLECTOR_PRODUCT_ROOT_INITIAL_PRIORITY: '100',
      }),
    ).toThrow(/LADDER_INITIAL_PRIORITY/i);
  });

  it('defaults expansion/scheduler flags to safe disabled values', () => {
    const config = loadCollectorConfig({});
    expect(config.schedulerEnabled).toBe(false);
    expect(config.expandFromParticipants).toBe(false);
  });

  it('readCollectorSchedulerEnabled uses same boolean rules as loadCollectorConfig', () => {
    expect(readCollectorSchedulerEnabled({})).toBe(false);
    expect(readCollectorSchedulerEnabled({ COLLECTOR_SCHEDULER_ENABLED: 'true' })).toBe(true);
    expect(readCollectorSchedulerEnabled({ COLLECTOR_SCHEDULER_ENABLED: '0' })).toBe(false);
    expect(() =>
      readCollectorSchedulerEnabled({ COLLECTOR_SCHEDULER_ENABLED: 'maybe' }),
    ).toThrow(ValidationFailureError);
  });

  it('rejects unsafe scheduler lease vs batch/concurrency/timeout', () => {
    // Derived minimum under Task 3 defaults: ceil(10/2)*10m + 5m = 55m
    const unsafeLease = 30 * MINUTE_MS;
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_SCHEDULER_LEASE_MS: String(unsafeLease),
      }),
    ).toThrow(ValidationFailureError);
  });

  it('rejects lease equal to derived minimum (strict greater-than)', () => {
    const minimum = computeMinimumSchedulerLeaseMs({
      scheduleBatchSize: 10,
      scheduleConcurrency: 2,
      playerTimeoutMs: 10 * MINUTE_MS,
      schedulerLeaseSafetyMarginMs: 5 * MINUTE_MS,
    });
    expect(minimum).toBe(55 * MINUTE_MS);

    expect(() =>
      loadCollectorConfig({
        COLLECTOR_SCHEDULER_LEASE_MS: String(minimum),
      }),
    ).toThrow(/SCHEDULER_LEASE_MS must be greater/i);
  });

  it('accepts lease at minimum + 1ms', () => {
    const minimum = 55 * MINUTE_MS;
    const config = loadCollectorConfig({
      COLLECTOR_SCHEDULER_LEASE_MS: String(minimum + 1),
    });
    expect(config.schedulerLeaseMs).toBe(minimum + 1);
  });

  it('accepts default config (60m lease with Task 3 defaults)', () => {
    const config = loadCollectorConfig({});
    const minimum = computeMinimumSchedulerLeaseMs({
      scheduleBatchSize: config.scheduleBatchSize,
      scheduleConcurrency: config.scheduleConcurrency,
      playerTimeoutMs: config.playerTimeoutMs,
      schedulerLeaseSafetyMarginMs: config.schedulerLeaseSafetyMarginMs,
    });
    expect(minimum).toBe(55 * MINUTE_MS);
    expect(config.schedulerLeaseMs).toBe(60 * MINUTE_MS);
    expect(config.schedulerLeaseMs).toBeGreaterThan(minimum);
  });

  it('clamps expansion budget knobs to hard maxima', () => {
    // Hard-max schedule batch/concurrency raises lease minimum to 105m; set lease above it.
    const config = loadCollectorConfig({
      COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH: '999',
      COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER: '999',
      COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN: '9999',
      COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS: '99999',
      COLLECTOR_SCHEDULE_BATCH_SIZE: '999',
      COLLECTOR_SCHEDULE_CONCURRENCY: '99',
      COLLECTOR_SCHEDULER_LEASE_MS: String(120 * MINUTE_MS),
    });

    expect(config.expansionMaxNewPlayersPerMatch).toBe(
      PARTICIPANT_EXPANSION_CONFIG_VECTORS.maxNewPlayersPerMatchHardMax,
    );
    expect(config.expansionMaxNewPlayersPerSourcePlayer).toBe(
      PARTICIPANT_EXPANSION_CONFIG_VECTORS.maxNewPlayersPerSourcePlayerHardMax,
    );
    expect(config.expansionMaxNewPlayersPerRun).toBe(
      PARTICIPANT_EXPANSION_CONFIG_VECTORS.maxNewPlayersPerRunHardMax,
    );
    expect(config.expansionMaxTrackedPlayers).toBe(
      PARTICIPANT_EXPANSION_CONFIG_VECTORS.maxTrackedPlayersHardMax,
    );
    expect(config.scheduleBatchSize).toBe(50);
    expect(config.scheduleConcurrency).toBe(5);
  });

  it('rejects expansion depth outside 0..3', () => {
    expect(() =>
      loadCollectorConfig({
        COLLECTOR_EXPANSION_MAX_DEPTH: '4',
      }),
    ).toThrow(ValidationFailureError);

    expect(() =>
      loadCollectorConfig({
        COLLECTOR_EXPANSION_MAX_DEPTH: '-1',
      }),
    ).toThrow(ValidationFailureError);

    expect(loadCollectorConfig({ COLLECTOR_EXPANSION_MAX_DEPTH: '0' }).expansionMaxDepth).toBe(0);
    expect(loadCollectorConfig({ COLLECTOR_EXPANSION_MAX_DEPTH: '3' }).expansionMaxDepth).toBe(3);
  });

  describe('Milestone 11 ladder enrollment knobs', () => {
    it('rejects values above hard maxima (fail-fast, no silent clamp)', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP: '50001',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_TOTAL: '20001',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_NEW_PER_RUN: '1001',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION: '6',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_CANDIDATES_SCANNED: '5001',
        }),
      ).toThrow(ValidationFailureError);
    });

    it('rejects zero and negative safety caps', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP: '0',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_TOTAL: '-1',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_NEW_PER_RUN: '0',
        }),
      ).toThrow(ValidationFailureError);
    });

    it('rejects ladder total greater than global total hard cap', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP: '1000',
          COLLECTOR_LADDER_MAX_TOTAL: '1001',
        }),
      ).toThrow(/LADDER_MAX_TOTAL must be less than or equal/i);
    });

    it('rejects per-run create ceiling greater than ladder max total', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_MAX_TOTAL: '50',
          COLLECTOR_LADDER_MAX_NEW_PER_RUN: '51',
        }),
      ).toThrow(/LADDER_MAX_NEW_PER_RUN must be less than or equal/i);
    });

    it('rejects invalid ladder queue type', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_QUEUE_TYPE: 'RANKED_FLEX_SR',
        }),
      ).toThrow(/RANKED_SOLO_5x5/i);
    });

    it('rejects invalid or non-allowlisted ladder tiers', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_TIERS: 'CHALLENGER,DIAMOND',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_REPRESENTATIVE_TIERS: 'DIAMOND,CHALLENGER',
        }),
      ).toThrow(ValidationFailureError);

      expect(() =>
        loadCollectorConfig({
          COLLECTOR_LADDER_TIERS: 'NOT_A_TIER',
        }),
      ).toThrow(ValidationFailureError);
    });

    it('accepts allowlisted Apex tiers including MASTER and optional ladder platform', () => {
      const config = loadCollectorConfig({
        COLLECTOR_PLATFORM_ALLOWLIST: 'na1,euw1',
        COLLECTOR_LADDER_PLATFORM: 'euw1',
        COLLECTOR_LADDER_TIERS: 'GRANDMASTER,CHALLENGER,MASTER,GRANDMASTER',
        COLLECTOR_LADDER_REPRESENTATIVE_TIERS: 'GOLD,DIAMOND,SILVER,IRON',
      });

      expect(config.ladderPlatform).toBe('euw1');
      expect(config.ladderTiers).toEqual(['GRANDMASTER', 'CHALLENGER', 'MASTER']);
      expect(config.ladderRepresentativeTiers).toEqual(['GOLD', 'DIAMOND', 'SILVER', 'IRON']);
      expect(config.ladderQueueType).toBe('RANKED_SOLO_5x5');
    });

    it('rejects ladder platform outside platform allowlist', () => {
      expect(() =>
        loadCollectorConfig({
          COLLECTOR_PLATFORM_ALLOWLIST: 'na1',
          COLLECTOR_LADDER_PLATFORM: 'euw1',
        }),
      ).toThrow(/COLLECTOR_LADDER_PLATFORM must be included/i);
    });
  });
});
