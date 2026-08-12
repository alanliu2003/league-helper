/**
 * Shared proactive Riot request budget (Redis-backed sliding windows).
 *
 * Complements {@link RiotSharedCooldownStore}:
 * - Budget coordinator paces BEFORE requests (short + long windows, workload fairness)
 * - Shared 429 cooldown remains the emergency safety net AFTER a 429
 *
 * Redis keys (prefix configurable):
 * - `{prefix}:win:short` / `{prefix}:win:long` — ZSET request timestamps
 * - `{prefix}:win:enrichment` — enrichment short-window ZSET
 * - `{prefix}:metrics` — HASH counters
 * - `{prefix}:observed` — HASH from Riot rate-limit headers
 * - `{prefix}:pressure` — STRING epoch-ms until header-pressure clears
 */

import { randomUUID } from 'node:crypto';
import { RIOT_SHARED_429_COOLDOWN_REDIS_KEY } from './riot-shared-cooldown';
import {
  effectiveWindowLimit,
  loadRiotRequestBudgetConfig,
  type RiotRequestBudgetConfig,
} from './riot-request-budget-config';
import {
  RiotRequestBudgetDeferredError,
  type RiotRequestBudgetDeferReason,
} from './riot-request-budget-deferred.error';
import type { RiotRateLimitSnapshot, RiotResponseMetadata, SleepFn } from './riot-api.types';
import type { RiotRequestWorkload } from './riot-request-workload';
import { resolveRiotRequestWorkload } from './riot-request-workload';
import type { RiotEndpointCategory } from './riot-api.types';
import type { RiotLogger } from './riot-logger';

export type RequestBudgetRedisClient = {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  hgetall?(key: string): Promise<Record<string, string>>;
  hincrby?(key: string, field: string, increment: number): Promise<number>;
  hmset?(key: string, ...args: Array<string | number>): Promise<unknown>;
  pexpire?(key: string, ms: number): Promise<unknown>;
  // Loose arity so ioredis `set(key, value, 'PX', ms)` remains assignable.
  set?(key: string, value: string, ...args: unknown[]): Promise<unknown>;
};

export type RiotRequestBudgetReserveResult =
  | {
      admitted: true;
      shortCount: number;
      longCount: number;
      workload: RiotRequestWorkload;
    }
  | {
      admitted: false;
      waitMs: number;
      reason: RiotRequestBudgetDeferReason;
      shortCount: number;
      longCount: number;
      workload: RiotRequestWorkload;
    };

export type RiotRequestBudgetMetricsSnapshot = {
  admitted: number;
  delayed: number;
  deferred: number;
  cooldownBlocked: number;
  headerPressure: number;
  starvation: number;
  byWorkload: Partial<Record<RiotRequestWorkload, number>>;
  delayedMsTotal: number;
  shortUtilization: number | null;
  longUtilization: number | null;
};

export type RiotRequestBudgetStoreOptions = {
  config?: RiotRequestBudgetConfig;
  cooldownRedisKey?: string;
  logger?: Pick<RiotLogger, 'log' | 'warn'>;
};

/**
 * Atomic reserve across short/long windows + enrichment share + product reserve.
 * Returns: { admittedFlag, waitMs, reason, shortCount, longCount }
 */
