import {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
} from './aggregate-sentinels';

export function isAllPlatformRoute(value: string): boolean {
  return value === ALL_PLATFORM_ROUTE_SENTINEL;
}

export function isAllRegionalRoute(value: string): boolean {
  return value === ALL_REGIONAL_ROUTE_SENTINEL;
}

export function isAllQueueId(value: number): boolean {
  return value === ALL_QUEUE_ID_SENTINEL;
}

export function isAllRankTier(value: string): boolean {
  return value === ALL_RANK_TIER_SENTINEL;
}

export function isUnknownRankTier(value: string): boolean {
  return value === UNKNOWN_RANK_TIER_SENTINEL;
}

export function isAllPosition(value: string): boolean {
  return value === ALL_POSITION_SENTINEL;
}

export function isUnknownPosition(value: string): boolean {
  return value === UNKNOWN_POSITION_SENTINEL;
}
