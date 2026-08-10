import { describe, expect, it } from 'vitest';
import {
  computeEffectiveCooldownDurationMs,
  computeProposedCooldownUntil,
  isSharedCooldownActive,
  sharedCooldownRemainingMs,
  DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
  RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV,
  RIOT_SHARED_429_COOLDOWN_REDIS_KEY,
  RiotSharedCooldownStore,
  type SharedCooldownRedisClient,
} from './riot-shared-cooldown';

describe('riot shared 429 cooldown helpers', () => {
  it('exports redis key, default floor, and env name recommendation', () => {
    expect(RIOT_SHARED_429_COOLDOWN_REDIS_KEY).toBe('riot:shared-429-cooldown');
    expect(DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS).toBe(15 * 60_000);
    expect(RIOT_SHARED_429_COOLDOWN_MIN_MS_ENV).toBe('RIOT_SHARED_429_COOLDOWN_MIN_MS');
  });

  it('A: floor wins when Retry-After is shorter', () => {
    expect(computeEffectiveCooldownDurationMs(60_000, 20_000)).toBe(60_000);
    expect(computeProposedCooldownUntil(1_000_000, 60_000, 20_000)).toBe(1_060_000);
  });

  it('B: Retry-After wins when longer than floor', () => {
    expect(computeEffectiveCooldownDurationMs(60_000, 120_000)).toBe(120_000);
    expect(computeProposedCooldownUntil(1_000_000, 60_000, 120_000)).toBe(1_120_000);
  });

  it('C: absent Retry-After uses floor', () => {
    expect(computeEffectiveCooldownDurationMs(60_000)).toBe(60_000);
    expect(computeEffectiveCooldownDurationMs(60_000, undefined)).toBe(60_000);
    expect(computeProposedCooldownUntil(1_000_000, 60_000)).toBe(1_060_000);
  });

  it('D: null / non-finite Retry-After uses floor', () => {
    expect(computeEffectiveCooldownDurationMs(60_000, null)).toBe(60_000);
    expect(computeEffectiveCooldownDurationMs(60_000, Number.NaN)).toBe(60_000);
    expect(computeEffectiveCooldownDurationMs(60_000, Number.POSITIVE_INFINITY)).toBe(60_000);
    expect(computeEffectiveCooldownDurationMs(60_000, -5)).toBe(60_000);
  });

  it('treats non-finite floor as 0', () => {
    expect(computeEffectiveCooldownDurationMs(Number.NaN, 12_000)).toBe(12_000);
    expect(computeEffectiveCooldownDurationMs(-10, null)).toBe(0);
  });

  it('computes active / remaining from cooldownUntil without sleeping', () => {
    expect(isSharedCooldownActive(null, 1000)).toBe(false);
    expect(isSharedCooldownActive(1000, 1000)).toBe(false);
    expect(isSharedCooldownActive(1001, 1000)).toBe(true);
    expect(sharedCooldownRemainingMs(null, 1000)).toBe(0);
    expect(sharedCooldownRemainingMs(1500, 1000)).toBe(500);
    expect(sharedCooldownRemainingMs(900, 1000)).toBe(0);
  });
});

/** In-memory Redis that enforces the same monotonic-max semantics as the Lua script. */
class MemorySharedCooldownRedis implements SharedCooldownRedisClient {
  readonly values = new Map<string, string>();
  evalCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    void script;
    this.evalCalls += 1;
    if (numKeys !== 1) {
      throw new Error(`expected 1 key, got ${numKeys}`);
    }
    const key = String(args[0]);
    const proposed = Number(args[1]);
    if (!Number.isFinite(proposed)) {
      throw new Error('invalid proposedCooldownUntil');
    }

    const existingRaw = this.values.get(key);
    const existing = existingRaw === undefined ? null : Number(existingRaw);
    const existingNum = existing !== null && Number.isFinite(existing) ? existing : null;

    if (existingNum !== null && existingNum >= proposed) {
      return [String(existingNum), 0, String(existingNum)];
    }

    this.values.set(key, String(proposed));
    return [String(proposed), 1, existingNum === null ? '' : String(existingNum)];
  }
}

