import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import {
  parseCollectorRunArgs,
  parseCollectorSchedulerArgs,
  parseCollectorSchedulerStatusArgs,
  parseCollectorSchedulerTriggerArgs,
  parseCollectorSeedArgs,
  parseCollectorSeedPlayersFile,
  parseCollectorSetStatusArgs,
  SEED_FILE_MAX_PLAYERS,
} from './collector.args';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';

function config(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return { ...loadCollectorConfig({}), ...overrides };
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

  describe('parseCollectorSchedulerArgs', () => {
    it('parses empty argv and --help', () => {
      expect(parseCollectorSchedulerArgs([])).toEqual({ help: false });
      expect(parseCollectorSchedulerArgs(['--help'])).toEqual({ help: true });
    });

    it('rejects unknown flags', () => {
      expect(() => parseCollectorSchedulerArgs(['--json'])).toThrow(ValidationFailureError);
    });
  });

  describe('parseCollectorSchedulerTriggerArgs', () => {
    it('parses --json and --help', () => {
      expect(parseCollectorSchedulerTriggerArgs([])).toEqual({ help: false, json: false });
      expect(parseCollectorSchedulerTriggerArgs(['--json'])).toEqual({
        help: false,
        json: true,
      });
      expect(parseCollectorSchedulerTriggerArgs(['--help', '--json'])).toEqual({
        help: true,
        json: true,
      });
    });

    it('rejects unknown flags', () => {
      expect(() => parseCollectorSchedulerTriggerArgs(['--platform', 'na1'])).toThrow(
        ValidationFailureError,
      );
    });
  });

  describe('parseCollectorSchedulerStatusArgs', () => {
    it('parses --json and --help', () => {
      expect(parseCollectorSchedulerStatusArgs([])).toEqual({ help: false, json: false });
      expect(parseCollectorSchedulerStatusArgs(['--json'])).toEqual({
        help: false,
        json: true,
      });
      expect(parseCollectorSchedulerStatusArgs(['--help'])).toEqual({
        help: true,
        json: false,
      });
    });

    it('rejects unknown flags', () => {
      expect(() => parseCollectorSchedulerStatusArgs(['--queue', '420'])).toThrow(
        ValidationFailureError,
      );
    });
  });
});
