import { describe, expect, it, vi } from 'vitest';
import {
  effectiveWindowLimit,
  loadRiotRequestBudgetConfig,
} from './riot-request-budget-config';
import {
  RiotRequestBudgetDeferredError,
  isRiotRequestBudgetDeferredError,
} from './riot-request-budget-deferred.error';
import {
  RESERVE_RIOT_REQUEST_BUDGET_LUA,
  RiotRequestBudgetStore,
  createRiotRequestBudgetGate,
  type RequestBudgetRedisClient,
} from './riot-request-budget';
import { withRiotWorkload } from './riot-request-workload';
import { RIOT_SHARED_429_COOLDOWN_REDIS_KEY } from './riot-shared-cooldown';

type ZMember = { member: string; score: number };

/** In-memory Redis implementing the reserve Lua semantics used by the budget store. */
class MemoryBudgetRedis implements RequestBudgetRedisClient {
  readonly strings = new Map<string, string>();
  readonly hashes = new Map<string, Map<string, string>>();
  readonly zsets = new Map<string, ZMember[]>();
  evalCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) {
      return {};
    }
    return Object.fromEntries(hash.entries());
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const next = (Number(hash.get(field) ?? 0) || 0) + increment;
    hash.set(field, String(next));
    this.hashes.set(key, hash);
    return next;
  }

  async hmset(key: string, ...args: Array<string | number>): Promise<unknown> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      hash.set(String(args[i]), String(args[i + 1]));
    }
    this.hashes.set(key, hash);
    return 'OK';
  }

  async pexpire(_key: string, _ms: number): Promise<unknown> {
    return 1;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<unknown> {
    this.strings.set(key, value);
    void args;
    return 'OK';
  }

  private zcard(key: string): number {
    return this.zsets.get(key)?.length ?? 0;
  }

  private zremrangebyscore(key: string, min: number, max: number): void {
    const members = this.zsets.get(key) ?? [];
    this.zsets.set(
      key,
      members.filter((entry) => entry.score < min || entry.score > max),
    );
  }

  private zadd(key: string, score: number, member: string): void {
    const members = this.zsets.get(key) ?? [];
    const filtered = members.filter((entry) => entry.member !== member);
    filtered.push({ member, score });
    filtered.sort((a, b) => a.score - b.score);
    this.zsets.set(key, filtered);
  }

  private zrangeWithScores(key: string, start: number, stop: number): Array<string | number> {
    const members = this.zsets.get(key) ?? [];
    const slice = members.slice(start, stop + 1);
    const out: Array<string | number> = [];
    for (const entry of slice) {
      out.push(entry.member, entry.score);
    }
    return out;
  }

  async eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.evalCalls += 1;
    expect(script).toContain('ZADD');
    expect(numKeys).toBe(6);

    const shortKey = String(args[0]);
    const longKey = String(args[1]);
    const enrichKey = String(args[2]);
    const metricsKey = String(args[3]);
    const cooldownKey = String(args[4]);
    const pressureKey = String(args[5]);
    const now = Number(args[6]);
    const shortLimit = Number(args[7]);
    const shortWindowMs = Number(args[8]);
    const longLimit = Number(args[9]);
    const longWindowMs = Number(args[10]);
    const workload = String(args[11]);
    const enrichmentMaxShare = Number(args[12]);
    const productReservedShare = Number(args[13]);
    const requestId = String(args[14]);

    void RESERVE_RIOT_REQUEST_BUDGET_LUA;

    const cd = Number(this.strings.get(cooldownKey));
    if (Number.isFinite(cd) && cd > now) {
      await this.hincrby(metricsKey, 'cooldownBlocked', 1);
      return [0, String(cd - now), 'cooldown', 0, 0];
    }

    const pressureUntil = Number(this.strings.get(pressureKey));
    if (Number.isFinite(pressureUntil) && pressureUntil > now) {
      await this.hincrby(metricsKey, 'headerPressure', 1);
      await this.hincrby(metricsKey, 'delayed', 1);
      return [0, String(pressureUntil - now), 'header_pressure', 0, 0];
    }

    this.zremrangebyscore(shortKey, Number.NEGATIVE_INFINITY, now - shortWindowMs);
    const shortCount = this.zcard(shortKey);
    if (shortCount >= shortLimit) {
      const oldest = this.zrangeWithScores(shortKey, 0, 0);
      const wait =
        oldest[1] != null
          ? Math.max(1, Number(oldest[1]) + shortWindowMs - now)
          : shortWindowMs;
      await this.hincrby(metricsKey, 'delayed', 1);
      await this.hincrby(metricsKey, 'delayedMsTotal', wait);
      return [0, String(wait), 'short_window', shortCount, 0];
    }

    this.zremrangebyscore(longKey, Number.NEGATIVE_INFINITY, now - longWindowMs);
    const longCount = this.zcard(longKey);
    if (longCount >= longLimit) {
      const oldest = this.zrangeWithScores(longKey, 0, 0);
      const wait =
        oldest[1] != null ? Math.max(1, Number(oldest[1]) + longWindowMs - now) : longWindowMs;
      await this.hincrby(metricsKey, 'delayed', 1);
      await this.hincrby(metricsKey, 'delayedMsTotal', wait);
      return [0, String(wait), 'long_window', shortCount, longCount];
    }

    if (workload !== 'product' && productReservedShare > 0) {
      const nonProductCap = Math.max(1, Math.floor(shortLimit * (1 - productReservedShare)));
      if (shortCount >= nonProductCap) {
        const oldest = this.zrangeWithScores(shortKey, 0, 0);
        const wait =
          oldest[1] != null
            ? Math.max(1, Number(oldest[1]) + shortWindowMs - now)
            : shortWindowMs;
        await this.hincrby(metricsKey, 'delayed', 1);
        await this.hincrby(metricsKey, 'starvation', 1);
        return [0, String(wait), 'product_reserve', shortCount, longCount];
      }
    }

    if (workload === 'enrichment') {
      this.zremrangebyscore(enrichKey, Number.NEGATIVE_INFINITY, now - shortWindowMs);
      const enrichCount = this.zcard(enrichKey);
      const enrichCap = Math.max(1, Math.floor(shortLimit * enrichmentMaxShare));
      if (enrichCount >= enrichCap) {
        const oldest = this.zrangeWithScores(enrichKey, 0, 0);
        const wait =
          oldest[1] != null
            ? Math.max(1, Number(oldest[1]) + shortWindowMs - now)
            : shortWindowMs;
        await this.hincrby(metricsKey, 'delayed', 1);
        await this.hincrby(metricsKey, 'starvation', 1);
        return [0, String(wait), 'enrichment_share', shortCount, longCount];
      }
    }

    this.zadd(shortKey, now, requestId);
    this.zadd(longKey, now, requestId);
    if (workload === 'enrichment') {
      this.zadd(enrichKey, now, requestId);
    }
    await this.hincrby(metricsKey, 'admitted', 1);
    await this.hincrby(metricsKey, `admitted:${workload}`, 1);
    return [1, '0', 'admitted', shortCount + 1, longCount + 1];
  }
}