describe('RiotSharedCooldownStore (in-memory redis semantics)', () => {
  it('E: existing later than proposal remains', async () => {
    const redis = new MemorySharedCooldownRedis();
    const store = new RiotSharedCooldownStore(redis);
    const now = 1_000_000;

    const first = await store.extendCooldown({
      now,
      configuredFloorMs: 120_000,
      retryAfterMs: null,
      source: 'collector',
    });
    expect(first).toEqual({
      cooldownUntil: 1_120_000,
      extended: true,
      previousCooldownUntil: null,
    });

    const second = await store.extendCooldown({
      now,
      configuredFloorMs: 60_000,
      retryAfterMs: 20_000,
      source: 'ladder',
    });
    expect(second).toEqual({
      cooldownUntil: 1_120_000,
      extended: false,
      previousCooldownUntil: 1_120_000,
    });
    expect(await store.getCooldownState()).toEqual({ cooldownUntil: 1_120_000 });
  });

  it('F: later proposal extends existing earlier cooldown', async () => {
    const redis = new MemorySharedCooldownRedis();
    const store = new RiotSharedCooldownStore(redis);
    const now = 1_000_000;

    await store.extendCooldown({
      now,
      configuredFloorMs: 60_000,
      retryAfterMs: null,
    });

    const extended = await store.extendCooldown({
      now,
      configuredFloorMs: 60_000,
      retryAfterMs: 180_000,
    });
    expect(extended).toEqual({
      cooldownUntil: 1_180_000,
      extended: true,
      previousCooldownUntil: 1_060_000,
    });
  });

  it('reports cooling-down and remainingMs from stored state', async () => {
    const redis = new MemorySharedCooldownRedis();
    const store = new RiotSharedCooldownStore(redis);

    expect(await store.isCoolingDown(1_000_000)).toBe(false);
    expect(await store.remainingMs(1_000_000)).toBe(0);

    await store.extendCooldown({
      now: 1_000_000,
      configuredFloorMs: 60_000,
      retryAfterMs: null,
    });

    expect(await store.isCoolingDown(1_030_000)).toBe(true);
    expect(await store.remainingMs(1_030_000)).toBe(30_000);
    expect(await store.isCoolingDown(1_060_000)).toBe(false);
    expect(await store.remainingMs(1_060_000)).toBe(0);
  });

  it('concurrent writers keep the later cooldown regardless of order', async () => {
    const redis = new MemorySharedCooldownRedis();
    const store = new RiotSharedCooldownStore(redis);
    const now = 2_000_000;

    const earlierProposal = store.extendCooldown({
      now,
      configuredFloorMs: 30_000,
      retryAfterMs: null,
      source: 'writer-a',
    });
    const laterProposal = store.extendCooldown({
      now,
      configuredFloorMs: 90_000,
      retryAfterMs: null,
      source: 'writer-b',
    });

    const results = await Promise.all([earlierProposal, laterProposal]);
    const finals = results.map((r) => r.cooldownUntil);
    expect(Math.max(...finals)).toBe(2_090_000);
    expect(await store.getCooldownState()).toEqual({ cooldownUntil: 2_090_000 });
    expect(redis.evalCalls).toBe(2);
  });

  it('two concurrent extendCooldown calls settle to max proposed', async () => {
    const redis = new MemorySharedCooldownRedis();
    const store = new RiotSharedCooldownStore(redis);
    const now = 3_000_000;

    const [a, b] = await Promise.all([
      store.extendCooldown({ now, configuredFloorMs: 10_000, retryAfterMs: 40_000 }),
      store.extendCooldown({ now, configuredFloorMs: 10_000, retryAfterMs: 70_000 }),
    ]);

    expect(Math.max(a.cooldownUntil, b.cooldownUntil)).toBe(3_070_000);
    expect((await store.getCooldownState()).cooldownUntil).toBe(3_070_000);
  });

  it('uses EVAL for extend writes (no app-level read-compare-write)', async () => {
    const redis = new MemorySharedCooldownRedis();
    const store = new RiotSharedCooldownStore(redis);
    await store.extendCooldown({ now: 1, configuredFloorMs: 1000, retryAfterMs: null });
    expect(redis.evalCalls).toBe(1);
  });

  it('ignores malformed stored values and treats them as empty', async () => {
    const redis = new MemorySharedCooldownRedis();
    redis.values.set(RIOT_SHARED_429_COOLDOWN_REDIS_KEY, 'not-a-number');
    const store = new RiotSharedCooldownStore(redis);
    expect(await store.getCooldownState()).toEqual({ cooldownUntil: null });
    expect(await store.isCoolingDown(1000)).toBe(false);
  });
});
