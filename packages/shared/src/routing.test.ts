import { describe, expect, it } from 'vitest';
import {
  EXCLUDED_PLATFORM_ALIASES,
  PLATFORM_ROUTES,
  getApiHostForEndpointCategory,
  getPlatformApiHost,
  getPlatformDisplayName,
  getPlatformToRegionalMap,
  getRegionalApiHost,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
  parseRegionalRoute,
  requiresPlatformRouting,
  requiresRegionalRouting,
} from './routing';
import { UnsupportedPlatformRouteError, InvalidRegionalRouteError } from './errors';

describe('Riot routing', () => {
  it('maps every supported platform to a regional route', () => {
    const map = getPlatformToRegionalMap();
    for (const platform of PLATFORM_ROUTES) {
      expect(map[platform]).toBeTruthy();
      expect(getRegionalRouteForPlatform(platform)).toBe(map[platform]);
    }
  });

  it.each([
    ['br1', 'americas'],
    ['la1', 'americas'],
    ['la2', 'americas'],
    ['na1', 'americas'],
    ['eun1', 'europe'],
    ['euw1', 'europe'],
    ['tr1', 'europe'],
    ['ru', 'europe'],
    ['jp1', 'asia'],
    ['kr', 'asia'],
    ['oc1', 'sea'],
    ['ph2', 'sea'],
    ['sg2', 'sea'],
    ['th2', 'sea'],
    ['tw2', 'sea'],
    ['vn2', 'sea'],
  ] as const)('maps %s → %s', (platform, regional) => {
    expect(getRegionalRouteForPlatform(platform)).toBe(regional);
  });

  it.each([
    ['NA1', 'na1'],
    [' Na1 ', 'na1'],
    ['euw1', 'euw1'],
    ['KR', 'kr'],
  ])('parses platform %j case-insensitively to %j', (input, expected) => {
    expect(parsePlatformRoute(input)).toBe(expected);
  });

  it.each([...EXCLUDED_PLATFORM_ALIASES, 'CN1', ' China '])(
    'rejects Chinese / unsupported route %j',
    (input) => {
      expect(() => parsePlatformRoute(input)).toThrow(UnsupportedPlatformRouteError);
    },
  );

  it('rejects unknown platforms', () => {
    expect(() => parsePlatformRoute('pbe')).toThrow(UnsupportedPlatformRouteError);
  });

  it('provides a stable display name for every platform', () => {
    for (const platform of PLATFORM_ROUTES) {
      expect(getPlatformDisplayName(platform).length).toBeGreaterThan(0);
    }
  });

  it('builds API hosts without embedding them in UI layers', () => {
    expect(getPlatformApiHost('na1')).toBe('na1.api.riotgames.com');
    expect(getRegionalApiHost('americas')).toBe('americas.api.riotgames.com');
    expect(
      getApiHostForEndpointCategory('league-platform', {
        platform: 'na1',
        regionalRoute: 'americas',
      }),
    ).toBe('na1.api.riotgames.com');
    expect(
      getApiHostForEndpointCategory('match-regional', {
        platform: 'na1',
        regionalRoute: 'americas',
      }),
    ).toBe('americas.api.riotgames.com');
    expect(
      getApiHostForEndpointCategory('account-regional', {
        platform: 'euw1',
        regionalRoute: 'europe',
      }),
    ).toBe('europe.api.riotgames.com');
  });

  it('classifies endpoint routing kinds', () => {
    expect(requiresPlatformRouting('league-platform')).toBe(true);
    expect(requiresRegionalRouting('league-platform')).toBe(false);
    expect(requiresRegionalRouting('match-regional')).toBe(true);
    expect(requiresRegionalRouting('account-regional')).toBe(true);
  });

  it.each([
    ['AMERICAS', 'americas'],
    [' europe ', 'europe'],
  ])('parses regional route %j to %j', (input, expected) => {
    expect(parseRegionalRoute(input)).toBe(expected);
  });

  it('rejects invalid regional routes', () => {
    expect(() => parseRegionalRoute('china')).toThrow(InvalidRegionalRouteError);
  });
});
