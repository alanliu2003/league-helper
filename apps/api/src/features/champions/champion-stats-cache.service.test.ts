import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ChampionStatsCacheService } from './champion-stats-cache.service';

const scope = {
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
  platform: 'na1' as const,
  patch: '14.1',
  queueId: 420,
};

describe('ChampionStatsCacheService', () => {
  const redis = {
    get: vi.fn(),
    set: vi.fn(),
  };

  const config = {
    cacheTtlSeconds: 60,
  };

  beforeEach(() => {
    redis.get.mockReset();
    redis.set.mockReset();
  });

  it('returns 0 and continues when Redis generation read fails', async () => {
    redis.get.mockRejectedValueOnce(new Error('redis down'));
    const service = new ChampionStatsCacheService(redis as never, config as never);
    await expect(service.getGeneration(scope)).resolves.toBe(0);
  });

  it('returns null on corrupt cache payload without throwing', async () => {
    redis.get.mockResolvedValueOnce('{not-json');
    const service = new ChampionStatsCacheService(redis as never, config as never);
    await expect(service.getParsed('k', z.object({ ok: z.boolean() }))).resolves.toBeNull();
  });

  it('writes when generation is unchanged', async () => {
    redis.get.mockResolvedValueOnce('3');
    redis.set.mockResolvedValueOnce('OK');
    const service = new ChampionStatsCacheService(redis as never, config as never);

    const result = await service.setIfGenerationCurrent({
      scope,
      expectedGeneration: 3,
      buildKey: (generation) => `champ_stats:table:${generation}`,
      value: { rows: [] },
    });

    expect(result).toBe('written');
    expect(redis.set).toHaveBeenCalledWith(
      'champ_stats:table:3',
      JSON.stringify({ rows: [] }),
      'EX',
      60,
    );
  });

  it('skips write when generation advanced (does not store stale payload)', async () => {
    redis.get.mockResolvedValueOnce('4');
    const service = new ChampionStatsCacheService(redis as never, config as never);

    const result = await service.setIfGenerationCurrent({
      scope,
      expectedGeneration: 3,
      buildKey: (generation) => `champ_stats:table:${generation}`,
      value: { rows: [{ id: 1 }] },
    });

    expect(result).toBe('skipped');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('treats Redis write failures as non-fatal', async () => {
    redis.get.mockResolvedValueOnce('1');
    redis.set.mockRejectedValueOnce(new Error('write fail'));
    const service = new ChampionStatsCacheService(redis as never, config as never);

    await expect(
      service.setIfGenerationCurrent({
        scope,
        expectedGeneration: 1,
        buildKey: (generation) => `k:${generation}`,
        value: {},
      }),
    ).resolves.toBe('failed');
  });
});
