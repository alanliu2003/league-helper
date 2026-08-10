import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RIOT_SHARED_429_COOLDOWN_REDIS_KEY,
  RiotSharedCooldownStore,
} from './riot-shared-cooldown';

const redisUrl = (process.env.REDIS_URL ?? 'redis://localhost:6379').trim();
const testKey = `${RIOT_SHARED_429_COOLDOWN_REDIS_KEY}:test:${process.pid}:${Date.now()}`;

type IoredisClient = {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<'OK'>;
  ping(): Promise<string>;
};

describe('RiotSharedCooldownStore (redis integration)', () => {
  let redis: IoredisClient | null = null;
  let store: RiotSharedCooldownStore | null = null;

  beforeAll(async () => {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
    });
    await client.connect();
    await client.ping();
    redis = client as unknown as IoredisClient;
    store = new RiotSharedCooldownStore(redis, { redisKey: testKey });
  });

  beforeEach(async () => {
    if (!redis) {
      throw new Error('Redis client was not initialized');
    }
    await redis.del(testKey);
  });

  afterAll(async () => {
    if (redis) {
      await redis.del(testKey);
      await redis.quit();
    }
  });

  it('persists epoch-ms cooldownUntil via Lua monotonic extend', async () => {
    if (!redis || !store) {
      throw new Error('Redis integration store unavailable');
    }

    const now = 1_700_000_000_000;
    const first = await store.extendCooldown({
      now,
      configuredFloorMs: 60_000,
      retryAfterMs: 20_000,
      source: 'integration',
    });
    expect(first).toEqual({
      cooldownUntil: now + 60_000,
      extended: true,
      previousCooldownUntil: null,
    });

    const stored = await redis.get(testKey);
    expect(stored).toBe(String(now + 60_000));

    const shortened = await store.extendCooldown({
      now,
      configuredFloorMs: 10_000,
      retryAfterMs: null,
    });
    expect(shortened.extended).toBe(false);
    expect(shortened.cooldownUntil).toBe(now + 60_000);

    const lengthened = await store.extendCooldown({
      now,
      configuredFloorMs: 60_000,
      retryAfterMs: 120_000,
    });
    expect(lengthened).toEqual({
      cooldownUntil: now + 120_000,
      extended: true,
      previousCooldownUntil: now + 60_000,
    });
    expect(await redis.get(testKey)).toBe(String(now + 120_000));
  });

  it('concurrent real Redis writers settle on max proposed', async () => {
    if (!redis || !store) {
      throw new Error('Redis integration store unavailable');
    }

    const now = 1_700_000_100_000;
    const results = await Promise.all([
      store.extendCooldown({ now, configuredFloorMs: 15_000, retryAfterMs: null }),
      store.extendCooldown({ now, configuredFloorMs: 45_000, retryAfterMs: null }),
      store.extendCooldown({ now, configuredFloorMs: 25_000, retryAfterMs: 80_000 }),
    ]);

    expect(Math.max(...results.map((r) => r.cooldownUntil))).toBe(now + 80_000);
    expect((await store.getCooldownState()).cooldownUntil).toBe(now + 80_000);
    expect(await redis.get(testKey)).toBe(String(now + 80_000));
  });
});
