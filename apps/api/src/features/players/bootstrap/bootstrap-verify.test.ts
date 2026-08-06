import { describe, expect, it, vi } from 'vitest';
import {
  ALL_POSITION_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
} from '@league-helper/match-analytics';
import {
  checkAggregateSmoke,
  resolveAggregateSmokeForRun,
  waitForMatchIngestion,
} from './bootstrap-verify';

describe('waitForMatchIngestion', () => {
  it('returns immediately for an empty ID list', async () => {
    const findMatches = vi.fn();
    const findJobs = vi.fn();
    const sleep = vi.fn();

    const summary = await waitForMatchIngestion(
      {
        findMatchesByExternalIds: findMatches,
        findDurableJobsByExternalIds: findJobs,
        sleep,
        now: () => 0,
      },
      {
        provider: 'RIOT',
        externalMatchIds: [],
        timeoutMs: 10_000,
        pollIntervalMs: 1_000,
      },
    );

    expect(summary).toEqual({
      completed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      timedOut: false,
      checkedMatchCount: 0,
    });
    expect(findMatches).not.toHaveBeenCalled();
    expect(findJobs).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reports all matches complete before timeout', async () => {
    const summary = await waitForMatchIngestion(
      {
        findMatchesByExternalIds: vi.fn(async () => [
          { externalMatchId: 'm1', ingestionStatus: 'COMPLETED' },
          { externalMatchId: 'm2', ingestionStatus: 'COMPLETED' },
        ]),
        findDurableJobsByExternalIds: vi.fn(async () => []),
        sleep: vi.fn(),
        now: () => 0,
      },
      {
        provider: 'RIOT',
        externalMatchIds: ['m1', 'm2'],
        timeoutMs: 5_000,
        pollIntervalMs: 100,
      },
    );

    expect(summary.completed).toBe(2);
    expect(summary.pending).toBe(0);
    expect(summary.timedOut).toBe(false);
  });

  it('includes failures and skipped in the summary', async () => {
    const summary = await waitForMatchIngestion(
      {
        findMatchesByExternalIds: vi.fn(async () => [
          { externalMatchId: 'ok', ingestionStatus: 'COMPLETED' },
          { externalMatchId: 'bad', ingestionStatus: 'FAILED' },
          { externalMatchId: 'skip', ingestionStatus: 'SKIPPED' },
        ]),
        findDurableJobsByExternalIds: vi.fn(async () => []),
        sleep: vi.fn(),
        now: () => 0,
      },
      {
        provider: 'RIOT',
        externalMatchIds: ['ok', 'bad', 'skip'],
        timeoutMs: 1_000,
        pollIntervalMs: 100,
      },
    );

    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.pending).toBe(0);
    expect(summary.timedOut).toBe(false);
  });

  it('times out while jobs remain pending without unbounded polling', async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const findMatches = vi.fn(async () => [
      { externalMatchId: 'm1', ingestionStatus: 'PENDING' },
    ]);

    const summary = await waitForMatchIngestion(
      {
        findMatchesByExternalIds: findMatches,
        findDurableJobsByExternalIds: vi.fn(async () => []),
        sleep,
        now: () => now,
      },
      {
        provider: 'RIOT',
        externalMatchIds: ['m1'],
        timeoutMs: 250,
        pollIntervalMs: 100,
      },
    );

    expect(summary.pending).toBe(1);
    expect(summary.timedOut).toBe(true);
    expect(findMatches.mock.calls.length).toBeGreaterThan(1);
    expect(findMatches.mock.calls.length).toBeLessThan(10);
    expect(sleep.mock.calls.length).toBeLessThan(10);
  });

  it('treats durable COMPLETED/FAILED as terminal when Match is missing', async () => {
    const summary = await waitForMatchIngestion(
      {
        findMatchesByExternalIds: vi.fn(async () => []),
        findDurableJobsByExternalIds: vi.fn(async () => [
          { externalResourceId: 'm1', status: 'COMPLETED' },
          { externalResourceId: 'm2', status: 'FAILED' },
        ]),
        sleep: vi.fn(),
        now: () => 0,
      },
      {
        provider: 'RIOT',
        externalMatchIds: ['m1', 'm2'],
        timeoutMs: 1_000,
        pollIntervalMs: 100,
      },
    );

    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(0);
    expect(summary.timedOut).toBe(false);
  });
});

