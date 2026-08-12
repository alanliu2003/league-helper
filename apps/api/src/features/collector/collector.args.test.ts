import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import {
  parseCollectorCoverageArgs,
  parseCollectorLadderSeedArgs,
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

  describe('parseCollectorLadderSeedArgs', () => {
    it('parses apex dry-run with default tiers', () => {
      const args = parseCollectorLadderSeedArgs(
        ['--platform', 'na1', '--mode', 'apex', '--dry-run'],
        config(),
      );
      expect(args).toMatchObject({
        help: false,
        platform: 'na1',
        mode: 'apex',
        tiers: ['CHALLENGER', 'GRANDMASTER'],
        dryRun: true,
        json: false,
      });
    });

    it('allows explicit MASTER in apex --tiers', () => {
      const args = parseCollectorLadderSeedArgs(
        ['--platform', 'na1', '--tiers', 'CHALLENGER,MASTER'],
        config(),
      );
      expect(args.tiers).toEqual(['CHALLENGER', 'MASTER']);
    });

    it('rejects MASTER when only present in config defaults (must be explicit --tiers)', () => {
      expect(() =>
        parseCollectorLadderSeedArgs(['--platform', 'na1', '--mode', 'apex', '--dry-run'], {
          ...config(),
          ladderTiers: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
        }),
      ).toThrow(/MASTER must be explicitly listed in --tiers/);
    });

    it('parses representative page selection', () => {
      const args = parseCollectorLadderSeedArgs(
        [
          '--platform',
          'na1',
          '--mode',
          'representative',
          '--tiers',
          'DIAMOND,EMERALD',
          '--division',
          'I',
          '--page',
          '1',
          '--dry-run',
        ],
        config(),
      );
      expect(args).toMatchObject({
        mode: 'representative',
        tiers: ['DIAMOND', 'EMERALD'],
        division: 'I',
        page: 1,
        dryRun: true,
      });
    });

    it('defaults division to I for max-pages mode', () => {
      const args = parseCollectorLadderSeedArgs(
        [
          '--platform',
          'na1',
          '--mode',
          'representative',
          '--tiers',
          'DIAMOND',
          '--max-pages-per-division',
          '1',
        ],
        config(),
      );
      expect(args.division).toBe('I');
      expect(args.maxPagesPerDivision).toBe(1);
    });

    it('rejects representative mode without page bounds', () => {
      expect(() =>
        parseCollectorLadderSeedArgs(
          ['--platform', 'na1', '--mode', 'representative', '--tiers', 'DIAMOND'],
          config(),
        ),
      ).toThrow(ValidationFailureError);
    });

    it('accepts low-tier representative tiers (Silver/Bronze/Iron)', () => {
      const args = parseCollectorLadderSeedArgs(
        [
          '--platform',
          'na1',
          '--mode',
          'representative',
          '--tiers',
          'SILVER',
          '--division',
          'II',
          '--page',
          '1',
        ],
        config(),
      );
      expect(args.tiers).toEqual(['SILVER']);
      expect(args.division).toBe('II');
    });

    it('rejects apex tiers in representative mode', () => {
      expect(() =>
        parseCollectorLadderSeedArgs(
          [
            '--platform',
            'na1',
            '--mode',
            'representative',
            '--tiers',
            'CHALLENGER',
            '--max-pages-per-division',
            '1',
          ],
          config(),
        ),
      ).toThrow(ValidationFailureError);
    });
  });

  describe('parseCollectorCoverageArgs', () => {
    it('parses platform queue and json flags', () => {
      const args = parseCollectorCoverageArgs(
        ['--platform', 'na1', '--queue', '420', '--json'],
        config({ platformAllowlist: ['na1'] }),
      );
      expect(args).toEqual({
        help: false,
        platformFilter: 'na1',
        queueId: 420,
        json: true,
      });
    });

    it('defaults queue to 420 and supports help', () => {
      expect(parseCollectorCoverageArgs(['--help'], config())).toMatchObject({
        help: true,
        queueId: 420,
      });
      expect(parseCollectorCoverageArgs([], config())).toMatchObject({
        help: false,
        queueId: 420,
        json: false,
      });
    });

    it('rejects platforms outside allowlist', () => {
      expect(() =>
        parseCollectorCoverageArgs(['--platform', 'kr'], config({ platformAllowlist: ['na1'] })),
      ).toThrow(ValidationFailureError);
    });

    it('rejects unknown flags', () => {
      expect(() => parseCollectorCoverageArgs(['--enqueue'], config())).toThrow(
        ValidationFailureError,
      );
    });
  });
});
