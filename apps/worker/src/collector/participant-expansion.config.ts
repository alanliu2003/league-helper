import {
  parsePlatformRoute,
  ValidationFailureError,
} from '@league-helper/shared';

/**
 * Worker-side participant expansion config.
 * Defaults/caps MUST stay identical to API CollectorConfig expansion fields.
 * Drift is guarded by participant-expansion.config.drift.test.ts.
 */

export type ParticipantExpansionConfig = {
  expandFromParticipants: boolean;
  expansionMaxDepth: number;
  expansionMaxNewPlayersPerMatch: number;
  expansionMaxNewPlayersPerSourcePlayer: number;
  expansionMaxNewPlayersPerRun: number;
  expansionMaxTrackedPlayers: number;
  expansionQueueId: number;
  platformAllowlist: string[];
};

const DEFAULT_EXPANSION_MAX_DEPTH = 1;
const HARD_MAX_EXPANSION_DEPTH = 3;
const DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH = 3;
const HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH = 9;
const DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER = 5;
const HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER = 50;
const DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_RUN = 20;
const HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_RUN = 200;
const DEFAULT_EXPANSION_MAX_TRACKED_PLAYERS = 500;
const HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS = 5000;
const DEFAULT_EXPANSION_QUEUE_ID = 420;
const DEFAULT_PLATFORM_ALLOWLIST = 'na1';

/** Exported for API/worker drift tests. */
export const PARTICIPANT_EXPANSION_CONFIG_VECTORS = {
  expandFromParticipantsDefault: false,
  maxDepthDefault: DEFAULT_EXPANSION_MAX_DEPTH,
  maxDepthHardMax: HARD_MAX_EXPANSION_DEPTH,
  maxNewPlayersPerMatchDefault: DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
  maxNewPlayersPerMatchHardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
  maxNewPlayersPerSourcePlayerDefault: DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
  maxNewPlayersPerSourcePlayerHardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
  maxNewPlayersPerRunDefault: DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
  maxNewPlayersPerRunHardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
  maxTrackedPlayersDefault: DEFAULT_EXPANSION_MAX_TRACKED_PLAYERS,
  maxTrackedPlayersHardMax: HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS,
  expansionQueueIdDefault: DEFAULT_EXPANSION_QUEUE_ID,
} as const;

function parseOptionalInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number; name: string },
): number {
  if (raw === undefined || raw.trim() === '') {
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

function parseClampedInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; hardMax: number; name: string },
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min) {
    throw new ValidationFailureError(
      `${bounds.name} must be an integer >= ${bounds.min}.`,
      { received: raw },
    );
  }
  return Math.min(value, bounds.hardMax);
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new ValidationFailureError(`${name} must be a boolean (true/false).`, { received: raw });
}

function parsePlatformAllowlist(raw: string | undefined): string[] {
  const source = raw === undefined || raw.trim() === '' ? DEFAULT_PLATFORM_ALLOWLIST : raw;
  const parts = source
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new ValidationFailureError('COLLECTOR_PLATFORM_ALLOWLIST must include at least one platform.');
  }
  const seen = new Set<string>();
  const platforms: string[] = [];
  for (const part of parts) {
    const platform = parsePlatformRoute(part);
    if (!seen.has(platform)) {
      seen.add(platform);
      platforms.push(platform);
    }
  }
  return platforms;
}

export function loadParticipantExpansionConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ParticipantExpansionConfig {
  return {
    expandFromParticipants: parseBooleanFlag(
      env.COLLECTOR_EXPAND_FROM_PARTICIPANTS,
      false,
      'COLLECTOR_EXPAND_FROM_PARTICIPANTS',
    ),
    expansionMaxDepth: parseOptionalInt(
      env.COLLECTOR_EXPANSION_MAX_DEPTH,
      DEFAULT_EXPANSION_MAX_DEPTH,
      {
        min: 0,
        max: HARD_MAX_EXPANSION_DEPTH,
        name: 'COLLECTOR_EXPANSION_MAX_DEPTH',
      },
    ),
    expansionMaxNewPlayersPerMatch: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
      DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH,
        name: 'COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH',
      },
    ),
    expansionMaxNewPlayersPerSourcePlayer: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
      DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER,
        name: 'COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER',
      },
    ),
    expansionMaxNewPlayersPerRun: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
      DEFAULT_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_NEW_PLAYERS_PER_RUN,
        name: 'COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN',
      },
    ),
    expansionMaxTrackedPlayers: parseClampedInt(
      env.COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS,
      DEFAULT_EXPANSION_MAX_TRACKED_PLAYERS,
      {
        min: 0,
        hardMax: HARD_MAX_EXPANSION_MAX_TRACKED_PLAYERS,
        name: 'COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS',
      },
    ),
    expansionQueueId: parseOptionalInt(
      env.COLLECTOR_EXPANSION_QUEUE_ID,
      DEFAULT_EXPANSION_QUEUE_ID,
      {
        min: 0,
        max: 1_000_000,
        name: 'COLLECTOR_EXPANSION_QUEUE_ID',
      },
    ),
    platformAllowlist: parsePlatformAllowlist(env.COLLECTOR_PLATFORM_ALLOWLIST),
  };
}
