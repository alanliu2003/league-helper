import { describe, expect, it } from 'vitest';
import type { MaterializedChampionDimensions } from './aggregate-dimensions';
import { buildChampionAggregateDimensionKey } from './aggregate-keys';
import {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
} from '../sentinels/aggregate-sentinels';

const base: MaterializedChampionDimensions = {
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

describe('buildChampionAggregateDimensionKey', () => {
  it('is a fixed-order JSON array tuple including both versions', () => {
    const key = buildChampionAggregateDimensionKey(base);
    expect(key).toBe(
      JSON.stringify([
        '16.15',
        'na1',
        'americas',
        420,
        'GOLD',
        'MIDDLE',
        103,
        '1',
        '1',
      ]),
    );
  });

  it('changes when patch changes', () => {
    const a = buildChampionAggregateDimensionKey(base);
    const b = buildChampionAggregateDimensionKey({ ...base, patch: '16.16' });
    expect(a).not.toBe(b);
  });

  it('keeps ALL and UNKNOWN as distinct keys/sentinels', () => {
    const allTier = buildChampionAggregateDimensionKey({
      ...base,
      rankTier: ALL_RANK_TIER_SENTINEL,
    });
    const unknownTier = buildChampionAggregateDimensionKey({
      ...base,
      rankTier: UNKNOWN_RANK_TIER_SENTINEL,
    });
    const allPos = buildChampionAggregateDimensionKey({
      ...base,
      position: ALL_POSITION_SENTINEL,
    });
    const unknownPos = buildChampionAggregateDimensionKey({
      ...base,
      position: UNKNOWN_POSITION_SENTINEL,
    });

    expect(allTier).not.toBe(unknownTier);
    expect(allPos).not.toBe(unknownPos);
    expect(ALL_RANK_TIER_SENTINEL).not.toBe(UNKNOWN_RANK_TIER_SENTINEL);
    expect(ALL_POSITION_SENTINEL).not.toBe(UNKNOWN_POSITION_SENTINEL);
    expect(ALL_PLATFORM_ROUTE_SENTINEL).toBe('');
    expect(ALL_REGIONAL_ROUTE_SENTINEL).toBe('');
    expect(ALL_QUEUE_ID_SENTINEL).toBe(-1);
  });
});