function createStore(
  redis: MemoryBudgetRedis,
  overrides?: Partial<ReturnType<typeof loadRiotRequestBudgetConfig>>,
): RiotRequestBudgetStore {
  return new RiotRequestBudgetStore(redis, {
    config: {
      ...loadRiotRequestBudgetConfig({
        RIOT_REQUEST_BUDGET_ENABLED: 'true',
        RIOT_REQUEST_BUDGET_UTILIZATION: '0.75',
        RIOT_REQUEST_BUDGET_SHORT_LIMIT: '20',
        RIOT_REQUEST_BUDGET_SHORT_WINDOW_SECONDS: '1',
        RIOT_REQUEST_BUDGET_LONG_LIMIT: '100',
        RIOT_REQUEST_BUDGET_LONG_WINDOW_SECONDS: '120',
        RIOT_REQUEST_BUDGET_ENRICHMENT_MAX_SHARE: '0.35',
        RIOT_REQUEST_BUDGET_PRODUCT_RESERVED_SHARE: '0.10',
        RIOT_REQUEST_BUDGET_MAX_INLINE_WAIT_MS: '50',
        RIOT_REQUEST_BUDGET_OBSERVE_HEADERS: 'true',
      }),
      ...overrides,
    },
  });
}

describe('loadRiotRequestBudgetConfig', () => {
  it('defaults to developer-key windows with 0.75 utilization headroom', () => {
    const config = loadRiotRequestBudgetConfig({});
    expect(config.enabled).toBe(true);
    expect(config.utilization).toBe(0.75);
    expect(config.shortLimit).toBe(20);
    expect(config.shortWindowSeconds).toBe(1);
    expect(config.longLimit).toBe(100);
    expect(config.longWindowSeconds).toBe(120);
    expect(effectiveWindowLimit(20, 0.75)).toBe(15);
    expect(effectiveWindowLimit(100, 0.75)).toBe(75);
  });
});

