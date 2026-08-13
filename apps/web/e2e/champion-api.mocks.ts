import type { Page, Request, Route } from '@playwright/test';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionDetailResponseSchema,
  ChampionListResponseSchema,
  ChampionStatsFiltersResponseSchema,
  ChampionStatsResponseSchema,
  ChampionStatsTableResponseSchema,
  CursorPageSchema,
  PlayerProfileResponseSchema,
  PlayerRefreshStatusSchema,
  PublicMatchSummarySchema,
  RANK_TIER_SEMANTICS,
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  type ChampionDetailResponse,
  type ChampionListResponse,
  type ChampionRankingPosition,
  type ChampionStatsFiltersResponse,
  type ChampionStatsResponse,
  type ChampionStatsTableResponse,
} from '@league-helper/shared';

const PlayerMatchesPageSchema = CursorPageSchema(PublicMatchSummarySchema);

/**
 * Deterministic Playwright route fixtures for champion aggregate APIs.
 *
 * Static-data sync / full DB e2e seed + aggregate rebuild harness is future
 * operational work (plan Task 11 originally sketched that path). These mocks keep
 * Milestone 8 UI/e2e deterministic without live Riot or Data Dragon.
 */

export const MOCK_ICON_AHRI = 'https://cdn.example.test/champions/Ahri.png';
export const MOCK_SPLASH_AHRI = 'https://cdn.example.test/splash/Ahri_0.jpg';
export const MOCK_ICON_ANNIE = 'https://cdn.example.test/champions/Annie.png';
export const MOCK_ICON_ZED = 'https://cdn.example.test/champions/Zed.png';
export const MOCK_ICON_AATROX = 'https://cdn.example.test/champions/Aatrox.png';
export const MOCK_SPLASH_AATROX = 'https://cdn.example.test/splash/Aatrox_0.jpg';
export const MOCK_SPLASH_ZED = 'https://cdn.example.test/splash/Zed_0.jpg';

const POSITIONS: ChampionRankingPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'];

export type ChampionMockOptions = {
  /** When true, Ahri /stats returns stats:null with emptyReason. */
  emptyStats?: boolean;
  /** When true, ranking table returns zero rows with emptyReason. */
  emptyRanking?: boolean;
  /**
   * When true, exact Middle stats use sub-ranking-floor sample (detail-visible).
   * Visibility floor is 1; ranking/confidence floor remains 30.
   */
  limitedSample?: boolean;
};

export type ChampionRequestLog = {
  method: string;
  url: string;
  pathname: string;
  searchParams: URLSearchParams;
};

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isChampionStatsTablePath(pathname: string): boolean {
  return pathname === '/api/champion-stats' || pathname.endsWith('/api/champion-stats');
}

function isChampionStatsFiltersPath(pathname: string): boolean {
  return (
    pathname === '/api/champion-stats/filters' || pathname.endsWith('/api/champion-stats/filters')
  );
}

function isChampionsListPath(pathname: string): boolean {
  return pathname === '/api/champions' || pathname.endsWith('/api/champions');
}

