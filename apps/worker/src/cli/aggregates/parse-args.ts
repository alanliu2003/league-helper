import { ValidationFailureError } from '@league-helper/shared';
import {
  DEFAULT_CHAMPION_ROLLUP_POLICY,
  type ChampionRollupPolicy,
} from '@league-helper/match-analytics';

export type AggregateCliFilters = {
  patch?: string;
  queueId?: number;
  platformRoute?: string;
  championId?: number;
};

export type SharedAggregateCliFlags = {
  help: boolean;
  json: boolean;
  dryRun: boolean;
  confirm: boolean;
  batchSize?: number;
  aggregationVersion?: string;
  sourceNormalizationVersion?: string;
  filters: AggregateCliFilters;
  rollup: {
    includeAllTiersAndPosition: boolean;
    includeAllPlatform: boolean;
    includeAllRegionalRoute: boolean;
    includeAllQueue: boolean;
  };
};

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ValidationFailureError(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationFailureError(`${name} must be a positive integer.`, { received: raw });
  }
  return value;
}

/**
 * Parse shared champion-aggregate CLI flags from argv (excluding node/tsx/script).
 */
export function parseSharedAggregateCliArgs(argv: string[]): SharedAggregateCliFlags {
  const flags: SharedAggregateCliFlags = {
    help: false,
    json: false,
    dryRun: false,
    confirm: false,
    filters: {},
    rollup: {
      includeAllTiersAndPosition: false,
      includeAllPlatform: false,
      includeAllRegionalRoute: false,
      includeAllQueue: false,
    },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        flags.help = true;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--confirm':
        flags.confirm = true;
        break;
      case '--batch-size': {
        flags.batchSize = parsePositiveInt(readFlagValue(argv, i, '--batch-size'), '--batch-size');
        i += 1;
        break;
      }
      case '--patch': {
        flags.filters.patch = readFlagValue(argv, i, '--patch').trim();
        i += 1;
        break;
      }
      case '--queue': {
        flags.filters.queueId = parsePositiveInt(readFlagValue(argv, i, '--queue'), '--queue');
        i += 1;
        break;
      }
      case '--platform': {
        flags.filters.platformRoute = readFlagValue(argv, i, '--platform').trim().toLowerCase();
        i += 1;
        break;
      }
      case '--champion': {
        flags.filters.championId = parsePositiveInt(
          readFlagValue(argv, i, '--champion'),
          '--champion',
        );
        i += 1;
        break;
      }
      case '--aggregation-version': {
        flags.aggregationVersion = readFlagValue(argv, i, '--aggregation-version').trim();
        i += 1;
        break;
      }
      case '--source-normalization-version': {
        flags.sourceNormalizationVersion = readFlagValue(
          argv,
          i,
          '--source-normalization-version',
        ).trim();
        i += 1;
        break;
      }
      case '--include-all-tiers-and-position':
        flags.rollup.includeAllTiersAndPosition = true;
        break;
      case '--include-all-platform':
        flags.rollup.includeAllPlatform = true;
        break;
      case '--include-all-regional-route':
        flags.rollup.includeAllRegionalRoute = true;
        break;
      case '--include-all-queue':
        flags.rollup.includeAllQueue = true;
        break;
      default:
        throw new ValidationFailureError(`Unknown argument: ${arg}`);
    }
  }

  return flags;
}

export function resolveBatchSize(
  flagValue: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fallback = 50,
): number {
  if (flagValue !== undefined) {
    return flagValue;
  }
  const raw = env.CHAMPION_AGGREGATION_BATCH_SIZE?.trim();
  if (!raw) {
    return fallback;
  }
  return parsePositiveInt(raw, 'CHAMPION_AGGREGATION_BATCH_SIZE');
}

export function resolveMinSample(env: NodeJS.ProcessEnv = process.env, fallback = 30): number {
  const raw = env.CHAMPION_AGGREGATION_MIN_SAMPLE?.trim();
  if (!raw) {
    return fallback;
  }
  return parsePositiveInt(raw, 'CHAMPION_AGGREGATION_MIN_SAMPLE');
}

export function hasNonDefaultRollupFlags(rollup: SharedAggregateCliFlags['rollup']): boolean {
  return (
    rollup.includeAllTiersAndPosition ||
    rollup.includeAllPlatform ||
    rollup.includeAllRegionalRoute ||
    rollup.includeAllQueue
  );
}

export function toRollupPolicy(rollup: SharedAggregateCliFlags['rollup']): ChampionRollupPolicy {
  return {
    ...DEFAULT_CHAMPION_ROLLUP_POLICY,
    includeAllTierAndPosition: rollup.includeAllTiersAndPosition,
    includeAllPlatform: rollup.includeAllPlatform,
    includeAllRegionalRoute: rollup.includeAllRegionalRoute,
    includeAllQueue: rollup.includeAllQueue,
  };
}

export function isRebuildConfirmed(
  flags: Pick<SharedAggregateCliFlags, 'confirm'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return flags.confirm || env.AGGREGATES_REBUILD_CHAMPIONS_CONFIRM === 'YES';
}