describe('RiotRequestBudgetStore', () => {
  it('admits concurrent reservations atomically up to short-window limit', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 1,
      shortLimit: 3,
      productReservedShare: 0,
      enrichmentMaxShare: 1,
    });

    const now = 1_000_000;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.reserve({ workload: 'match', now, requestId: `r${i}` }),
      ),
    );

    const admitted = results.filter((result) => result.admitted);
    const denied = results.filter((result) => !result.admitted);
    expect(admitted).toHaveLength(3);
    expect(denied).toHaveLength(2);
    expect(denied.every((result) => !result.admitted && result.reason === 'short_window')).toBe(
      true,
    );
  });

  it('enforces long-window limit independently of short window', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 1,
      shortLimit: 100,
      longLimit: 2,
      productReservedShare: 0,
      enrichmentMaxShare: 1,
    });

    const now = 2_000_000;
    expect((await store.reserve({ workload: 'match', now, requestId: 'a' })).admitted).toBe(true);
    expect((await store.reserve({ workload: 'match', now: now + 1, requestId: 'b' })).admitted).toBe(
      true,
    );
    const denied = await store.reserve({ workload: 'match', now: now + 2, requestId: 'c' });
    expect(denied.admitted).toBe(false);
    if (!denied.admitted) {
      expect(denied.reason).toBe('long_window');
    }
  });

  it('applies utilization headroom before admitting', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 0.5,
      shortLimit: 4,
      productReservedShare: 0,
      enrichmentMaxShare: 1,
    });
    // effective short = 2
    const now = 3_000_000;
    expect((await store.reserve({ workload: 'match', now, requestId: '1' })).admitted).toBe(true);
    expect((await store.reserve({ workload: 'match', now: now + 1, requestId: '2' })).admitted).toBe(
      true,
    );
    const denied = await store.reserve({ workload: 'match', now: now + 2, requestId: '3' });
    expect(denied.admitted).toBe(false);
  });

  it('cooldown overrides budget and blocks reservations', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis);
    const now = 4_000_000;
    redis.strings.set(RIOT_SHARED_429_COOLDOWN_REDIS_KEY, String(now + 15_000));

    const result = await store.reserve({ workload: 'match', now, requestId: 'cd' });
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.reason).toBe('cooldown');
      expect(result.waitMs).toBe(15_000);
    }
  });

  it('resumes naturally after cooldown expires', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, { productReservedShare: 0, enrichmentMaxShare: 1 });
    const now = 5_000_000;
    redis.strings.set(RIOT_SHARED_429_COOLDOWN_REDIS_KEY, String(now + 10));

    expect((await store.reserve({ workload: 'match', now, requestId: 'blocked' })).admitted).toBe(
      false,
    );
    expect(
      (await store.reserve({ workload: 'match', now: now + 11, requestId: 'ok' })).admitted,
    ).toBe(true);
  });

  it('prevents enrichment from consuming all short-window capacity', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 1,
      shortLimit: 10,
      enrichmentMaxShare: 0.3,
      productReservedShare: 0,
    });
    const now = 6_000_000;
    // enrichCap = floor(10 * 0.3) = 3
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await store.reserve({ workload: 'enrichment', now, requestId: `e${i}` })).admitted,
      ).toBe(true);
    }
    const denied = await store.reserve({ workload: 'enrichment', now, requestId: 'e3' });
    expect(denied.admitted).toBe(false);
    if (!denied.admitted) {
      expect(denied.reason).toBe('enrichment_share');
    }

    // Match workload can still acquire.
    expect((await store.reserve({ workload: 'match', now, requestId: 'm1' })).admitted).toBe(true);
  });

  it('reserves capacity so product/search can still acquire under load', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 1,
      shortLimit: 10,
      productReservedShare: 0.2,
      enrichmentMaxShare: 1,
    });
    const now = 7_000_000;
    // nonProductCap = floor(10 * 0.8) = 8
    for (let i = 0; i < 8; i += 1) {
      expect((await store.reserve({ workload: 'match', now, requestId: `m${i}` })).admitted).toBe(
        true,
      );
    }
    const deniedMatch = await store.reserve({ workload: 'match', now, requestId: 'm8' });
    expect(deniedMatch.admitted).toBe(false);
    if (!deniedMatch.admitted) {
      expect(deniedMatch.reason).toBe('product_reserve');
    }

    expect((await store.reserve({ workload: 'product', now, requestId: 'p1' })).admitted).toBe(
      true,
    );
  });

  it('throws deferred error when wait exceeds inline budget (no 429 cooldown publish)', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 1,
      shortLimit: 1,
      productReservedShare: 0,
      enrichmentMaxShare: 1,
      maxInlineWaitMs: 10,
      shortWindowSeconds: 2,
    });
    const sleepFn = vi.fn(async () => undefined);
    const now = Date.now();
    expect((await store.reserve({ workload: 'match', now, requestId: 'first' })).admitted).toBe(
      true,
    );

    await expect(
      store.acquireOrDefer({ workload: 'match', now, sleepFn, maxInlineWaitMs: 10 }),
    ).rejects.toBeInstanceOf(RiotRequestBudgetDeferredError);

    expect(
      isRiotRequestBudgetDeferredError(
        new RiotRequestBudgetDeferredError({
          waitMs: 100,
          reason: 'short_window',
          workload: 'match',
        }),
      ),
    ).toBe(true);
  });

  it('updates header pressure from app rate-limit counts and falls back when headers missing', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 0.75,
      shortLimit: 20,
      productReservedShare: 0,
      enrichmentMaxShare: 1,
    });

    await store.observeRateLimitHeaders({
      appRateLimit: null,
      appRateLimitCount: null,
      methodRateLimit: null,
      methodRateLimitCount: null,
      rateLimitType: null,
      retryAfterSeconds: null,
    });
    expect(
      (await store.reserve({ workload: 'match', now: 9_000_000, requestId: 'nohdr' })).admitted,
    ).toBe(true);

    await store.observeRateLimitHeaders(
      {
        appRateLimit: [
          { requests: 20, windowSeconds: 1 },
          { requests: 100, windowSeconds: 120 },
        ],
        appRateLimitCount: [
          { requests: 15, windowSeconds: 1 },
          { requests: 10, windowSeconds: 120 },
        ],
        methodRateLimit: null,
        methodRateLimitCount: null,
        rateLimitType: 'application',
        retryAfterSeconds: null,
      },
      9_100_000,
    );

    const denied = await store.reserve({ workload: 'match', now: 9_100_000, requestId: 'pressured' });
    expect(denied.admitted).toBe(false);
    if (!denied.admitted) {
      expect(denied.reason).toBe('header_pressure');
    }
  });

  it('budget gate uses AsyncLocalStorage workload context', async () => {
    const redis = new MemoryBudgetRedis();
    const store = createStore(redis, {
      utilization: 1,
      shortLimit: 10,
      enrichmentMaxShare: 0.2,
      productReservedShare: 0,
    });
    const gate = createRiotRequestBudgetGate(store);
    expect(gate).not.toBeNull();

    await withRiotWorkload('enrichment', async () => {
      for (let i = 0; i < 2; i += 1) {
        await gate!.acquireForRequest({
          category: 'league-v4',
          sleepFn: async () => undefined,
        });
      }
      await expect(
        gate!.acquireForRequest({
          category: 'league-v4',
          sleepFn: async () => undefined,
        }),
      ).rejects.toBeInstanceOf(RiotRequestBudgetDeferredError);
    });
  });
});
