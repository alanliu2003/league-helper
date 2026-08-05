import { describe, expect, it } from 'vitest';
import type { ExactChampionDimensions } from './aggregate-dimensions';
import { DEFAULT_CHAMPION_ROLLUP_POLICY, expandChampionDimensionTuples } from './rollup-policy';

const baseExact: ExactChampionDimensions = {
  patch: '16.15',
  platformRoute: 'na1',
  regionalRoute: 'americas',
  queueId: 420,
  rankTier: 'GOLD',
  position: 'MIDDLE',
  championId: 103,
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
};

describe('expandChampionDimensionTuples', () => {
  it('emits exact, ALL-tier, ALL-position only', () => {
    const tuples = expandChampionDimensionTuples(baseExact, DEFAULT_CHAMPION_ROLLUP_POLICY);
    expect(tuples).toHaveLength(3);
    expect(tuples.some((t) => t.rankTier === 'ALL' && t.position === 'ALL')).toBe(false);

    expect(tuples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rankTier: 'GOLD',
          position: 'MIDDLE',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
        }),
        expect.objectContaining({
          rankTier: 'ALL',
          position: 'MIDDLE',
        }),
        expect.objectContaining({
          rankTier: 'GOLD',
          position: 'ALL',
        }),
      ]),
    );

    const keys = new Set(
      tuples.map(
        (t) =>
          `${t.patch}|${t.platformRoute}|${t.regionalRoute}|${t.queueId}|${t.rankTier}|${t.position}|${t.championId}|${t.sourceNormalizationVersion}|${t.aggregationVersion}`,
      ),
    );
    expect(keys.size).toBe(3);
  });

  it('does not emit ALL platform, regional route, or queue under default policy', () => {
    const tuples = expandChampionDimensionTuples(baseExact, DEFAULT_CHAMPION_ROLLUP_POLICY);
    expect(tuples.every((t) => t.platformRoute === 'na1')).toBe(true);
    expect(tuples.every((t) => t.regionalRoute === 'americas')).toBe(true);
    expect(tuples.every((t) => t.queueId === 420)).toBe(true);
  });

  it('keeps UNKNOWN distinct from ALL when expanding', () => {
    const tuples = expandChampionDimensionTuples(
      { ...baseExact, rankTier: 'UNKNOWN', position: 'UNKNOWN' },
      DEFAULT_CHAMPION_ROLLUP_POLICY,
    );
    expect(tuples).toHaveLength(3);
    expect(tuples.some((t) => t.rankTier === 'UNKNOWN' && t.position === 'UNKNOWN')).toBe(true);
    expect(tuples.some((t) => t.rankTier === 'ALL' && t.position === 'UNKNOWN')).toBe(true);
    expect(tuples.some((t) => t.rankTier === 'UNKNOWN' && t.position === 'ALL')).toBe(true);
    expect(tuples.some((t) => t.rankTier === 'ALL' && t.position === 'ALL')).toBe(false);
  });
});

describe('DEFAULT_CHAMPION_ROLLUP_POLICY', () => {
  it('locks default materialization flags', () => {
    expect(DEFAULT_CHAMPION_ROLLUP_POLICY).toEqual({
      includeExact: true,
      includeAllTier: true,
      includeAllPositions: true,
      includeAllTierAndPosition: false,
      includeAllPlatform: false,
      includeAllRegionalRoute: false,
      includeAllQueue: false,
    });
  });
});
