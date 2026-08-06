import { describe, expect, it } from 'vitest';
import {
  parseBootstrapArgs,
  parseBootstrapPlayersFile,
  BootstrapPlayersFileSchema,
} from './bootstrap-player.args';
import { loadMatchBootstrapConfig } from './bootstrap-player.config';

describe('parseBootstrapArgs', () => {
  it('parses single-player mode with defaults', () => {
    const args = parseBootstrapArgs([
      '--game-name',
      'A',
      '--tag-line',
      'NA1',
      '--platform',
      'na1',
    ]);
    expect(args.mode).toBe('single');
    expect(args.queueId).toBe(420);
    expect(args.maxMatches).toBe(100);
    expect(args.dryRun).toBe(false);
    expect(args.concurrency).toBe(1);
  });

  it('rejects mixing --file with --game-name', () => {
    expect(() =>
      parseBootstrapArgs([
        '--file',
        'p.json',
        '--game-name',
        'A',
        '--tag-line',
        'NA1',
        '--platform',
        'na1',
      ]),
    ).toThrow(/mutually exclusive|either/i);
  });

  it('parses --file mode', () => {
    const args = parseBootstrapArgs(['--file', 'players.json', '--dry-run']);
    expect(args.mode).toBe('file');
    expect(args.filePath).toBe('players.json');
    expect(args.dryRun).toBe(true);
  });

  it('validates players.json schema', () => {
    const parsed = BootstrapPlayersFileSchema.parse([
      { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it('rejects oversized players.json before processing', () => {
    const config = loadMatchBootstrapConfig({ MATCH_BOOTSTRAP_FILE_MAX_PLAYERS: '2' });
    expect(() =>
      parseBootstrapPlayersFile(
        [
          { gameName: 'A', tagLine: 'NA1', platform: 'na1' },
          { gameName: 'B', tagLine: 'NA1', platform: 'na1' },
          { gameName: 'C', tagLine: 'NA1', platform: 'na1' },
        ],
        config,
      ),
    ).toThrow(/fileMaxPlayers|too many/i);
  });
});
