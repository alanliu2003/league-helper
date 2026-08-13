import { describe, expect, it } from 'vitest';
import {
  buildChampionBuildCacheKey,
  buildChampionBuildGenerationKey,
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
      minimumSample: 30,
      includeInsufficient: false,
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

  it('does not collide ALL/UNKNOWN/HIGH/DIAMOND when tier slot uses rank-scope tokens', () => {
    const base = {
      scope: baseScope,
      generation: 1,
      position: 'MIDDLE',
      sortBy: 'winRate',
      sortDirection: 'desc' as const,
      limit: 50,
      minimumSample: 30,
      includeInsufficient: false,
    };
    const keys = [
      buildChampionStatsTableCacheKey({ ...base, tier: 'ALL' }),
      buildChampionStatsTableCacheKey({ ...base, tier: 'UNKNOWN' }),
      buildChampionStatsTableCacheKey({ ...base, tier: 'SEGMENT:HIGH' }),
      buildChampionStatsTableCacheKey({ ...base, tier: 'EXACT:DIAMOND' }),
      buildChampionStatsTableCacheKey({ ...base, tier: 'DIAMOND' }),
      buildChampionStatsTableCacheKey({ ...base, position: 'TOP', tier: 'ALL' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('builds string-only Redis keys without importing Redis clients', () => {
    const key = buildChampionStatsGenerationKey(baseScope);
    expect(typeof key).toBe('string');
    expect(key.startsWith('champ_stats:gen:')).toBe(true);
  });

  it('keeps build cache keys distinct from stats keys and across rank scopes', () => {
    const stats = buildChampionStatsChampionCacheKey({
      scope: baseScope,
      generation: 1,
      championKey: 'Ahri',
      position: 'MIDDLE',
      tier: 'ALL',
      minimumSample: 1,
      includeInsufficient: true,
    });
    const all = buildChampionBuildCacheKey({
      scope: baseScope,
      generation: 1,
      championKey: 'Ahri',
      position: 'MIDDLE',
      rankScopeToken: 'ALL',
    });
    const exact = buildChampionBuildCacheKey({
      scope: baseScope,
      generation: 1,
      championKey: 'Ahri',
      position: 'MIDDLE',
      rankScopeToken: 'EXACT:GOLD',
    });
    const segment = buildChampionBuildCacheKey({
      scope: baseScope,
      generation: 1,
      championKey: 'Ahri',
      position: 'MIDDLE',
      rankScopeToken: 'SEGMENT:HIGH',
    });
    expect(all.startsWith('champ_builds:champion:')).toBe(true);
    expect(buildChampionBuildGenerationKey(baseScope).startsWith('champ_builds:gen:')).toBe(true);
    expect(new Set([stats, all, exact, segment]).size).toBe(4);
  });
});
