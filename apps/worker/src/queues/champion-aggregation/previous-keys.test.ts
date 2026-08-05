import { describe, expect, it } from 'vitest';
import {
  buildChampionAggregateDimensionKey,
  expandChampionDimensionTuples,
  type ExactChampionDimensions,
} from '@league-helper/match-analytics';
import {
  expandCurrentDimensionKeys,
  expandPreviousDimensionKeys,
  mergeRecalcScopeKeys,
  unionDimensionKeys,
  type PreviousParticipantDimensionSnapshot,
} from './previous-keys.js';

const VERSIONS = { sourceNormalizationVersion: '1', aggregationVersion: '1' };

function snapshot(
  overrides: Partial<PreviousParticipantDimensionSnapshot> = {},
): PreviousParticipantDimensionSnapshot {
  return {
    patch: '14.1',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    remake: false,
    championId: 103,
    teamPosition: 'MIDDLE',
    individualPosition: 'MIDDLE',
    lane: 'MIDDLE',
    role: 'SOLO',
    rankTierAtIngestion: 'GOLD',
    ...overrides,
  };
}

describe('previous-keys', () => {
  it('expands default rollup to exact + ALL tier + ALL position (3 keys)', () => {
    const keys = expandPreviousDimensionKeys([snapshot()], VERSIONS);
    expect(keys).toHaveLength(3);

    const exact: ExactChampionDimensions = {
      patch: '14.1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      rankTier: 'GOLD',
      position: 'MIDDLE',
      championId: 103,
      ...VERSIONS,
    };
    const expected = expandChampionDimensionTuples(exact).map(buildChampionAggregateDimensionKey);
    expect(keys).toEqual([...expected].sort());
  });

  it('unions previous and current keys for SUPPORT→MIDDLE correction', () => {
    const previous = expandPreviousDimensionKeys(
      [
        snapshot({
          teamPosition: 'UTILITY',
          individualPosition: 'UTILITY',
          lane: 'BOTTOM',
          role: 'DUO_SUPPORT',
        }),
      ],
      VERSIONS,
    );
    const currentExact: ExactChampionDimensions = {
      patch: '14.1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      rankTier: 'GOLD',
      position: 'MIDDLE',
      championId: 103,
      ...VERSIONS,
    };
    const current = expandCurrentDimensionKeys([currentExact]);
    const union = unionDimensionKeys(previous, current);

    expect(previous.some((key) => key.includes('"SUPPORT"'))).toBe(true);
    expect(current.some((key) => key.includes('"MIDDLE"'))).toBe(true);
    expect(union.length).toBeGreaterThan(previous.length);
    expect(union).toEqual([...new Set([...previous, ...current])].sort());
  });

  it('returns empty previous keys for create (no snapshots)', () => {
    expect(expandPreviousDimensionKeys([], VERSIONS)).toEqual([]);
  });

  it('mergeRecalcScopeKeys unions without dropping prior pending keys', () => {
    expect(mergeRecalcScopeKeys(['a'], ['b'])).toEqual(['a', 'b']);
    expect(mergeRecalcScopeKeys(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
