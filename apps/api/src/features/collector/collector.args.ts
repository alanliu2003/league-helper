import { z } from 'zod';
import {
  RankDivisionSchema,
  RankTierSchema,
  parsePlatformRoute,
  ValidationFailureError,
  type RankTier,
} from '@league-helper/shared';
import {
  LADDER_APEX_TIERS_ALLOWLIST,
  LADDER_REPRESENTATIVE_TIERS_ALLOWLIST,
  loadCollectorConfig,
  type CollectorConfig,
} from './collector.config';
import type {
  CollectorAuditCliArgs,
  CollectorCoverageCliArgs,
  CollectorLadderSeedCliArgs,
  CollectorRunCliArgs,
  CollectorSchedulerCliArgs,
  CollectorSchedulerStatusCliArgs,
  CollectorSchedulerTriggerCliArgs,
  CollectorSeedCliArgs,
  CollectorSeedPlayerTarget,
  CollectorSetStatusCliArgs,
  CollectorStatusCliArgs,
} from './collector.types';

/** Apex CLI tiers: shared Apex segment (Challenger / Grandmaster / Master). */
const LADDER_SEED_APEX_TIERS = LADDER_APEX_TIERS_ALLOWLIST;

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

const COVERAGE_KNOWN_FLAGS = new Set(['--platform', '--queue', '--json', '--help']);

const AUDIT_KNOWN_FLAGS = new Set(['--json', '--help']);

const SCHEDULER_KNOWN_FLAGS = new Set(['--help']);

const SCHEDULER_TRIGGER_KNOWN_FLAGS = new Set(['--json', '--help']);

const SCHEDULER_STATUS_KNOWN_FLAGS = new Set(['--json', '--help']);

const LADDER_SEED_KNOWN_FLAGS = new Set([
  '--platform',
  '--mode',
  '--tiers',
  '--division',
  '--page',
  '--max-pages-per-division',
  '--dry-run',
  '--json',
  '--help',
]);

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

export function parseCollectorCoverageArgs(
  argv: string[],
  config: CollectorConfig = loadCollectorConfig({}),
): CollectorCoverageCliArgs {
  if (hasFlag(argv, '--help')) {
    return {
      help: true,
      queueId: 420,
      json: hasFlag(argv, '--json'),
    };
  }

  assertKnownFlags(argv, COVERAGE_KNOWN_FLAGS);

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

export function parseCollectorSchedulerArgs(argv: string[]): CollectorSchedulerCliArgs {
  if (hasFlag(argv, '--help')) {
    return { help: true };
  }

  assertKnownFlags(argv, SCHEDULER_KNOWN_FLAGS);

  return { help: false };
}

export function parseCollectorSchedulerTriggerArgs(
  argv: string[],
): CollectorSchedulerTriggerCliArgs {
  if (hasFlag(argv, '--help')) {
    return {
      help: true,
      json: hasFlag(argv, '--json'),
    };
  }

  assertKnownFlags(argv, SCHEDULER_TRIGGER_KNOWN_FLAGS);

  return {
    help: false,
    json: hasFlag(argv, '--json'),
  };
}

export function parseCollectorSchedulerStatusArgs(
  argv: string[],
): CollectorSchedulerStatusCliArgs {
  if (hasFlag(argv, '--help')) {
    return {
      help: true,
      json: hasFlag(argv, '--json'),
    };
  }

  assertKnownFlags(argv, SCHEDULER_STATUS_KNOWN_FLAGS);

  return {
    help: false,
    json: hasFlag(argv, '--json'),
  };
}

function parseTierCsv(
  raw: string | undefined,
  allowed: readonly RankTier[],
  fallback: RankTier[],
  flagName: string,
): RankTier[] {
  const source = raw ?? fallback.join(',');
  const parts = source
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new ValidationFailureError(`${flagName} must include at least one tier.`);
  }

  const allowedSet = new Set<string>(allowed);
  const tiers: RankTier[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const parsed = RankTierSchema.safeParse(part);
    if (!parsed.success || !allowedSet.has(parsed.data)) {
      throw new ValidationFailureError(
        `${flagName} contains unsupported tier "${part}". Allowed: ${allowed.join(', ')}.`,
        { received: part },
      );
    }
    if (seen.has(parsed.data)) {
      continue;
    }
    seen.add(parsed.data);
    tiers.push(parsed.data);
  }
  return tiers;
}

/**
 * Ladder seed CLI args.
 *
 * Apex: `--tiers` defaults to config ladderTiers (usually CHALLENGER,GRANDMASTER).
 * MASTER is allowlisted (Apex segment) but must still be explicitly listed in `--tiers`
 * so a large Master league list is never selected from config defaults alone.
 *
 * Representative: requires bounded page selection via `--division` + `--page`
 * OR `--max-pages-per-division` (capped by config hard max). Division defaults
 * to I when only max-pages is provided.
 */