describe('checkAggregateSmoke', () => {
  it('passes for a known-position row with sampleSize > 0', async () => {
    const findFirst = vi.fn(async () => ({
      championId: 103,
      teamPosition: 'MIDDLE',
      sampleSize: 4,
      queueId: 420,
    }));

    const result = await checkAggregateSmoke({ championAggregate: { findFirst } } as never);

    expect(result.ok).toBe(true);
    expect(result.row).toEqual({
      championId: 103,
      teamPosition: 'MIDDLE',
      sampleSize: 4,
      queueId: 420,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queueId: 420,
          sampleSize: { gt: 0 },
          teamPosition: {
            notIn: [ALL_POSITION_SENTINEL, UNKNOWN_POSITION_SENTINEL, ''],
          },
        }),
      }),
    );
  });

  it('fails when no qualifying row exists', async () => {
    const result = await checkAggregateSmoke({
      championAggregate: { findFirst: vi.fn(async () => null) },
    } as never);
    expect(result.ok).toBe(false);
    expect(result.row).toBeUndefined();
  });
});

describe('resolveAggregateSmokeForRun', () => {
  const passed = {
    ok: true,
    row: { championId: 1, teamPosition: 'TOP', sampleSize: 2, queueId: 420 },
  };
  const failedLookup = { ok: false as const };

  it('skips smoke on dry-run', () => {
    const resolved = resolveAggregateSmokeForRun({
      dryRun: true,
      waitEnabled: false,
      waitSummary: undefined,
      smokeLookup: passed,
    });
    expect(resolved.status).toBe('skipped');
    expect(resolved.ok).toBe(true);
  });

  it('reports pending when apply ran without --wait', () => {
    const resolved = resolveAggregateSmokeForRun({
      dryRun: false,
      waitEnabled: false,
      waitSummary: undefined,
      smokeLookup: failedLookup,
    });
    expect(resolved.status).toBe('pending');
    expect(resolved.ok).toBe(true);
    expect(resolved.message).toMatch(/not yet|pending/i);
  });

  it('is inconclusive when wait timed out with pending jobs', () => {
    const resolved = resolveAggregateSmokeForRun({
      dryRun: false,
      waitEnabled: true,
      waitSummary: {
        completed: 0,
        failed: 0,
        skipped: 0,
        pending: 3,
        timedOut: true,
        checkedMatchCount: 3,
      },
      smokeLookup: failedLookup,
    });
    expect(resolved.status).toBe('inconclusive');
    expect(resolved.ok).toBe(true);
    expect(resolved.message).toMatch(/timed out|pending/i);
  });

  it('fails when wait completed and no valid aggregate row exists', () => {
    const resolved = resolveAggregateSmokeForRun({
      dryRun: false,
      waitEnabled: true,
      waitSummary: {
        completed: 2,
        failed: 0,
        skipped: 0,
        pending: 0,
        timedOut: false,
        checkedMatchCount: 2,
      },
      smokeLookup: failedLookup,
    });
    expect(resolved.status).toBe('failed');
    expect(resolved.ok).toBe(false);
    expect(resolved.message).toMatch(/ChampionAggregate|reconcile/i);
  });

  it('passes when wait completed and a valid row exists', () => {
    const resolved = resolveAggregateSmokeForRun({
      dryRun: false,
      waitEnabled: true,
      waitSummary: {
        completed: 2,
        failed: 0,
        skipped: 0,
        pending: 0,
        timedOut: false,
        checkedMatchCount: 2,
      },
      smokeLookup: passed,
    });
    expect(resolved.status).toBe('passed');
    expect(resolved.ok).toBe(true);
    expect(resolved.row?.teamPosition).toBe('TOP');
  });
});
