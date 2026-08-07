import { z } from 'zod';
import { parsePlatformRoute, ValidationFailureError } from '@league-helper/shared';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import type {
  CollectorAuditCliArgs,
  CollectorRunCliArgs,
  CollectorSeedCliArgs,
  CollectorSeedPlayerTarget,
  CollectorSetStatusCliArgs,
  CollectorStatusCliArgs,
} from './collector.types';

export const SEED_FILE_MAX_PLAYERS = 25;

export const CollectorSeedPlayerTargetSchema = z.object({
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
  platform: z
    .string()
    .min(1)
    .transform((value) => parsePlatformRoute(value)),
  priority: z.number().int().optional(),
});

export const CollectorSeedPlayersFileSchema = z.array(CollectorSeedPlayerTargetSchema).min(1);

const SEED_KNOWN_FLAGS = new Set([
  '--game-name',
  '--tag-line',
  '--platform',
  '--file',
  '--priority',
  '--concurrency',
  '--reactivate',
  '--json',
]);

const SET_STATUS_KNOWN_FLAGS = new Set([
  '--tracked-player-id',
  '--status',
  '--force',
  '--reset-failures',
  '--json',
]);

const RUN_KNOWN_FLAGS = new Set([
  '--dry-run',
  '--sample-discovery',
  '--platform',
  '--queue',
  '--batch-size',
  '--concurrency',
  '--max-matches',
  '--max-match-ids',
  '--max-enqueue',
  '--json',
]);

const STATUS_KNOWN_FLAGS = new Set(['--platform', '--queue', '--json', '--help']);

const AUDIT_KNOWN_FLAGS = new Set(['--json', '--help']);

const STATUS_VALUES = new Set(['ACTIVE', 'PAUSED', 'SUSPENDED']);

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

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
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

function assertKnownFlags(argv: string[], known: Set<string>): void {
  const unknownFlags = argv.filter((arg) => arg.startsWith('-') && !known.has(arg));
  if (unknownFlags.length > 0) {
    throw new ValidationFailureError(`Unknown argument(s): ${unknownFlags.join(', ')}`);
  }
}

/**
 * Fully Zod-validate a seed players file before any Riot calls.
 */
export function parseCollectorSeedPlayersFile(
  raw: unknown,
  maxPlayers: number = SEED_FILE_MAX_PLAYERS,
): CollectorSeedPlayerTarget[] {
  const parsed = CollectorSeedPlayersFileSchema.parse(raw);
  if (parsed.length > maxPlayers) {
    throw new ValidationFailureError(
      `Too many players: ${parsed.length} exceeds seed file max (${maxPlayers}).`,
      { received: String(parsed.length) },
    );
  }
  return parsed.map((player) => ({
    gameName: player.gameName,
    tagLine: player.tagLine,
    platform: player.platform,
    ...(player.priority !== undefined ? { priority: player.priority } : {}),
  }));
}

export function parseCollectorSeedArgs(
  argv: string[],
  config: CollectorConfig = loadCollectorConfig({}),
): CollectorSeedCliArgs {
  assertKnownFlags(argv, SEED_KNOWN_FLAGS);

  const filePath = readFlagValue(argv, '--file');
  const gameName = readFlagValue(argv, '--game-name');
  const tagLine = readFlagValue(argv, '--tag-line');
  const platformRaw = readFlagValue(argv, '--platform');
  const priorityRaw = readFlagValue(argv, '--priority');

  const hasSingleIdentity =
    gameName !== undefined || tagLine !== undefined || platformRaw !== undefined;

  if (filePath !== undefined && hasSingleIdentity) {
    throw new ValidationFailureError(
      '`--file` and `--game-name`/`--tag-line`/`--platform` are mutually exclusive.',
    );
  }

  if (filePath === undefined && !hasSingleIdentity) {
    throw new ValidationFailureError(
      'Provide either `--file <path>` or `--game-name`, `--tag-line`, and `--platform`.',
    );
  }

  let mode: CollectorSeedCliArgs['mode'];
  let players: CollectorSeedPlayerTarget[] = [];
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
    let priority: number | undefined;
    if (priorityRaw !== undefined) {
      const value = Number(priorityRaw);
      if (!Number.isInteger(value)) {
        throw new ValidationFailureError('--priority must be an integer.', {
          received: priorityRaw,
        });
      }
      priority = value;
    }
    mode = 'single';
    players = [
      {
        gameName,
        tagLine,
        platform,
        ...(priority !== undefined ? { priority } : {}),
      },
    ];
  }

  return {
    mode,
    players,
    filePath: resolvedFilePath,
    concurrency: parsePositiveIntFlag(readFlagValue(argv, '--concurrency'), 1, {
      min: 1,
      max: Math.min(config.concurrency, 5),
      name: '--concurrency',
    }),
    reactivate: hasFlag(argv, '--reactivate'),
    json: hasFlag(argv, '--json'),
  };
}