export const RESERVE_RIOT_REQUEST_BUDGET_LUA = `
local shortKey = KEYS[1]
local longKey = KEYS[2]
local enrichKey = KEYS[3]
local metricsKey = KEYS[4]
local cooldownKey = KEYS[5]
local pressureKey = KEYS[6]

local now = tonumber(ARGV[1])
local shortLimit = tonumber(ARGV[2])
local shortWindowMs = tonumber(ARGV[3])
local longLimit = tonumber(ARGV[4])
local longWindowMs = tonumber(ARGV[5])
local workload = ARGV[6]
local enrichmentMaxShare = tonumber(ARGV[7])
local productReservedShare = tonumber(ARGV[8])
local requestId = ARGV[9]

if now == nil or shortLimit == nil or longLimit == nil then
  return redis.error_reply('invalid budget reserve args')
end

local cdRaw = redis.call('GET', cooldownKey)
local cd = tonumber(cdRaw)
if cd ~= nil and cd > now then
  redis.call('HINCRBY', metricsKey, 'cooldownBlocked', 1)
  return {0, tostring(cd - now), 'cooldown', 0, 0}
end

local pressureRaw = redis.call('GET', pressureKey)
local pressureUntil = tonumber(pressureRaw)
if pressureUntil ~= nil and pressureUntil > now then
  redis.call('HINCRBY', metricsKey, 'headerPressure', 1)
  redis.call('HINCRBY', metricsKey, 'delayed', 1)
  return {0, tostring(pressureUntil - now), 'header_pressure', 0, 0}
end

redis.call('ZREMRANGEBYSCORE', shortKey, 0, now - shortWindowMs)
local shortCount = redis.call('ZCARD', shortKey)
if shortCount >= shortLimit then
  local oldest = redis.call('ZRANGE', shortKey, 0, 0, 'WITHSCORES')
  local wait = shortWindowMs
  if oldest[2] ~= nil then
    wait = math.max(1, (tonumber(oldest[2]) + shortWindowMs) - now)
  end
  redis.call('HINCRBY', metricsKey, 'delayed', 1)
  redis.call('HINCRBY', metricsKey, 'delayedMsTotal', wait)
  return {0, tostring(wait), 'short_window', shortCount, 0}
end

redis.call('ZREMRANGEBYSCORE', longKey, 0, now - longWindowMs)
local longCount = redis.call('ZCARD', longKey)
if longCount >= longLimit then
  local oldest = redis.call('ZRANGE', longKey, 0, 0, 'WITHSCORES')
  local wait = longWindowMs
  if oldest[2] ~= nil then
    wait = math.max(1, (tonumber(oldest[2]) + longWindowMs) - now)
  end
  redis.call('HINCRBY', metricsKey, 'delayed', 1)
  redis.call('HINCRBY', metricsKey, 'delayedMsTotal', wait)
  return {0, tostring(wait), 'long_window', shortCount, longCount}
end

if workload ~= 'product' and productReservedShare > 0 then
  local nonProductCap = math.max(1, math.floor(shortLimit * (1 - productReservedShare)))
  if shortCount >= nonProductCap then
    local oldest = redis.call('ZRANGE', shortKey, 0, 0, 'WITHSCORES')
    local wait = shortWindowMs
    if oldest[2] ~= nil then
      wait = math.max(1, (tonumber(oldest[2]) + shortWindowMs) - now)
    end
    redis.call('HINCRBY', metricsKey, 'delayed', 1)
    redis.call('HINCRBY', metricsKey, 'starvation', 1)
    redis.call('HINCRBY', metricsKey, 'delayedMsTotal', wait)
    return {0, tostring(wait), 'product_reserve', shortCount, longCount}
  end
end

if workload == 'enrichment' then
  redis.call('ZREMRANGEBYSCORE', enrichKey, 0, now - shortWindowMs)
  local enrichCount = redis.call('ZCARD', enrichKey)
  local enrichCap = math.max(1, math.floor(shortLimit * enrichmentMaxShare))
  if enrichCount >= enrichCap then
    local oldest = redis.call('ZRANGE', enrichKey, 0, 0, 'WITHSCORES')
    local wait = shortWindowMs
    if oldest[2] ~= nil then
      wait = math.max(1, (tonumber(oldest[2]) + shortWindowMs) - now)
    end
    redis.call('HINCRBY', metricsKey, 'delayed', 1)
    redis.call('HINCRBY', metricsKey, 'starvation', 1)
    redis.call('HINCRBY', metricsKey, 'delayedMsTotal', wait)
    return {0, tostring(wait), 'enrichment_share', shortCount, longCount}
  end
end

redis.call('ZADD', shortKey, now, requestId)
redis.call('ZADD', longKey, now, requestId)
redis.call('PEXPIRE', shortKey, shortWindowMs + 1000)
redis.call('PEXPIRE', longKey, longWindowMs + 1000)
if workload == 'enrichment' then
  redis.call('ZADD', enrichKey, now, requestId)
  redis.call('PEXPIRE', enrichKey, shortWindowMs + 1000)
end

redis.call('HINCRBY', metricsKey, 'admitted', 1)
redis.call('HINCRBY', metricsKey, 'admitted:' .. workload, 1)
redis.call('PEXPIRE', metricsKey, math.max(longWindowMs * 2, 3600000))
return {1, '0', 'admitted', shortCount + 1, longCount + 1}
`.trim();