function matchChampionDetail(pathname: string): string | null {
  const match = pathname.match(/\/api\/champions\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function matchChampionStats(pathname: string): string | null {
  const match = pathname.match(/\/api\/champions\/([^/]+)\/stats\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function notFoundBody(message: string) {
  return {
    success: false as const,
    error: {
      code: 'CHAMPION_NOT_FOUND' as const,
      message,
    },
  };
}

function baseDimensions(overrides: {
  championId: number;
  position: ChampionRankingPosition | 'ALL' | 'UNKNOWN';
  platform?: 'na1' | 'euw1';
  patch?: string;
  queueId?: number;
  rankTier?: 'ALL' | 'GOLD';
}) {
  return {
    championId: overrides.championId,
    patch: overrides.patch ?? '14.11',
    platform: overrides.platform ?? 'na1',
    regionalRoute: 'americas' as const,
    queueId: overrides.queueId ?? RANKED_SOLO_QUEUE_ID,
    rankTier: overrides.rankTier ?? ('ALL' as const),
    position: overrides.position,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  };
}

function metrics(
  overrides: Partial<{
    sampleSize: number;
    wins: number;
    winRate: number | null;
    sampleConfidence: 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';
    aggregateKdaRatio: number;
    averageCsPerMinute: number;
    averageDamagePerMinute: number;
    averageVisionScorePerMinute: number;
    averageGoldDifferenceAt10: number | null;
    averageGoldDifferenceAt15: number | null;
    averageCsDifferenceAt10: number | null;
    averageCsDifferenceAt15: number | null;
  }> = {},
) {
  const sampleSize = overrides.sampleSize ?? 80;
  const wins = overrides.wins ?? 44;
  const winRate = overrides.winRate === undefined ? wins / sampleSize : overrides.winRate;
  return {
    sampleSize,
    wins,
    winRate,
    wilsonInterval:
      winRate === null
        ? null
        : {
            lowerBound: Math.max(0, winRate - 0.08),
            upperBound: Math.min(1, winRate + 0.08),
            confidenceLevel: 0.95,
          },
    sampleConfidence: overrides.sampleConfidence ?? ('MEDIUM' as const),
    aggregateKdaRatio: overrides.aggregateKdaRatio ?? 3.1,
    averageCsPerMinute: overrides.averageCsPerMinute ?? 7.4,
    averageDamagePerMinute: overrides.averageDamagePerMinute ?? 620,
    averageVisionScorePerMinute: overrides.averageVisionScorePerMinute ?? 1.1,
    averageGoldDifferenceAt10:
      overrides.averageGoldDifferenceAt10 === undefined ? 90 : overrides.averageGoldDifferenceAt10,
    averageGoldDifferenceAt15:
      overrides.averageGoldDifferenceAt15 === undefined ? 150 : overrides.averageGoldDifferenceAt15,
    averageCsDifferenceAt10:
      overrides.averageCsDifferenceAt10 === undefined ? 4 : overrides.averageCsDifferenceAt10,
    averageCsDifferenceAt15:
      overrides.averageCsDifferenceAt15 === undefined ? 7 : overrides.averageCsDifferenceAt15,
    latestEligibleMatchAt: '2026-08-01T12:00:00.000Z',
    calculatedAt: '2026-08-05T18:00:00.000Z',
  };
}

function envelopeMeta(overrides: {
  platform?: 'na1' | 'euw1';
  patch?: string;
  queueId?: number;
  tier?: 'ALL' | 'GOLD';
  position?: ChampionRankingPosition | null;
  freshness?: 'CURRENT' | 'RECALCULATION_PENDING' | 'UNKNOWN';
}) {
  const platform = overrides.platform ?? 'na1';
  const patch = overrides.patch ?? '14.11';
  const queueId = overrides.queueId ?? RANKED_SOLO_QUEUE_ID;
  const tier = overrides.tier ?? 'ALL';
  const position = overrides.position ?? null;
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    sampleScope: {
      kind: 'COLLECTED_SAMPLE' as const,
      platform,
      patch,
      queueId,
    },
    freshness: overrides.freshness ?? ('CURRENT' as const),
    requestedFilters: {
      platform,
      patch,
      queueId,
      tier,
      ...(position ? { position } : {}),
    },
    resolvedFilters: {
      platform,
      patch,
      queueId,
      tier,
      position,
    },
    usedDefaultPlatform: false,
    usedDefaultPatch: false,
    effectiveMinimumSample: 30,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  };
}

export function buildFiltersResponse(): ChampionStatsFiltersResponse {
  return ChampionStatsFiltersResponseSchema.parse({
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    defaultPlatform: 'na1',
    defaultQueueId: RANKED_SOLO_QUEUE_ID,
    defaultPatch: '14.11',
    availablePlatforms: ['na1', 'euw1'],
    availablePatches: ['14.11', '14.10'],
    availableQueues: [
      {
        queueId: RANKED_SOLO_QUEUE_ID,
        label: 'Ranked Solo/Duo',
        supportsStandardPositions: true,
      },
      {
        queueId: RANKED_FLEX_QUEUE_ID,
        label: 'Ranked Flex',
        supportsStandardPositions: true,
      },
      {
        queueId: 450,
        label: 'ARAM',
        supportsStandardPositions: false,
      },
    ],
    availableTiers: ['ALL', 'GOLD', 'PLATINUM', 'UNKNOWN'],
    availablePositions: POSITIONS,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      platform: 'na1',
      patch: '14.11',
      queueId: RANKED_SOLO_QUEUE_ID,
    },
  });
}

export function buildChampionsListResponse(): ChampionListResponse {
  return ChampionListResponseSchema.parse({
    staticDataPatch: '14.11',
    staticDataVersion: '14.11.1',
    champions: [
      {
        championId: 103,
        championKey: 'Ahri',
        name: 'Ahri',
        title: 'the Nine-Tailed Fox',
        tags: ['Mage', 'Assassin'],
        iconUrl: MOCK_ICON_AHRI,
        splashUrl: MOCK_SPLASH_AHRI,
        staticDataPatch: '14.11',
      },
      {
        championId: 1,
        championKey: 'Annie',
        name: 'Annie',
        title: 'the Dark Child',
        tags: ['Mage'],
        iconUrl: MOCK_ICON_ANNIE,
        staticDataPatch: '14.11',
      },
      {
        championId: 238,
        championKey: 'Zed',
        name: 'Zed',
        title: 'the Master of Shadows',
        tags: ['Assassin'],
        iconUrl: MOCK_ICON_ZED,
        staticDataPatch: '14.11',
      },
      {
        championId: 266,
        championKey: 'Aatrox',
        name: 'Aatrox',
        title: 'the Darkin Blade',
        tags: ['Fighter', 'Tank'],
        iconUrl: MOCK_ICON_AATROX,
        staticDataPatch: '14.11',
      },
    ],
  });
}

function mockAbilities(
  championKey: string,
  names: [string, string, string, string, string],
): NonNullable<ChampionDetailResponse['champion']['abilities']> {
  const slots = ['PASSIVE', 'Q', 'W', 'E', 'R'] as const;
  return slots.map((slot, index) => ({
    slot,
    name: names[index]!,
    description: `${names[index]} description`,
    iconUrl: `https://cdn.example.test/abilities/${championKey}-${slot}.png`,
    ...(slot === 'Q'
      ? { cooldown: '7', cost: '55', range: '900' }
      : slot === 'PASSIVE'
        ? {}
        : { cooldown: '10', cost: '40', range: '600' }),
  }));
}

function ahriDetail(canonical = true): ChampionDetailResponse {
  return ChampionDetailResponseSchema.parse({
    staticDataPatch: '14.11',
    staticDataVersion: '14.11.1',
    champion: {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage', 'Assassin'],
      iconUrl: MOCK_ICON_AHRI,
      splashUrl: MOCK_SPLASH_AHRI,
      staticDataPatch: '14.11',
      abilities: mockAbilities('Ahri', [
        'Essence Theft',
        'Orb of Deception',
        'Fox-Fire',
        'Charm',
        'Spirit Rush',
      ]),
      ...(canonical ? { canonicalChampionKey: 'Ahri' } : {}),
    },
  });
}

function aatroxDetail(): ChampionDetailResponse {
  return ChampionDetailResponseSchema.parse({
    staticDataPatch: '14.11',
    staticDataVersion: '14.11.1',
    champion: {
      championId: 266,
      championKey: 'Aatrox',
      name: 'Aatrox',
      title: 'the Darkin Blade',
      tags: ['Fighter', 'Tank'],
      iconUrl: MOCK_ICON_AATROX,
      splashUrl: MOCK_SPLASH_AATROX,
      staticDataPatch: '14.11',
      abilities: mockAbilities('Aatrox', [
        'Deathbringer Stance',
        'The Darkin Blade',
        'Infernal Chains',
        'Umbral Dash',
        'World Ender',
      ]),
      canonicalChampionKey: 'Aatrox',
    },
  });
}

function zedDetail(): ChampionDetailResponse {
  return ChampionDetailResponseSchema.parse({
    staticDataPatch: '14.11',
    staticDataVersion: '14.11.1',
    champion: {
      championId: 238,
      championKey: 'Zed',
      name: 'Zed',
      title: 'the Master of Shadows',
      tags: ['Assassin'],
      iconUrl: MOCK_ICON_ZED,
      splashUrl: MOCK_SPLASH_ZED,
      staticDataPatch: '14.11',
      abilities: mockAbilities('Zed', [
        'Contempt for the Weak',
        'Razor Shuriken',
        'Living Shadow',
        'Shadow Slash',
        'Death Mark',
      ]),
      canonicalChampionKey: 'Zed',
    },
  });
}

function positionBreakdown(
  platform: 'na1' | 'euw1',
  patch: string,
  queueId: number,
  tier: 'ALL' | 'GOLD',
) {
  return POSITIONS.map((position) => {
    if (position === 'BOTTOM' || position === 'SUPPORT') {
      return {
        position,
        dimensions: null,
        metrics: null,
      };
    }
    return {
      position,
      dimensions: baseDimensions({
        championId: 103,
        position,
        platform,
        patch,
        queueId,
        rankTier: tier,
      }),
      metrics: metrics({
        sampleSize: position === 'MIDDLE' ? 80 : 40,
        wins: position === 'MIDDLE' ? 44 : 18,
        sampleConfidence: position === 'MIDDLE' ? 'MEDIUM' : 'LOW',
      }),
    };
  });
}

export function buildChampionStatsResponse(options: {
  emptyStats?: boolean;
  limitedSample?: boolean;
  position?: ChampionRankingPosition | null;
  platform?: 'na1' | 'euw1';
  patch?: string;
  queueId?: number;
  tier?: 'ALL' | 'GOLD';
}): ChampionStatsResponse {
  const platform = options.platform ?? 'na1';
  const patch = options.patch ?? '14.11';
  const queueId = options.queueId ?? RANKED_SOLO_QUEUE_ID;
  const tier = options.tier ?? 'ALL';
  const position = options.position ?? null;
  const emptyStats = options.emptyStats ?? false;
  const limitedSample = options.limitedSample ?? false;

  const champion = ahriDetail().champion;

  if (emptyStats) {
    return ChampionStatsResponseSchema.parse({
      ...envelopeMeta({
        platform,
        patch,
        queueId,
        tier,
        position,
        freshness: 'UNKNOWN',
      }),
      champion,
      stats: null,
      emptyReason: 'CHAMPION_HAS_NO_STATS',
      positionBreakdown: POSITIONS.map((p) => ({
        position: p,
        dimensions: null,
        metrics: null,
      })),
    });
  }

  const exactMetrics = limitedSample
    ? metrics({
        sampleSize: 18,
        wins: 10,
        winRate: 10 / 18,
        sampleConfidence: 'INSUFFICIENT',
        // Keep timeline honesty exercisable in limited-sample UI.
        averageGoldDifferenceAt10: -115,
        averageGoldDifferenceAt15: null,
        averageCsDifferenceAt10: null,
        averageCsDifferenceAt15: null,
      })
    : metrics({ sampleSize: 80, wins: 44 });

  const exactStats =
    position === null
      ? null
      : {
          dimensions: baseDimensions({
            championId: 103,
            position,
            platform,
            patch,
            queueId,
            rankTier: tier,
          }),
          metrics: exactMetrics,
        };

  const breakdown = limitedSample
    ? POSITIONS.map((role) => {
        if (role !== 'MIDDLE') {
          return {
            position: role,
            dimensions: null,
            metrics: null,
          };
        }
        return {
          position: role,
          dimensions: baseDimensions({
            championId: 103,
            position: role,
            platform,
            patch,
            queueId,
            rankTier: tier,
          }),
          metrics: exactMetrics,
        };
      })
    : positionBreakdown(platform, patch, queueId, tier);

  return ChampionStatsResponseSchema.parse({
    ...envelopeMeta({ platform, patch, queueId, tier, position }),
    champion,
    stats: exactStats,
    ...(exactStats ? {} : { emptyReason: undefined }),
    positionBreakdown: breakdown,
  });
}

export function buildRankingTableResponse(options: {
  platform?: 'na1' | 'euw1';
  patch?: string;
  queueId?: number;
  tier?: 'ALL' | 'GOLD';
  position: ChampionRankingPosition;
  empty?: boolean;
}): ChampionStatsTableResponse {
  const platform = options.platform ?? 'na1';
  const patch = options.patch ?? '14.11';
  const queueId = options.queueId ?? RANKED_SOLO_QUEUE_ID;
  const tier = options.tier ?? 'ALL';
  const position = options.position;

  if (options.empty) {
    return ChampionStatsTableResponseSchema.parse({
      ...envelopeMeta({ platform, patch, queueId, tier, position }),
      rows: [],
      emptyReason: 'NO_MATCHING_AGGREGATES',
      pagination: { nextCursor: null, limit: 50, offset: 0, totalCount: 0 },
    });
  }

  const list = buildChampionsListResponse().champions;
  const rows = list.map((champion, index) => ({
    champion,
    dimensions: baseDimensions({
      championId: champion.championId,
      position,
      platform,
      patch,
      queueId,
      rankTier: tier,
    }),
    metrics: metrics({
      sampleSize: 100 - index * 10,
      wins: 55 - index * 5,
      sampleConfidence: index === 0 ? 'HIGH' : 'MEDIUM',
    }),
  }));

  return ChampionStatsTableResponseSchema.parse({
    ...envelopeMeta({ platform, patch, queueId, tier, position }),
    rows,
    pagination: {
      nextCursor: null,
      limit: 50,
      offset: 0,
      totalCount: rows.length,
    },
  });
}

export type InstalledChampionMocks = {
  requests: ChampionRequestLog[];
  rankingRequests: ChampionRequestLog[];
  statsRequests: ChampionRequestLog[];
  /** True if any ranking table request was logged (excludes /filters). */
  hasRankingTableRequest: () => boolean;
  setEmptyStats: (value: boolean) => void;
  setEmptyRanking: (value: boolean) => void;
  setLimitedSample: (value: boolean) => void;
  dispose: () => Promise<void>;
};

/** 1×1 PNG so img tags with mock CDN URLs do not fall back after @error. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Install page.route handlers for champion APIs before navigation.
 * Tracks request URLs for “no ranking before position” assertions.
 */
export async function installChampionApiMocks(
  page: Page,
  options: ChampionMockOptions = {},
): Promise<InstalledChampionMocks> {
  let emptyStats = options.emptyStats ?? false;
  let emptyRanking = options.emptyRanking ?? false;
  let limitedSample = options.limitedSample ?? false;
  const requests: ChampionRequestLog[] = [];
  const rankingRequests: ChampionRequestLog[] = [];
  const statsRequests: ChampionRequestLog[] = [];

  const assetHandler = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TINY_PNG,
    });
  };

  const handler = async (route: Route, request: Request): Promise<void> => {
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }

    const url = request.url();
    const pathname = pathnameOf(url);
    const searchParams = new URL(url).searchParams;
    const entry: ChampionRequestLog = {
      method: request.method(),
      url,
      pathname,
      searchParams,
    };
    requests.push(entry);

    if (isChampionStatsFiltersPath(pathname)) {
      await json(route, 200, buildFiltersResponse());
      return;
    }

    if (isChampionStatsTablePath(pathname)) {
      rankingRequests.push(entry);
      const position = searchParams.get('position') as ChampionRankingPosition | null;
      if (!position || !POSITIONS.includes(position)) {
        await json(route, 400, {
          success: false,
          error: {
            code: 'CHAMPION_STATS_POSITION_REQUIRED',
            message: 'position is required for ranking table',
          },
        });
        return;
      }
      await json(
        route,
        200,
        buildRankingTableResponse({
          position,
          platform: (searchParams.get('platform') as 'na1' | 'euw1') ?? 'na1',
          patch: searchParams.get('patch') ?? '14.11',
          queueId: Number(searchParams.get('queueId') ?? RANKED_SOLO_QUEUE_ID),
          tier: (searchParams.get('tier') as 'ALL' | 'GOLD') ?? 'ALL',
          empty: emptyRanking,
        }),
      );
      return;
    }

    const statsKey = matchChampionStats(pathname);
    if (statsKey) {
      statsRequests.push(entry);
      if (/^\d+$/.test(statsKey)) {
        await json(route, 404, notFoundBody('Champion not found'));
        return;
      }
      if (statsKey.toLowerCase() === 'unknownchampion') {
        await json(route, 404, notFoundBody('Champion not found'));
        return;
      }
      if (statsKey.toLowerCase() !== 'ahri') {
        await json(route, 404, notFoundBody('Champion not found'));
        return;
      }
      const positionParam = searchParams.get('position');
      const position =
        positionParam && POSITIONS.includes(positionParam as ChampionRankingPosition)
          ? (positionParam as ChampionRankingPosition)
          : null;
      await json(
        route,
        200,
        buildChampionStatsResponse({
          emptyStats,
          limitedSample,
          position,
          platform: (searchParams.get('platform') as 'na1' | 'euw1') ?? 'na1',
          patch: searchParams.get('patch') ?? '14.11',
          queueId: Number(searchParams.get('queueId') ?? RANKED_SOLO_QUEUE_ID),
          tier: (searchParams.get('tier') as 'ALL' | 'GOLD') ?? 'ALL',
        }),
      );
      return;
    }

    const detailKey = matchChampionDetail(pathname);
    if (detailKey) {
      if (/^\d+$/.test(detailKey)) {
        await json(route, 404, notFoundBody('Champion not found'));
        return;
      }
      if (detailKey.toLowerCase() === 'unknownchampion') {
        await json(route, 404, notFoundBody('Champion not found'));
        return;
      }
      if (detailKey.toLowerCase() === 'ahri') {
        await json(route, 200, ahriDetail(true));
        return;
      }
      if (detailKey.toLowerCase() === 'aatrox') {
        await json(route, 200, aatroxDetail());
        return;
      }
      if (detailKey.toLowerCase() === 'zed') {
        await json(route, 200, zedDetail());
        return;
      }
      if (detailKey.toLowerCase() === 'annie') {
        await json(
          route,
          200,
          ChampionDetailResponseSchema.parse({
            staticDataPatch: '14.11',
            champion: {
              championId: 1,
              championKey: 'Annie',
              name: 'Annie',
              title: 'the Dark Child',
              tags: ['Mage'],
              iconUrl: MOCK_ICON_ANNIE,
              canonicalChampionKey: 'Annie',
            },
          }),
        );
        return;
      }
      await json(route, 404, notFoundBody('Champion not found'));
      return;
    }

    if (isChampionsListPath(pathname)) {
      const search = (searchParams.get('search') ?? '').toLowerCase();
      const tag = (searchParams.get('tag') ?? '').toLowerCase();
      const list = buildChampionsListResponse();
      const filtered = {
        ...list,
        champions: list.champions.filter((c) => {
          if (search && !c.name.toLowerCase().includes(search)) {
            return false;
          }
          if (tag && !c.tags.some((t) => t.toLowerCase() === tag)) {
            return false;
          }
          return true;
        }),
      };
      await json(route, 200, filtered);
      return;
    }

    await route.continue();
  };

  // Broad match; handler discriminates paths. Covers localhost:3001 and any host.
  await page.route('**/api/champion-stats**', handler);
  await page.route('**/api/champions**', handler);
  await page.route('https://cdn.example.test/**', assetHandler);

  return {
    requests,
    rankingRequests,
    statsRequests,
    hasRankingTableRequest: () => rankingRequests.length > 0,
    setEmptyStats: (value: boolean) => {
      emptyStats = value;
    },
    setEmptyRanking: (value: boolean) => {
      emptyRanking = value;
    },
    setLimitedSample: (value: boolean) => {
      limitedSample = value;
    },
    dispose: async () => {
      await page.unroute('**/api/champion-stats**', handler);
      await page.unroute('**/api/champions**', handler);
      await page.unroute('https://cdn.example.test/**', assetHandler);
    },
  };
}

