import { describe, expect, it } from 'vitest';
import {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
} from './aggregate-sentinels';
import {
  isAllPlatformRoute,
  isAllPosition,
  isAllQueueId,
  isAllRankTier,
  isAllRegionalRoute,
  isUnknownPosition,
  isUnknownRankTier,
} from './public-sentinel-mapping';

describe('public sentinel mapping', () => {
  it('recognizes reserved ALL platform/region/queue sentinels', () => {
    expect(isAllPlatformRoute(ALL_PLATFORM_ROUTE_SENTINEL)).toBe(true);
    expect(isAllRegionalRoute(ALL_REGIONAL_ROUTE_SENTINEL)).toBe(true);
    expect(isAllQueueId(ALL_QUEUE_ID_SENTINEL)).toBe(true);
    expect(isAllPlatformRoute('na1')).toBe(false);
    expect(isAllRegionalRoute('americas')).toBe(false);
    expect(isAllQueueId(420)).toBe(false);
  });

  it('keeps ALL and UNKNOWN distinct for tier and position', () => {
    expect(isAllRankTier(ALL_RANK_TIER_SENTINEL)).toBe(true);
    expect(isUnknownRankTier(UNKNOWN_RANK_TIER_SENTINEL)).toBe(true);
    expect(isAllRankTier(UNKNOWN_RANK_TIER_SENTINEL)).toBe(false);
    expect(isUnknownRankTier(ALL_RANK_TIER_SENTINEL)).toBe(false);

    expect(isAllPosition(ALL_POSITION_SENTINEL)).toBe(true);
    expect(isUnknownPosition(UNKNOWN_POSITION_SENTINEL)).toBe(true);
    expect(isAllPosition(UNKNOWN_POSITION_SENTINEL)).toBe(false);
    expect(isUnknownPosition(ALL_POSITION_SENTINEL)).toBe(false);
  });
});