function parseReserveResult(
  raw: unknown,
  workload: RiotRequestWorkload,
): RiotRequestBudgetReserveResult {
  if (!Array.isArray(raw) || raw.length < 5) {
    throw new Error('Unexpected Redis EVAL result for request budget reserve');
  }
  const admittedFlag = Number(raw[0]);
  const waitMs = Math.max(0, Math.ceil(Number(raw[1])));
  const reason = String(raw[2]) as RiotRequestBudgetDeferReason | 'admitted';
  const shortCount = Number(raw[3]) || 0;
  const longCount = Number(raw[4]) || 0;

  if (admittedFlag === 1) {
    return { admitted: true, shortCount, longCount, workload };
  }

  const deferReason: RiotRequestBudgetDeferReason =
    reason === 'admitted' ? 'short_window' : (reason as RiotRequestBudgetDeferReason);

  return {
    admitted: false,
    waitMs: Number.isFinite(waitMs) ? waitMs : 1_000,
    reason: deferReason,
    shortCount,
    longCount,
    workload,
  };
}

export class RiotRequestBudgetStore {
  private readonly redis: RequestBudgetRedisClient;
  private readonly config: RiotRequestBudgetConfig;
  private readonly cooldownRedisKey: string;
  private readonly logger: Pick<RiotLogger, 'log' | 'warn'> | null;
  private observedShortLimit: number | null = null;
  private observedLongLimit: number | null = null;

  constructor(redis: RequestBudgetRedisClient, options?: RiotRequestBudgetStoreOptions) {
    this.redis = redis;
    this.config = options?.config ?? loadRiotRequestBudgetConfig();
    this.cooldownRedisKey = options?.cooldownRedisKey ?? RIOT_SHARED_429_COOLDOWN_REDIS_KEY;
    this.logger = options?.logger ?? null;
  }

  getConfig(): RiotRequestBudgetConfig {
    return this.config;
  }

  keys() {
    const prefix = this.config.redisKeyPrefix;
    return {
      short: `${prefix}:win:short`,
      long: `${prefix}:win:long`,
      enrichment: `${prefix}:win:enrichment`,
      metrics: `${prefix}:metrics`,
      observed: `${prefix}:observed`,
      pressure: `${prefix}:pressure`,
      cooldown: this.cooldownRedisKey,
    };
  }

  effectiveShortLimit(): number {
    const base = this.observedShortLimit ?? this.config.shortLimit;
    return effectiveWindowLimit(base, this.config.utilization);
  }

  effectiveLongLimit(): number {
    const base = this.observedLongLimit ?? this.config.longLimit;
    return effectiveWindowLimit(base, this.config.utilization);
  }

