import { z } from 'zod';
import { InvalidRegionalRouteError, UnsupportedPlatformRouteError } from './errors';

/**
 * Riot League routing values.
 * Source: Riot Developer Portal — "League of Legends API" docs, section "Routing Values"
 * (Platform Routing Values / Regional Routing Values).
 *
 * Mainland Chinese servers are intentionally unsupported.
 */

export const PLATFORM_ROUTES = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'na1',
  'oc1',
  'tr1',
  'ru',
  'ph2',
  'sg2',
  'th2',
  'tw2',
  'vn2',
] as const;

export const REGIONAL_ROUTES = ['americas', 'asia', 'europe', 'sea'] as const;

export type PlatformRoute = (typeof PLATFORM_ROUTES)[number];
export type RegionalRoute = (typeof REGIONAL_ROUTES)[number];

export const PlatformRouteSchema = z.enum(PLATFORM_ROUTES);
export const RegionalRouteSchema = z.enum(REGIONAL_ROUTES);

/** Explicitly rejected mainland China / Tencent identifiers (never treated as supported). */
export const EXCLUDED_PLATFORM_ALIASES = [
  'cn',
  'cn1',
  'cn2',
  'china',
  'tencent',
  'qq',
  'garena',
] as const;

const PLATFORM_DISPLAY_NAMES: Record<PlatformRoute, string> = {
  br1: 'Brazil',
  eun1: 'Europe Nordic & East',
  euw1: 'Europe West',
  jp1: 'Japan',
  kr: 'Korea',
  la1: 'Latin America North',
  la2: 'Latin America South',
  na1: 'North America',
  oc1: 'Oceania',
  tr1: 'Turkey',
  ru: 'Russia',
  ph2: 'Philippines',
  sg2: 'Singapore',
  th2: 'Thailand',
  tw2: 'Taiwan',
  vn2: 'Vietnam',
};

/**
 * Platform → regional mapping used by Match-v5 / Account clustering.
 * Derived from Riot's documented platform and regional routing values
 * (League of Legends API docs — Routing Values) and Match-v5 regional clustering.
 */
const PLATFORM_TO_REGIONAL: Record<PlatformRoute, RegionalRoute> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  eun1: 'europe',
  euw1: 'europe',
  tr1: 'europe',
  ru: 'europe',
  jp1: 'asia',
  kr: 'asia',
  oc1: 'sea',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

export type RiotEndpointCategory = 'league-platform' | 'account-regional' | 'match-regional';

const ENDPOINT_CATEGORY_ROUTING: Record<RiotEndpointCategory, 'platform' | 'regional'> = {
  'league-platform': 'platform',
  'account-regional': 'regional',
  'match-regional': 'regional',
};

function normalizeRouteInput(value: string): string {
  return value.trim().toLowerCase();
}

export function parsePlatformRoute(input: unknown): PlatformRoute {
  if (typeof input !== 'string') {
    throw new UnsupportedPlatformRouteError('Platform route must be a string.', {
      receivedType: typeof input,
    });
  }

  const normalized = normalizeRouteInput(input);

  if ((EXCLUDED_PLATFORM_ALIASES as readonly string[]).includes(normalized)) {
    throw new UnsupportedPlatformRouteError(
      'Mainland Chinese and other unsupported servers are out of scope.',
      { route: normalized },
    );
  }

  const parsed = PlatformRouteSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new UnsupportedPlatformRouteError(`Unsupported platform route: ${normalized}`, {
      route: normalized,
    });
  }

  return parsed.data;
}

export function parseRegionalRoute(input: unknown): RegionalRoute {
  if (typeof input !== 'string') {
    throw new InvalidRegionalRouteError('Regional route must be a string.', {
      receivedType: typeof input,
    });
  }

  const normalized = normalizeRouteInput(input);
  const parsed = RegionalRouteSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new InvalidRegionalRouteError(`Invalid regional route: ${normalized}`, {
      route: normalized,
    });
  }

  return parsed.data;
}

export function getRegionalRouteForPlatform(platform: PlatformRoute): RegionalRoute {
  return PLATFORM_TO_REGIONAL[platform];
}

export function getPlatformDisplayName(platform: PlatformRoute): string {
  return PLATFORM_DISPLAY_NAMES[platform];
}

export function listSupportedPlatforms(): ReadonlyArray<{
  route: PlatformRoute;
  displayName: string;
  regionalRoute: RegionalRoute;
}> {
  return PLATFORM_ROUTES.map((route) => ({
    route,
    displayName: getPlatformDisplayName(route),
    regionalRoute: getRegionalRouteForPlatform(route),
  }));
}

export function getPlatformToRegionalMap(): Readonly<Record<PlatformRoute, RegionalRoute>> {
  return PLATFORM_TO_REGIONAL;
}

export function getRoutingKindForEndpointCategory(
  category: RiotEndpointCategory,
): 'platform' | 'regional' {
  return ENDPOINT_CATEGORY_ROUTING[category];
}

export function requiresPlatformRouting(category: RiotEndpointCategory): boolean {
  return getRoutingKindForEndpointCategory(category) === 'platform';
}

export function requiresRegionalRouting(category: RiotEndpointCategory): boolean {
  return getRoutingKindForEndpointCategory(category) === 'regional';
}

/** Hostname helpers — keep host construction out of Vue components and controllers. */
export function getPlatformApiHost(platform: PlatformRoute): string {
  return `${platform}.api.riotgames.com`;
}

export function getRegionalApiHost(region: RegionalRoute): string {
  return `${region}.api.riotgames.com`;
}

export function getApiHostForEndpointCategory(
  category: RiotEndpointCategory,
  routes: { platform: PlatformRoute; regionalRoute: RegionalRoute },
): string {
  return requiresPlatformRouting(category)
    ? getPlatformApiHost(routes.platform)
    : getRegionalApiHost(routes.regionalRoute);
}
