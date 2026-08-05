import { describe, expect, it } from 'vitest';
import {
  buildChampionStatsChampionCacheKey,
  buildChampionStatsFiltersCacheKey,
  buildChampionStatsGenerationKey,
  buildChampionStatsTableCacheKey,
  serializeChampionStatsGenerationScope,
  type ChampionStatsGenerationScope,
} from './champion-stats-cache';

const baseScope: ChampionStatsGenerationScope = {
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
  platform: 'na1',
  patch: '14.1',
  queueId: 420,
};

describe('champion stats cache keys', () => {
  it('serializes generation scope in a stable fixed order', () => {
    const a = serializeChampionStatsGenerationScope(baseScope);
    const b = serializeChampionStatsGenerationScope({
      queueId: 420,
      patch: '14.1',
      platform: 'na1',
      aggregationVersion: '1',
      sourceNormalizationVersion: '1',
    });

    expect(a).toBe(b);
    expect(a).toBe(JSON.stringify(['1', '1', 'na1', '14.1', 420]));
  });

  it('isolates generation keys across platform, patch, queue, and versions', () => {
    const base = buildChampionStatsGenerationKey(baseScope);

    expect(buildChampionStatsGenerationKey({ ...baseScope, platform: 'euw1' })).not.toBe(base);
    expect(buildChampionStatsGenerationKey({ ...baseScope, patch: '14.2' })).not.toBe(base);
    expect(buildChampionStatsGenerationKey({ ...baseScope, queueId: 440 })).not.toBe(base);
    expect(
      buildChampionStatsGenerationKey({ ...baseScope, sourceNormalizationVersion: '2' }),
    ).not.toBe(base);
    expect(buildChampionStatsGenerationKey({ ...baseScope, aggregationVersion: '2' })).not.toBe(
      base,
    );
  });

  it('rejects SQL sentinels for platform and queue in key builders', () => {
    expect(() =>
      buildChampionStatsGenerationKey({ ...baseScope, platform: '' as 'na1' }),
    ).toThrow();
    expect(() =>
      buildChampionStatsGenerationKey({ ...baseScope, platform: 'ALL' as 'na1' }),
    ).toThrow();
    expect(() => buildChampionStatsGenerationKey({ ...baseScope, queueId: -1 })).toThrow();
  });

  it('does not collide table vs single-champion vs filters cache keys', () => {
    const generation = 7;
    const table = buildChampionStatsTableCacheKey({
      scope: baseScope,
      generation,
      position: 'MIDDLE',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
      offset: 0,
      minimumSample: 30,
      includeInsufficient: false,
    });
    const champion = buildChampionStatsChampionCacheKey({
      scope: baseScope,
      generation,
      championKey: 'Ahri',
      position: 'MIDDLE',
      tier: 'ALL',
    });
    const filters = buildChampionStatsFiltersCacheKey({
      scope: baseScope,
      generation,
    });

    expect(table).not.toBe(champion);
    expect(table).not.toBe(filters);
    expect(champion).not.toBe(filters);
    expect(table.startsWith('champ_stats:table:')).toBe(true);
    expect(champion.startsWith('champ_stats:champion:')).toBe(true);
    expect(filters.startsWith('champ_stats:filters:')).toBe(true);
  });

  it('builds string-only Redis keys without importing Redis clients', () => {
    const key = buildChampionStatsGenerationKey(baseScope);
    expect(typeof key).toBe('string');
    expect(key.startsWith('champ_stats:gen:')).toBe(true);
  });
});
