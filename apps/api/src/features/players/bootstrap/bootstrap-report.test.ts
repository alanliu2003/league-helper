import { describe, expect, it } from 'vitest';
import {
  finalizeBootstrapReport,
  formatBootstrapTextReport,
  resolveBootstrapExitCode,
  type BootstrapCliReport,
} from './bootstrap-report';
import { assertNoSensitiveOutput, collectStdoutJson } from './cli-output';
import type { BootstrapRunResult } from './bootstrap-player.types';

function baseRun(overrides: Partial<BootstrapRunResult> = {}): BootstrapRunResult {
  return {
    ok: true,
    dryRun: false,
    players: [
      {
        ok: true,
        gameName: 'PlayerOne',
        tagLine: 'NA1',
        platform: 'na1',
        dryRun: false,
        discoveredMatchCount: 2,
        enqueuedCount: 2,
        skippedAlreadyCompleteCount: 0,
        externalMatchIds: ['NA1_1', 'NA1_2'],
      },
    ],
    totals: {
      players: 1,
      playersFailed: 0,
      discoveredMatchCount: 2,
      enqueuedCount: 2,
    },
    ...overrides,
  };
}

describe('resolveBootstrapExitCode', () => {
  it('exits 0 when players succeed and smoke is pending/inconclusive', () => {
    const pending = finalizeBootstrapReport({
      run: baseRun(),
      aggregateSmoke: { status: 'pending', ok: true, message: 'pending' },
    });
    expect(resolveBootstrapExitCode(pending)).toBe(0);

    const inconclusive = finalizeBootstrapReport({
      run: baseRun(),
      waitSummary: {
        completed: 0,
        failed: 0,
        skipped: 0,
        pending: 2,
        timedOut: true,
        checkedMatchCount: 2,
      },
      aggregateSmoke: { status: 'inconclusive', ok: true, message: 'timed out' },
    });
    expect(resolveBootstrapExitCode(inconclusive)).toBe(0);
  });

  it('exits 1 on player failure or definitive smoke failure', () => {
    const playerFail = finalizeBootstrapReport({
      run: baseRun({
        ok: false,
        totals: { players: 1, playersFailed: 1, discoveredMatchCount: 0, enqueuedCount: 0 },
        players: [
          {
            ok: false,
            gameName: 'X',
            tagLine: 'NA1',
            platform: 'na1',
            dryRun: true,
            discoveredMatchCount: 0,
            enqueuedCount: 0,
            skippedAlreadyCompleteCount: 0,
            externalMatchIds: [],
            error: 'not found',
          },
        ],
      }),
    });
    expect(resolveBootstrapExitCode(playerFail)).toBe(1);

    const smokeFail = finalizeBootstrapReport({
      run: baseRun(),
      waitSummary: {
        completed: 2,
        failed: 0,
        skipped: 0,
        pending: 0,
        timedOut: false,
        checkedMatchCount: 2,
      },
      aggregateSmoke: { status: 'failed', ok: false, message: 'no row' },
    });
    expect(resolveBootstrapExitCode(smokeFail)).toBe(1);
  });

  it('exits 1 when wait finished with ingestion failures (not timeout)', () => {
    const report = finalizeBootstrapReport({
      run: baseRun(),
      waitSummary: {
        completed: 1,
        failed: 1,
        skipped: 0,
        pending: 0,
        timedOut: false,
        checkedMatchCount: 2,
      },
      aggregateSmoke: { status: 'passed', ok: true, row: {
        championId: 1,
        teamPosition: 'TOP',
        sampleSize: 1,
        queueId: 420,
      } },
    });
    expect(report.ok).toBe(false);
    expect(resolveBootstrapExitCode(report)).toBe(1);
  });
});

describe('formatBootstrapTextReport', () => {
  it('labels dry-run would-enqueue as an estimate', () => {
    const report: BootstrapCliReport = {
      ok: true,
      dryRun: true,
      players: [
        {
          ok: true,
          gameName: 'A',
          tagLine: 'NA1',
          platform: 'na1',
          dryRun: true,
          discoveredMatchCount: 5,
          wouldEnqueueCount: 5,
          enqueuedCount: 0,
          skippedAlreadyCompleteCount: 0,
          externalMatchIds: ['a', 'b', 'c', 'd', 'e'],
        },
      ],
      totals: {
        players: 1,
        playersFailed: 0,
        discoveredMatchCount: 5,
        enqueuedCount: 0,
      },
      aggregateSmoke: { status: 'skipped', ok: true, message: 'dry-run' },
    };

    const text = formatBootstrapTextReport(report).join('\n');
    expect(text).toMatch(/wouldEnqueueEstimate=5/);
    expect(text).not.toMatch(/\benqueued=5\b/);
    assertNoSensitiveOutput(text);
  });

  it('JSON stdout payload rejects unsafe fields', () => {
    const report = finalizeBootstrapReport({
      run: baseRun(),
      aggregateSmoke: {
        status: 'passed',
        ok: true,
        row: { championId: 103, teamPosition: 'MIDDLE', sampleSize: 2, queueId: 420 },
      },
    });
    const json = collectStdoutJson(report);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toMatch(/puuid/i);
    expect(json).not.toMatch(/RIOT_API_KEY/i);
    expect(json).not.toMatch(/rawPayload/i);
  });
});
