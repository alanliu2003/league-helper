import { z } from 'zod';
import { parsePlatformRoute, ValidationFailureError } from '@league-helper/shared';
import {
  loadMatchBootstrapConfig,
  type MatchBootstrapConfig,
} from './bootstrap-player.config';
import type { BootstrapCliArgs, BootstrapPlayerTarget } from './bootstrap-player.types';

export const BootstrapPlayerTargetSchema = z.object({
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
  platform: z
    .string()
    .min(1)
    .transform((value) => parsePlatformRoute(value)),
});

export const BootstrapPlayersFileSchema = z.array(BootstrapPlayerTargetSchema).min(1);

export type { BootstrapCliArgs, BootstrapPlayerTarget };

/**
 * Zod-validate a players.json payload and enforce fileMaxPlayers before Riot calls.
 */
export function parseBootstrapPlayersFile(
  raw: unknown,
  config: MatchBootstrapConfig = loadMatchBootstrapConfig({}),
): BootstrapPlayerTarget[] {
  const parsed = BootstrapPlayersFileSchema.parse(raw);
  if (parsed.length > config.fileMaxPlayers) {
    throw new ValidationFailureError(
      `Too many players: ${parsed.length} exceeds fileMaxPlayers (${config.fileMaxPlayers}).`,
      { received: String(parsed.length) },
    );
  }
  return parsed.map((player) => ({
    gameName: player.gameName,
    tagLine: player.tagLine,
    platform: player.platform,
  }));
}

const KNOWN_FLAGS = new Set([
  '--game-name',
  '--tag-line',
  '--platform',
  '--file',
  '--queue',
  '--max-matches',
  '--dry-run',
  '--json',
  '--wait',
  '--concurrency',
]);

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new ValidationFailureError(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveIntFlag(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number; name: string },
): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new ValidationFailureError(
      `${bounds.name} must be an integer between ${bounds.min} and ${bounds.max}.`,
      { received: raw },
    );
  }
  return value;
}

/**
 * Parse `matches:bootstrap-player` CLI argv.
 * Defaults come from MatchBootstrapConfig (empty env → ops defaults).
 */
export function parseBootstrapArgs(
  argv: string[],
  config: MatchBootstrapConfig = loadMatchBootstrapConfig({}),
): BootstrapCliArgs {
  const unknownFlags = argv.filter((arg) => arg.startsWith('-') && !KNOWN_FLAGS.has(arg));
  if (unknownFlags.length > 0) {
    throw new ValidationFailureError(`Unknown argument(s): ${unknownFlags.join(', ')}`);
  }

  const filePath = readFlagValue(argv, '--file');
  const gameName = readFlagValue(argv, '--game-name');
  const tagLine = readFlagValue(argv, '--tag-line');
  const platformRaw = readFlagValue(argv, '--platform');

  const hasSingleIdentity =
    gameName !== undefined || tagLine !== undefined || platformRaw !== undefined;

  if (filePath !== undefined && hasSingleIdentity) {
    throw new ValidationFailureError(
      '`--file` and `--game-name`/`--tag-line`/`--platform` are mutually exclusive; use either file mode or single-player mode.',
    );
  }

  if (filePath === undefined && !hasSingleIdentity) {
    throw new ValidationFailureError(
      'Provide either `--file <path>` or `--game-name`, `--tag-line`, and `--platform`.',
    );
  }

  let mode: BootstrapCliArgs['mode'];
  let players: BootstrapPlayerTarget[] = [];
  let resolvedFilePath: string | undefined;

  if (filePath !== undefined) {
    mode = 'file';
    resolvedFilePath = filePath;
  } else {
    if (!gameName || !tagLine || !platformRaw) {
      throw new ValidationFailureError(
        'Single-player mode requires `--game-name`, `--tag-line`, and `--platform`.',
      );
    }
    const platform = parsePlatformRoute(platformRaw);
    mode = 'single';
    players = [{ gameName, tagLine, platform }];
  }

  return {
    mode,
    players,
    filePath: resolvedFilePath,
    queueId: parsePositiveIntFlag(readFlagValue(argv, '--queue'), config.defaultQueueId, {
      min: 0,
      max: 1_000_000,
      name: '--queue',
    }),
    maxMatches: parsePositiveIntFlag(
      readFlagValue(argv, '--max-matches'),
      config.defaultMaxMatches,
      {
        min: 1,
        max: config.hardMaxMatches,
        name: '--max-matches',
      },
    ),
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    wait: argv.includes('--wait'),
    concurrency: parsePositiveIntFlag(readFlagValue(argv, '--concurrency'), 1, {
      min: 1,
      max: config.maxConcurrency,
      name: '--concurrency',
    }),
  };
}