/** Minimal player profile mock for mastery → champion link checks. */
export async function installPlayerProfileMock(
  page: Page,
  playerId: string,
): Promise<() => Promise<void>> {
  const refresh = PlayerRefreshStatusSchema.parse({
    state: 'COMPLETE',
    requestedMatchCount: 20,
    discoveredMatchCount: 1,
    knownMatchCount: 1,
    queuedMatchCount: 0,
    activeMatchCount: 0,
    delayedMatchCount: 0,
    completedMatchCount: 1,
    failedMatchCount: 0,
    lastResolvedAt: '2026-08-05T12:00:00.000Z',
    lastRefreshStartedAt: '2026-08-05T12:00:00.000Z',
    lastRefreshCompletedAt: '2026-08-05T12:00:00.000Z',
    lastRefreshedAt: '2026-08-05T12:00:00.000Z',
    isStale: false,
    warnings: [],
  });

  const profile = PlayerProfileResponseSchema.parse({
    player: {
      id: playerId,
      accountId: '11111111-1111-4111-8111-111111111111',
      provider: 'RIOT',
      platform: 'na1',
      regionalRoute: 'americas',
      riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
      profileIconId: 1,
      profileIconUrl: 'https://cdn.example.test/profile/1.png',
      summonerLevel: 100,
      lastResolvedAt: '2026-08-05T12:00:00.000Z',
    },
    ranks: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        queueType: 'RANKED_SOLO_5x5',
        tier: 'GOLD',
        division: 'II',
        leaguePoints: 50,
        wins: 10,
        losses: 8,
        veteran: false,
        inactive: false,
        freshBlood: false,
        hotStreak: false,
        capturedAt: '2026-08-05T12:00:00.000Z',
      },
    ],
    mastery: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        championId: 103,
        championLevel: 7,
        championPoints: 120_000,
        lastPlayTime: '2026-08-01T00:00:00.000Z',
        chestGranted: true,
        tokensEarned: 0,
        capturedAt: '2026-08-05T12:00:00.000Z',
        championName: 'Ahri',
        championKey: 'Ahri',
        championIconUrl: MOCK_ICON_AHRI,
        championSplashUrl: MOCK_SPLASH_AHRI,
      },
    ],
    matches: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        externalMatchId: 'NA1_1',
        queueId: RANKED_SOLO_QUEUE_ID,
        gameCreation: '2026-08-01T00:00:00.000Z',
        gameDurationSeconds: 1800,
        gameVersion: '14.11.1.123',
        normalizedPatch: '14.11',
        remake: false,
        earlySurrender: false,
        result: 'victory',
        championId: 103,
        championKey: 'Ahri',
        championName: 'Ahri',
        championIconUrl: MOCK_ICON_AHRI,
        teamPosition: 'MIDDLE',
        role: 'MIDDLE',
        win: true,
        kills: 5,
        deaths: 2,
        assists: 8,
        kda: 6.5,
        totalCs: 200,
        csPerMinute: 6.7,
        killParticipation: 0.55,
        itemIds: [],
        itemIconUrls: [],
        summonerSpell1Id: 4,
        summonerSpell2Id: 14,
        goldAt10: null,
        goldAt15: null,
        csAt10: null,
        csAt15: null,
        xpAt10: null,
        xpAt15: null,
        goldDifferenceAt10: null,
        goldDifferenceAt15: null,
        csDifferenceAt10: null,
        csDifferenceAt15: null,
        timelineMetricsAvailable: false,
        ingestionStatus: 'COMPLETED',
      },
    ],
    refresh,
  });

  const matchesPage = PlayerMatchesPageSchema.parse({
    items: profile.matches,
    nextCursor: null,
  });

  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }

    const url = route.request().url();
    const pathname = pathnameOf(url);
    if (pathname.includes(`/api/players/${playerId}/matches`)) {
      await json(route, 200, matchesPage);
      return;
    }
    if (pathname.includes(`/api/players/${playerId}/refresh-status`)) {
      await json(route, 200, refresh);
      return;
    }
    if (pathname.match(new RegExp(`/api/players/${playerId}/?$`))) {
      await json(route, 200, profile);
      return;
    }
    await route.continue();
  };

  await page.route(`**/api/players/${playerId}**`, handler);
  return async () => {
    await page.unroute(`**/api/players/${playerId}**`, handler);
  };
}