  async reserve(input: {
    workload: RiotRequestWorkload;
    now?: number;
    requestId?: string;
  }): Promise<RiotRequestBudgetReserveResult> {
    if (!this.config.enabled) {
      return {
        admitted: true,
        shortCount: 0,
        longCount: 0,
        workload: input.workload,
      };
    }

    const now = input.now ?? Date.now();
    const keys = this.keys();
    const requestId = input.requestId ?? `${now}-${randomUUID()}`;

    try {
      const raw = await this.redis.eval(
        RESERVE_RIOT_REQUEST_BUDGET_LUA,
        6,
        keys.short,
        keys.long,
        keys.enrichment,
        keys.metrics,
        keys.cooldown,
        keys.pressure,
        String(now),
        String(this.effectiveShortLimit()),
        String(this.config.shortWindowSeconds * 1000),
        String(this.effectiveLongLimit()),
        String(this.config.longWindowSeconds * 1000),
        input.workload,
        String(this.config.enrichmentMaxShare),
        String(this.config.productReservedShare),
        requestId,
      );
      return parseReserveResult(raw, input.workload);
    } catch (error: unknown) {
      this.logger?.warn(
        JSON.stringify({
          message: 'Riot request budget reserve failed; applying conservative delay',
          workload: input.workload,
          error: error instanceof Error ? error.message : 'unknown',
        }),
      );
      return {
        admitted: false,
        waitMs: Math.min(1_000, Math.max(250, this.config.maxInlineWaitMs || 250)),
        reason: 'redis_error',
        shortCount: 0,
        longCount: 0,
        workload: input.workload,
      };
    }
  }

  /**
   * Reserve with inline wait for short delays; throw deferred error for longer waits.
   * Shared cooldown reason always throws (never inline-sleeps a 15m floor inside HTTP).
   */
  async acquireOrDefer(input: {
    workload: RiotRequestWorkload;
    now?: number;
    sleepFn: SleepFn;
    maxInlineWaitMs?: number;
  }): Promise<{ admitted: true; waitedMs: number; workload: RiotRequestWorkload }> {
    if (!this.config.enabled) {
      return { admitted: true, waitedMs: 0, workload: input.workload };
    }

    const maxInline = input.maxInlineWaitMs ?? this.config.maxInlineWaitMs;
    let waitedMs = 0;
    const deadline = (input.now ?? Date.now()) + Math.max(maxInline, 0) + 50;

    while (true) {
      const now = Date.now();
      const result = await this.reserve({ workload: input.workload, now });
      if (result.admitted) {
        if (waitedMs > 0) {
          this.logger?.log(
            JSON.stringify({
              message: 'Riot request budget admitted after wait',
              workload: input.workload,
              waitedMs,
              shortCount: result.shortCount,
              longCount: result.longCount,
            }),
          );
        }
        return { admitted: true, waitedMs, workload: input.workload };
      }

      if (result.reason === 'cooldown' || result.waitMs > maxInline || now + result.waitMs > deadline) {
        if (this.redis.hincrby) {
          await this.redis.hincrby(this.keys().metrics, 'deferred', 1).catch(() => undefined);
        }
        throw new RiotRequestBudgetDeferredError({
          waitMs: result.waitMs,
          reason: result.reason,
          workload: input.workload,
        });
      }

      this.logger?.log(
        JSON.stringify({
          message: 'Riot request budget pacing wait',
          workload: input.workload,
          waitMs: result.waitMs,
          reason: result.reason,
        }),
      );
      await input.sleepFn(result.waitMs);
      waitedMs += result.waitMs;
    }
  }

