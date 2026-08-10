/**
 * Shared cross-process Riot 429 cooldown (Redis-backed).
 *
 * Redis key: {@link RIOT_SHARED_429_COOLDOWN_REDIS_KEY}
 * Value: epoch milliseconds as a decimal string (cooldownUntil).
 *
 * Writes use Redis EVAL (Lua) so concurrent publishers cannot shorten an
 * existing later cooldownUntil. App-level read-compare-write is forbidden.
 *
 * Env recommendation (not loaded here): {@link RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV}
 * Default floor suggestion: {@link DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS}
 * (same as COLLECTOR_SCHEDULER_RATE_LIMIT_COOLDOWN_MS = 15 minutes).
 */

/** Stable Redis key for the shared Riot 429 cooldownUntil signal. */
export const RIOT_SHARED_429_COOLDOWN_REDIS_KEY = 'riot:shared-429-cooldown';

/** Suggested default floor: 15 minutes. */
export const DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS = 15 * 60_000;

/** Recommended env var for the configured floor (ms). Not wired by this package. */
export const RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV = 'RIOT_SHARED_429_COOLDOWN_MIN_MS';

/**
 * Minimal Redis surface required by {@link RiotSharedCooldownStore}.
 * Compatible with ioredis `get` + `eval` without taking ioredis as a hard dependency.
 */
export type SharedCooldownRedisClient = {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

export type RiotSharedCooldownState = {
  cooldownUntil: number | null;
};

export type ExtendSharedCooldownInput = {
  now: number;
  configuredFloorMs: number;
  /** From ProviderRateLimitedError.details.retryAfterSeconds * 1000 when present. */
  retryAfterMs?: number | null;
  /** Optional operational tag, e.g. 'ladder' | 'collector' | 'worker'. */
  source?: string;
};

export type ExtendSharedCooldownResult = {
  cooldownUntil: number;
  extended: boolean;
  previousCooldownUntil: number | null;
};

export type RiotSharedCooldownStoreOptions = {
  redisKey?: string;
};

/**
 * Atomic monotonic extend:
 * - proposed = ARGV[1]
 * - if existing >= proposed → keep existing (extended=0)
 * - else SET proposed (extended=1)
 *
 * Returns: { finalUntil, extendedFlag, previousUntilOrEmpty }
 */
export const EXTEND_SHARED_COOLDOWN_LUA = `
local key = KEYS[1]
local proposed = tonumber(ARGV[1])
if proposed == nil then
  return redis.error_reply('invalid proposedCooldownUntil')
end

local existingRaw = redis.call('GET', key)
local existing = tonumber(existingRaw)

if existing ~= nil and existing >= proposed then
  return { tostring(existing), 0, tostring(existing) }
end

redis.call('SET', key, tostring(proposed))
local previous = ''
if existing ~= nil then
  previous = tostring(existing)
end
return { tostring(proposed), 1, previous }
`.trim();

function normalizeNonNegativeMs(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

/** Effective duration = max(floor, retryAfter or 0). */
export function computeEffectiveCooldownDurationMs(
  floorMs: number,
  retryAfterMs?: number | null,
): number {
  const floor = normalizeNonNegativeMs(floorMs);
  const retryAfter = normalizeNonNegativeMs(retryAfterMs);
  return Math.max(floor, retryAfter);
}

/** proposed cooldownUntil = now + effective duration. */
export function computeProposedCooldownUntil(
  now: number,
  floorMs: number,
  retryAfterMs?: number | null,
): number {
  return now + computeEffectiveCooldownDurationMs(floorMs, retryAfterMs);
}

export function isSharedCooldownActive(cooldownUntil: number | null, now: number): boolean {
  return cooldownUntil != null && Number.isFinite(cooldownUntil) && cooldownUntil > now;
}

export function sharedCooldownRemainingMs(cooldownUntil: number | null, now: number): number {
  if (!isSharedCooldownActive(cooldownUntil, now) || cooldownUntil == null) {
    return 0;
  }
  return Math.max(0, cooldownUntil - now);
}

function parseCooldownUntil(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function parseEvalExtendResult(raw: unknown): ExtendSharedCooldownResult {
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new Error('Unexpected Redis EVAL result for shared cooldown extend');
  }

  const cooldownUntil = Number(raw[0]);
  const extendedFlag = Number(raw[1]);
  const previousRaw = raw[2];

  if (!Number.isFinite(cooldownUntil) || !Number.isFinite(extendedFlag)) {
    throw new Error('Unexpected Redis EVAL numeric fields for shared cooldown extend');
  }

  const previousCooldownUntil =
    previousRaw === '' || previousRaw == null ? null : Number(previousRaw);
  if (previousCooldownUntil != null && !Number.isFinite(previousCooldownUntil)) {
    throw new Error('Unexpected Redis EVAL previousCooldownUntil for shared cooldown extend');
  }

  return {
    cooldownUntil,
    extended: extendedFlag === 1,
    previousCooldownUntil,
  };
}

export class RiotSharedCooldownStore {
  private readonly redis: SharedCooldownRedisClient;
  private readonly redisKey: string;

  constructor(redis: SharedCooldownRedisClient, options?: RiotSharedCooldownStoreOptions) {
    this.redis = redis;
    this.redisKey = options?.redisKey ?? RIOT_SHARED_429_COOLDOWN_REDIS_KEY;
  }

  async getCooldownState(): Promise<RiotSharedCooldownState> {
    const raw = await this.redis.get(this.redisKey);
    return { cooldownUntil: parseCooldownUntil(raw) };
  }

  async isCoolingDown(now: number): Promise<boolean> {
    const { cooldownUntil } = await this.getCooldownState();
    return isSharedCooldownActive(cooldownUntil, now);
  }

  async remainingMs(now: number): Promise<number> {
    const { cooldownUntil } = await this.getCooldownState();
    return sharedCooldownRemainingMs(cooldownUntil, now);
  }

  /**
   * Atomically extend shared cooldownUntil to max(existing, proposed).
   * proposed = now + max(configuredFloorMs, retryAfterMs || 0).
   *
   * `source` is accepted for call-site tagging but is not persisted in the
   * minimal epoch-ms value format.
   */
  async extendCooldown(input: ExtendSharedCooldownInput): Promise<ExtendSharedCooldownResult> {
    void input.source;
    const proposed = computeProposedCooldownUntil(
      input.now,
      input.configuredFloorMs,
      input.retryAfterMs,
    );

    const raw = await this.redis.eval(
      EXTEND_SHARED_COOLDOWN_LUA,
      1,
      this.redisKey,
      String(proposed),
    );

    return parseEvalExtendResult(raw);
  }
}