export function parseCollectorSetStatusArgs(argv: string[]): CollectorSetStatusCliArgs {
  assertKnownFlags(argv, SET_STATUS_KNOWN_FLAGS);

  const trackedPlayerId = readFlagValue(argv, '--tracked-player-id');
  const statusRaw = readFlagValue(argv, '--status');

  if (!trackedPlayerId) {
    throw new ValidationFailureError('--tracked-player-id is required.');
  }
  if (!statusRaw) {
    throw new ValidationFailureError('--status is required (ACTIVE|PAUSED|SUSPENDED).');
  }
  if (!STATUS_VALUES.has(statusRaw)) {
    throw new ValidationFailureError(
      '--status must be one of ACTIVE, PAUSED, SUSPENDED.',
      { received: statusRaw },
    );
  }

  return {
    trackedPlayerId,
    status: statusRaw as CollectorSetStatusCliArgs['status'],
    force: hasFlag(argv, '--force'),
    resetFailures: hasFlag(argv, '--reset-failures'),
    json: hasFlag(argv, '--json'),
  };
}

export function parseCollectorRunArgs(
  argv: string[],
  config: CollectorConfig = loadCollectorConfig({}),
): CollectorRunCliArgs {
  assertKnownFlags(argv, RUN_KNOWN_FLAGS);

  const platformRaw = readFlagValue(argv, '--platform');
  let platformFilter: string | undefined;
  if (platformRaw !== undefined) {
    platformFilter = parsePlatformRoute(platformRaw);
    if (!config.platformAllowlist.includes(platformFilter)) {
      throw new ValidationFailureError(
        `--platform ${platformFilter} is outside COLLECTOR_PLATFORM_ALLOWLIST.`,
        { received: platformRaw },
      );
    }
  }

  const sampleRaw = readFlagValue(argv, '--sample-discovery');
  let sampleDiscovery: number | undefined;
  if (sampleRaw !== undefined) {
    sampleDiscovery = parsePositiveIntFlag(sampleRaw, 1, {
      min: 1,
      max: 50,
      name: '--sample-discovery',
    });
  }

  const dryRun = hasFlag(argv, '--dry-run');
  if (sampleDiscovery !== undefined && !dryRun) {
    throw new ValidationFailureError('--sample-discovery requires --dry-run.');
  }

  return {
    dryRun,
    ...(sampleDiscovery !== undefined ? { sampleDiscovery } : {}),
    ...(platformFilter !== undefined ? { platformFilter } : {}),
    queueId: parsePositiveIntFlag(readFlagValue(argv, '--queue'), 420, {
      min: 0,
      max: 1_000_000,
      name: '--queue',
    }),
    batchSize: parsePositiveIntFlag(readFlagValue(argv, '--batch-size'), config.batchSize, {
      min: 1,
      max: 50,
      name: '--batch-size',
    }),
    concurrency: parsePositiveIntFlag(
      readFlagValue(argv, '--concurrency'),
      config.concurrency,
      {
        min: 1,
        max: 5,
        name: '--concurrency',
      },
    ),
    maxMatches: parsePositiveIntFlag(
      readFlagValue(argv, '--max-matches'),
      config.matchesPerPlayer,
      {
        min: 1,
        max: 100,
        name: '--max-matches',
      },
    ),
    maxMatchIds: parsePositiveIntFlag(
      readFlagValue(argv, '--max-match-ids'),
      config.maxMatchIdsPerRun,
      {
        min: 1,
        max: 1000,
        name: '--max-match-ids',
      },
    ),
    maxEnqueue: parsePositiveIntFlag(
      readFlagValue(argv, '--max-enqueue'),
      config.maxEnqueuePerRun,
      {
        min: 1,
        max: 1000,
        name: '--max-enqueue',
      },
    ),
    json: hasFlag(argv, '--json'),
  };
}

export function parseCollectorStatusArgs(
  argv: string[],
  config: CollectorConfig = loadCollectorConfig({}),
): CollectorStatusCliArgs {
  if (hasFlag(argv, '--help')) {
    return {
      help: true,
      queueId: 420,
      json: hasFlag(argv, '--json'),
    };
  }

  assertKnownFlags(argv, STATUS_KNOWN_FLAGS);

  const platformRaw = readFlagValue(argv, '--platform');
  let platformFilter: string | undefined;
  if (platformRaw !== undefined) {
    platformFilter = parsePlatformRoute(platformRaw);
    if (!config.platformAllowlist.includes(platformFilter)) {
      throw new ValidationFailureError(
        `--platform ${platformFilter} is outside COLLECTOR_PLATFORM_ALLOWLIST.`,
        { received: platformRaw },
      );
    }
  }

  return {
    help: false,
    ...(platformFilter !== undefined ? { platformFilter } : {}),
    queueId: parsePositiveIntFlag(readFlagValue(argv, '--queue'), 420, {
      min: 0,
      max: 1_000_000,
      name: '--queue',
    }),
    json: hasFlag(argv, '--json'),
  };
}

export function parseCollectorAuditArgs(argv: string[]): CollectorAuditCliArgs {
  if (hasFlag(argv, '--help')) {
    return {
      help: true,
      json: hasFlag(argv, '--json'),
    };
  }

  assertKnownFlags(argv, AUDIT_KNOWN_FLAGS);

  return {
    help: false,
    json: hasFlag(argv, '--json'),
  };
}