export function parseCollectorLadderSeedArgs(
  argv: string[],
  config: CollectorConfig = loadCollectorConfig({}),
): CollectorLadderSeedCliArgs {
  if (hasFlag(argv, '--help')) {
    return {
      help: true,
      platform: config.ladderPlatform ?? config.platformAllowlist[0] ?? 'na1',
      mode: 'apex',
      tiers: [...config.ladderTiers],
      dryRun: hasFlag(argv, '--dry-run'),
      json: hasFlag(argv, '--json'),
    };
  }

  assertKnownFlags(argv, LADDER_SEED_KNOWN_FLAGS);

  const platformRaw = readFlagValue(argv, '--platform');
  if (!platformRaw) {
    throw new ValidationFailureError('--platform is required.');
  }
  const platform = parsePlatformRoute(platformRaw);
  if (!config.platformAllowlist.includes(platform)) {
    throw new ValidationFailureError(
      `--platform ${platform} is outside COLLECTOR_PLATFORM_ALLOWLIST.`,
      { received: platformRaw },
    );
  }
  if (config.ladderPlatform != null && platform !== config.ladderPlatform) {
    throw new ValidationFailureError(
      `--platform ${platform} is outside COLLECTOR_LADDER_PLATFORM (${config.ladderPlatform}).`,
      { received: platformRaw },
    );
  }

  const modeRaw = (readFlagValue(argv, '--mode') ?? 'apex').toLowerCase();
  if (modeRaw !== 'apex' && modeRaw !== 'representative') {
    throw new ValidationFailureError('--mode must be apex or representative.', {
      received: modeRaw,
    });
  }
  const mode = modeRaw as CollectorLadderSeedCliArgs['mode'];

  const tiersRaw = readFlagValue(argv, '--tiers');
  const tiers =
    mode === 'apex'
      ? parseTierCsv(tiersRaw, LADDER_SEED_APEX_TIERS, config.ladderTiers, '--tiers')
      : parseTierCsv(
          tiersRaw,
          LADDER_REPRESENTATIVE_TIERS_ALLOWLIST,
          config.ladderRepresentativeTiers,
          '--tiers',
        );

  if (mode === 'apex' && tiers.includes('MASTER') && tiersRaw === undefined) {
    throw new ValidationFailureError(
      'MASTER must be explicitly listed in --tiers (not selected via config defaults alone).',
    );
  }

  const divisionRaw = readFlagValue(argv, '--division');
  const pageRaw = readFlagValue(argv, '--page');
  const maxPagesRaw = readFlagValue(argv, '--max-pages-per-division');

  let division: CollectorLadderSeedCliArgs['division'] | undefined;
  let page: number | undefined;
  let maxPagesPerDivision: number | undefined;

  if (mode === 'representative') {
    if (pageRaw !== undefined && maxPagesRaw !== undefined) {
      throw new ValidationFailureError(
        '`--page` and `--max-pages-per-division` are mutually exclusive.',
      );
    }
    if (pageRaw === undefined && maxPagesRaw === undefined) {
      throw new ValidationFailureError(
        'Representative mode requires `--division` + `--page` or `--max-pages-per-division`.',
      );
    }

    if (pageRaw !== undefined) {
      if (!divisionRaw) {
        throw new ValidationFailureError('`--page` requires `--division`.');
      }
      const divisionParsed = RankDivisionSchema.safeParse(divisionRaw.toUpperCase());
      if (!divisionParsed.success) {
        throw new ValidationFailureError('--division must be one of I, II, III, IV.', {
          received: divisionRaw,
        });
      }
      division = divisionParsed.data;
      page = parsePositiveIntFlag(pageRaw, 1, {
        min: 1,
        max: config.ladderMaxPagesPerTierDivision,
        name: '--page',
      });
    } else {
      if (divisionRaw) {
        const divisionParsed = RankDivisionSchema.safeParse(divisionRaw.toUpperCase());
        if (!divisionParsed.success) {
          throw new ValidationFailureError('--division must be one of I, II, III, IV.', {
            received: divisionRaw,
          });
        }
        division = divisionParsed.data;
      } else {
        division = 'I';
      }
      maxPagesPerDivision = parsePositiveIntFlag(maxPagesRaw, 1, {
        min: 1,
        max: config.ladderMaxPagesPerTierDivision,
        name: '--max-pages-per-division',
      });
    }
  } else if (divisionRaw !== undefined || pageRaw !== undefined || maxPagesRaw !== undefined) {
    throw new ValidationFailureError(
      '`--division` / `--page` / `--max-pages-per-division` are only valid with --mode representative.',
    );
  }

  return {
    help: false,
    platform,
    mode,
    tiers,
    dryRun: hasFlag(argv, '--dry-run'),
    json: hasFlag(argv, '--json'),
    ...(division !== undefined ? { division } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(maxPagesPerDivision !== undefined ? { maxPagesPerDivision } : {}),
  };
}
