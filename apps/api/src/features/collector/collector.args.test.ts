import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import {
  parseCollectorRunArgs,
  parseCollectorSeedArgs,
  parseCollectorSeedPlayersFile,
  parseCollectorSetStatusArgs,
  SEED_FILE_MAX_PLAYERS,
} from './collector.args';
import type { CollectorConfig } from './collector.config';

function config(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    batchSize: 10,
    concurrency: 2,
    matchesPerPlayer: 20,
    maxMatchIdsPerRun: 200,
    maxEnqueuePerRun: 200,
    minRefreshIntervalMs: 6 * 60 * 60_000,
    baseBackoffMs: 15 * 60_000,
    maxBackoffMs: 24 * 60 * 60_000,
    maxBackoffExponent: 8,
    playerTimeoutMs: 10 * 60_000,
    leaseDurationMs: 15 * 60_000,
    staleRunAfterMs: 2 * 60 * 60_000,
    platformAllowlist: ['na1'],
    estimatedRequestsPerEnqueuedMatch: 2,
    priorityMin: 0,
    priorityMax: 1000,
    enrollFromBootstrap: false,
    enrollFromSearch: false,
    ...overrides,
  };
}

describe('collector.args', () => {
  describe('parseCollectorSeedPlayersFile', () => {
    it('validates full file before returning players', () => {
      const players = parseCollectorSeedPlayersFile([
        { gameName: 'A', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'B', tagLine: 'NA1', platform: 'NA1', priority: 3 },
      ]);
      expect(players).toHaveLength(2);
      expect(players[1]?.platform).toBe('na1');
    });

    it('rejects oversized files', () => {
      const raw = Array.from({ length: SEED_FILE_MAX_PLAYERS + 1 }, (_, i) => ({
        gameName: `P${i}`,
        tagLine: 'NA1',
        platform: 'na1',
      }));
      expect(() => parseCollectorSeedPlayersFile(raw)).toThrow(ValidationFailureError);
    });

    it('rejects invalid platform entries before any Riot call site', () => {
      expect(() =>
        parseCollectorSeedPlayersFile([{ gameName: 'A', tagLine: 'NA1', platform: 'nope' }]),
      ).toThrow();
    });
  });

  describe('parseCollectorSeedArgs', () => {
    it('parses single XOR file modes', () => {
      const single = parseCollectorSeedArgs(
        ['--game-name', 'A', '--tag-line', 'NA1', '--platform', 'na1', '--reactivate'],
        config(),
      );
      expect(single.mode).toBe('single');
      expect(single.reactivate).toBe(true);
      expect(single.players[0]?.gameName).toBe('A');

      const file = parseCollectorSeedArgs(['--file', 'players.json'], config());
      expect(file.mode).toBe('file');
      expect(file.filePath).toBe('players.json');
    });

    it('rejects mixed single and file identity', () => {
      expect(() =>
        parseCollectorSeedArgs(
          ['--file', 'x.json', '--game-name', 'A', '--tag-line', 'NA1', '--platform', 'na1'],
          config(),
        ),
      ).toThrow(ValidationFailureError);
    });
  });

  describe('parseCollectorSetStatusArgs', () => {
    it('requires tracked-player-id and status', () => {
      expect(() => parseCollectorSetStatusArgs([])).toThrow(ValidationFailureError);
      expect(() => parseCollectorSetStatusArgs(['--tracked-player-id', 'tp-1'])).toThrow(
        ValidationFailureError,
      );
      const args = parseCollectorSetStatusArgs([
        '--tracked-player-id',
        'tp-1',
        '--status',
        'PAUSED',
        '--force',
      ]);
      expect(args).toEqual({
        trackedPlayerId: 'tp-1',
        status: 'PAUSED',
        force: true,
        resetFailures: false,
        json: false,
      });
    });
  });

  describe('parseCollectorRunArgs', () => {
    it('parses dry-run and sample-discovery', () => {
      const args = parseCollectorRunArgs(
        ['--dry-run', '--sample-discovery', '2', '--platform', 'na1'],
        config(),
      );
      expect(args.dryRun).toBe(true);
      expect(args.sampleDiscovery).toBe(2);
      expect(args.platformFilter).toBe('na1');
    });

    it('rejects sample-discovery without dry-run', () => {
      expect(() => parseCollectorRunArgs(['--sample-discovery', '1'], config())).toThrow(
        ValidationFailureError,
      );
    });

    it('rejects platform outside allowlist', () => {
      expect(() => parseCollectorRunArgs(['--platform', 'euw1'], config())).toThrow(
        ValidationFailureError,
      );
    });
  });
});