  /** Update observed ceilings / pressure from Riot rate-limit headers. */
  async observeRateLimitHeaders(
    rateLimit: RiotRateLimitSnapshot,
    now = Date.now(),
  ): Promise<void> {
    if (!this.config.enabled || !this.config.observeHeaders) {
      return;
    }

    const appLimits = rateLimit.appRateLimit;
    const appCounts = rateLimit.appRateLimitCount;
    if (!appLimits || appLimits.length === 0) {
      return;
    }

    let shortLimit: number | null = null;
    let longLimit: number | null = null;
    let shortCount: number | null = null;
    let longCount: number | null = null;

    for (const window of appLimits) {
      if (window.windowSeconds <= 2) {
        shortLimit = window.requests;
      } else if (window.windowSeconds >= 60) {
        longLimit = window.requests;
      }
    }
    if (appCounts) {
      for (const window of appCounts) {
        if (window.windowSeconds <= 2) {
          shortCount = window.requests;
        } else if (window.windowSeconds >= 60) {
          longCount = window.requests;
        }
      }
    }

    if (shortLimit != null) {
      this.observedShortLimit = shortLimit;
    }
    if (longLimit != null) {
      this.observedLongLimit = longLimit;
    }

    const keys = this.keys();
    if (this.redis.hmset) {
      const fields: string[] = [];
      if (shortLimit != null) {
        fields.push('shortLimit', String(shortLimit));
      }
      if (longLimit != null) {
        fields.push('longLimit', String(longLimit));
      }
      if (shortCount != null) {
        fields.push('shortCount', String(shortCount));
      }
      if (longCount != null) {
        fields.push('longCount', String(longCount));
      }
      fields.push('updatedAt', String(now));
      if (fields.length > 0) {
        await this.redis.hmset(keys.observed, ...fields);
        if (this.redis.pexpire) {
          await this.redis.pexpire(keys.observed, this.config.longWindowSeconds * 1000);
        }
      }
    }

    const effShort = this.effectiveShortLimit();
    const effLong = this.effectiveLongLimit();
    const shortPressure =
      shortCount != null && shortLimit != null && shortCount >= effShort;
    const longPressure = longCount != null && longLimit != null && longCount >= effLong;

    if ((shortPressure || longPressure) && this.redis.set) {
      const pressureMs = shortPressure
        ? this.config.shortWindowSeconds * 1000
        : this.config.longWindowSeconds * 1000;
      const until = now + Math.min(pressureMs, 5_000);
      await this.redis.set(keys.pressure, String(until), 'PX', Math.min(pressureMs, 5_000));
    }
  }

  async observeResponseMetadata(metadata: RiotResponseMetadata): Promise<void> {
    await this.observeRateLimitHeaders(metadata.rateLimit);
  }

  async getMetricsSnapshot(): Promise<RiotRequestBudgetMetricsSnapshot> {
    const keys = this.keys();
    const raw =
      this.redis.hgetall != null ? await this.redis.hgetall(keys.metrics) : ({} as Record<string, string>);
    const num = (field: string) => {
      const value = Number(raw[field] ?? 0);
      return Number.isFinite(value) ? value : 0;
    };

    const byWorkload: Partial<Record<RiotRequestWorkload, number>> = {};
    for (const workload of [
      'match',
      'refresh',
      'enrichment',
      'ladder',
      'identity',
      'product',
      'unknown',
    ] as const) {
      const count = num(`admitted:${workload}`);
      if (count > 0) {
        byWorkload[workload] = count;
      }
    }

    return {
      admitted: num('admitted'),
      delayed: num('delayed'),
      deferred: num('deferred'),
      cooldownBlocked: num('cooldownBlocked'),
      headerPressure: num('headerPressure'),
      starvation: num('starvation'),
      byWorkload,
      delayedMsTotal: num('delayedMsTotal'),
      shortUtilization: null,
      longUtilization: null,
    };
  }
}

/** Gate used by {@link RiotApiClient} before sending HTTP. */
export type RiotRequestBudgetGate = {
  acquireForRequest(input: {
    category: RiotEndpointCategory;
    workload?: RiotRequestWorkload | null;
    sleepFn: SleepFn;
  }): Promise<{ waitedMs: number; workload: RiotRequestWorkload }>;
  observeResponse?(metadata: RiotResponseMetadata): Promise<void>;
};

export function createRiotRequestBudgetGate(
  store: RiotRequestBudgetStore | null | undefined,
): RiotRequestBudgetGate | null {
  if (!store || !store.getConfig().enabled) {
    return null;
  }

  return {
    async acquireForRequest(input) {
      const workload = resolveRiotRequestWorkload({
        explicit: input.workload,
        category: input.category,
      });
      const result = await store.acquireOrDefer({
        workload,
        sleepFn: input.sleepFn,
      });
      return { waitedMs: result.waitedMs, workload: result.workload };
    },
    async observeResponse(metadata) {
      await store.observeResponseMetadata(metadata);
    },
  };
}
