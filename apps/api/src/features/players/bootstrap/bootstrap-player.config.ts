import { ValidationFailureError } from '@league-helper/shared';

export type MatchBootstrapConfig = {
  defaultQueueId: number;
  defaultMaxMatches: number;
  hardMaxMatches: number;
  pageSize: number;
  fileMaxPlayers: number;
  maxConcurrency: number;
  waitTimeoutMs: number;
  waitPollIntervalMs: number;
};

const DEFAULT_QUEUE_ID = 420;
const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_HARD_MAX_MATCHES = 500;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_FILE_MAX_PLAYERS = 25;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 2_000;

const MIN_QUEUE_ID = 0;
const MAX_QUEUE_ID = 1_000_000;
const MIN_MATCHES = 1;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const MIN_FILE_PLAYERS = 1;
const MAX_FILE_PLAYERS = 1_000;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY_BOUND = 10;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 3_600_000;
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 60_000;

function parseBoundedInt(
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

/** Load ops bootstrap config (CLI only — not used by public UI). */
export function loadMatchBootstrapConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): MatchBootstrapConfig {
  const hardMaxMatches = parseBoundedInt(
    env.MATCH_BOOTSTRAP_HARD_MAX_MATCHES,
    DEFAULT_HARD_MAX_MATCHES,
    {
      min: MIN_MATCHES,
      max: 10_000,
      name: 'MATCH_BOOTSTRAP_HARD_MAX_MATCHES',
    },
  );

  const defaultMaxMatches = parseBoundedInt(
    env.MATCH_BOOTSTRAP_DEFAULT_MAX_MATCHES,
    DEFAULT_MAX_MATCHES,
    {
      min: MIN_MATCHES,
      max: hardMaxMatches,
      name: 'MATCH_BOOTSTRAP_DEFAULT_MAX_MATCHES',
    },
  );

  return {
    defaultQueueId: parseBoundedInt(env.MATCH_BOOTSTRAP_DEFAULT_QUEUE_ID, DEFAULT_QUEUE_ID, {
      min: MIN_QUEUE_ID,
      max: MAX_QUEUE_ID,
      name: 'MATCH_BOOTSTRAP_DEFAULT_QUEUE_ID',
    }),
    defaultMaxMatches,
    hardMaxMatches,
    pageSize: parseBoundedInt(env.MATCH_BOOTSTRAP_PAGE_SIZE, DEFAULT_PAGE_SIZE, {
      min: MIN_PAGE_SIZE,
      max: MAX_PAGE_SIZE,
      name: 'MATCH_BOOTSTRAP_PAGE_SIZE',
    }),
    fileMaxPlayers: parseBoundedInt(
      env.MATCH_BOOTSTRAP_FILE_MAX_PLAYERS,
      DEFAULT_FILE_MAX_PLAYERS,
      {
        min: MIN_FILE_PLAYERS,
        max: MAX_FILE_PLAYERS,
        name: 'MATCH_BOOTSTRAP_FILE_MAX_PLAYERS',
      },
    ),
    maxConcurrency: parseBoundedInt(
      env.MATCH_BOOTSTRAP_MAX_CONCURRENCY,
      DEFAULT_MAX_CONCURRENCY,
      {
        min: MIN_CONCURRENCY,
        max: MAX_CONCURRENCY_BOUND,
        name: 'MATCH_BOOTSTRAP_MAX_CONCURRENCY',
      },
    ),
    waitTimeoutMs: parseBoundedInt(
      env.MATCH_BOOTSTRAP_WAIT_TIMEOUT_MS,
      DEFAULT_WAIT_TIMEOUT_MS,
      {
        min: MIN_TIMEOUT_MS,
        max: MAX_TIMEOUT_MS,
        name: 'MATCH_BOOTSTRAP_WAIT_TIMEOUT_MS',
      },
    ),
    waitPollIntervalMs: parseBoundedInt(
      env.MATCH_BOOTSTRAP_WAIT_POLL_INTERVAL_MS,
      DEFAULT_WAIT_POLL_INTERVAL_MS,
      {
        min: MIN_POLL_MS,
        max: MAX_POLL_MS,
        name: 'MATCH_BOOTSTRAP_WAIT_POLL_INTERVAL_MS',
      },
    ),
  };
}
