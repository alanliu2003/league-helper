import { describe, expect, it } from 'vitest';
import {
  classifyCollectorActivityTier,
  computeSuccessfulRefreshSchedule,
  type CollectorRefreshPolicyConfig,
} from './collector-refresh-policy';

const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = Date.parse('2026-08-10T12:00:00.000Z');

function policyConfig(
  overrides: Partial<CollectorRefreshPolicyConfig> = {},
): CollectorRefreshPolicyConfig {
  return {
    hotRefreshIntervalMs: 1 * HOUR_MS,
    warmRefreshIntervalMs: 6 * HOUR_MS,
    coldRefreshIntervalMs: 48 * HOUR_MS,
    coldAfterZeroNewRuns: 3,
    hotPriority: 100,
    warmPriority: 50,
    coldPriority: 10,
    priorityMin: 0,
    priorityMax: 1000,
    maxConsecutiveZeroNewMatchRuns: 100,
    ...overrides,
  };
}

describe('classifyCollectorActivityTier', () => {
  it('HOT when enqueuedNewCount >= 1', () => {
    expect(
      classifyCollectorActivityTier({
        enqueuedNewCount: 1,
        consecutiveZeroNewMatchRunsAfter: 0,
        coldAfterZeroNewRuns: 3,
      }),
    ).toBe('HOT');
  });

  it('WARM when zero-new and streak below cold threshold', () => {
    expect(
      classifyCollectorActivityTier({
        enqueuedNewCount: 0,
        consecutiveZeroNewMatchRunsAfter: 2,
        coldAfterZeroNewRuns: 3,
      }),
    ).toBe('WARM');
  });

  it('COLD when zero-new and streak reaches cold threshold', () => {
    expect(
      classifyCollectorActivityTier({
        enqueuedNewCount: 0,
        consecutiveZeroNewMatchRunsAfter: 3,
        coldAfterZeroNewRuns: 3,
      }),
    ).toBe('COLD');
  });
});

describe('computeSuccessfulRefreshSchedule', () => {
  it('new match success → HOT, resets zero streak, shorter interval, bounded priority', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 3,
      consecutiveZeroNewMatchRuns: 7,
      nowMs: NOW_MS,
      config: policyConfig(),
    });

    expect(result.activityTier).toBe('HOT');
    expect(result.consecutiveZeroNewMatchRuns).toBe(0);
    expect(result.nextEligibleDelayMs).toBe(1 * HOUR_MS);
    expect(result.nextEligibleAt.toISOString()).toBe('2026-08-10T13:00:00.000Z');
    expect(result.priority).toBe(100);
  });

  it('HOT priority is set to configured tier value (not unbounded increment)', () => {
    const first = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 1,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig({ hotPriority: 100 }),
    });
    const second = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 5,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig({ hotPriority: 100 }),
    });
    expect(first.priority).toBe(100);
    expect(second.priority).toBe(100);
  });

  it('first zero-new success → WARM, increments streak, normal interval', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig(),
    });

    expect(result.activityTier).toBe('WARM');
    expect(result.consecutiveZeroNewMatchRuns).toBe(1);
    expect(result.nextEligibleDelayMs).toBe(6 * HOUR_MS);
    expect(result.priority).toBe(50);
  });

  it('threshold zero-new success → COLD with longer interval and lower priority', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: 2,
      nowMs: NOW_MS,
      config: policyConfig({ coldAfterZeroNewRuns: 3 }),
    });

    expect(result.activityTier).toBe('COLD');
    expect(result.consecutiveZeroNewMatchRuns).toBe(3);
    expect(result.nextEligibleDelayMs).toBe(48 * HOUR_MS);
    expect(result.nextEligibleAt.toISOString()).toBe('2026-08-12T12:00:00.000Z');
    expect(result.priority).toBe(10);
  });

  it('cold threshold progression then recovery on new match', () => {
    const cfg = policyConfig({ coldAfterZeroNewRuns: 3 });

    const run1 = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: cfg,
    });
    expect(run1.activityTier).toBe('WARM');
    expect(run1.consecutiveZeroNewMatchRuns).toBe(1);

    const run2 = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: run1.consecutiveZeroNewMatchRuns,
      nowMs: NOW_MS,
      config: cfg,
    });
    expect(run2.activityTier).toBe('WARM');
    expect(run2.consecutiveZeroNewMatchRuns).toBe(2);

    const run3 = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: run2.consecutiveZeroNewMatchRuns,
      nowMs: NOW_MS,
      config: cfg,
    });
    expect(run3.activityTier).toBe('COLD');
    expect(run3.consecutiveZeroNewMatchRuns).toBe(3);

    const run4 = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: run3.consecutiveZeroNewMatchRuns,
      nowMs: NOW_MS,
      config: cfg,
    });
    expect(run4.activityTier).toBe('COLD');
    expect(run4.consecutiveZeroNewMatchRuns).toBe(4);

    const recovered = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 1,
      consecutiveZeroNewMatchRuns: run4.consecutiveZeroNewMatchRuns,
      nowMs: NOW_MS,
      config: cfg,
    });
    expect(recovered.activityTier).toBe('HOT');
    expect(recovered.consecutiveZeroNewMatchRuns).toBe(0);
    expect(recovered.priority).toBe(100);
    expect(recovered.nextEligibleDelayMs).toBe(1 * HOUR_MS);
  });

  it('zero streak never becomes negative', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 2,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig(),
    });
    expect(result.consecutiveZeroNewMatchRuns).toBe(0);
  });

  it('caps consecutive zero-new counter at configured max', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: 99,
      nowMs: NOW_MS,
      config: policyConfig({ maxConsecutiveZeroNewMatchRuns: 100, coldAfterZeroNewRuns: 3 }),
    });
    expect(result.consecutiveZeroNewMatchRuns).toBe(100);
    expect(result.activityTier).toBe('COLD');
  });

  it('uses injected nowMs for deterministic nextEligibleAt', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig(),
    });
    expect(result.nextEligibleAt.getTime()).toBe(NOW_MS + 6 * HOUR_MS);
  });

  it('clamps activity priority into configured priority bounds', () => {
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 1,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig({
        hotPriority: 5000,
        priorityMin: 0,
        priorityMax: 200,
      }),
    });
    expect(result.priority).toBe(200);
  });

  it('treats discovered-but-already-complete style zero enqueue as zero-new (not HOT)', () => {
    // Caller responsibility: pass enqueuedNewCount from discovery.enqueuedCount,
    // not discoveredMatchCount. 20 discovered / 0 enqueued → WARM/COLD.
    const result = computeSuccessfulRefreshSchedule({
      enqueuedNewCount: 0,
      consecutiveZeroNewMatchRuns: 0,
      nowMs: NOW_MS,
      config: policyConfig(),
    });
    expect(result.activityTier).toBe('WARM');
    expect(result.consecutiveZeroNewMatchRuns).toBe(1);
  });
});
