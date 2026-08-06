import {
  ChampionRankingPositionSchema,
  ChampionStatsTierFilterSchema,
  PlatformRouteSchema,
  type ChampionRankingPosition,
  type ChampionStatsFiltersResponse,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';

export type ChampionQueryRecord = Record<string, string | string[] | undefined | null>;

/** Aggregate filters shared by directory ranking and champion detail. */
export type ChampionAggregateFilterValues = {
  platform: PlatformRoute | null;
  queue: number | null;
  tier: ChampionStatsTierFilter | null;
  position: ChampionRankingPosition | null;
  patch: string | null;
};

export type ChampionDirectoryFilterValues = ChampionAggregateFilterValues & {
  search: string | null;
  tag: string | null;
};

export function firstQueryValue(
  query: ChampionQueryRecord,
  key: string,
): string | undefined {
  const raw = query[key];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw ?? undefined;
}

export function parseQueue(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }
  return n;
}

export function parsePlatform(raw: string | undefined): PlatformRoute | null {
  if (!raw) {
    return null;
  }
  const parsed = PlatformRouteSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseTier(raw: string | undefined): ChampionStatsTierFilter | null {
  if (!raw) {
    return null;
  }
  const parsed = ChampionStatsTierFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parsePosition(raw: string | undefined): ChampionRankingPosition | null {
  if (!raw) {
    return null;
  }
  const parsed = ChampionRankingPositionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseAggregateFiltersFromQuery(query: ChampionQueryRecord): {
  filters: ChampionAggregateFilterValues;
  hadQueueIdAlias: boolean;
  hadDirectoryOnlyParams: boolean;
} {
  const queueFromCanonical = parseQueue(firstQueryValue(query, 'queue'));
  const queueFromAlias = parseQueue(firstQueryValue(query, 'queueId'));
  const hadQueueIdAlias = queueFromAlias !== null && firstQueryValue(query, 'queueId') !== undefined;
  const hadDirectoryOnlyParams =
    firstQueryValue(query, 'search') !== undefined || firstQueryValue(query, 'tag') !== undefined;

  return {
    hadQueueIdAlias,
    hadDirectoryOnlyParams,
    filters: {
      platform: parsePlatform(firstQueryValue(query, 'platform')),
      queue: queueFromCanonical ?? queueFromAlias,
      tier: parseTier(firstQueryValue(query, 'tier')),
      position: parsePosition(firstQueryValue(query, 'position')),
      patch: firstQueryValue(query, 'patch')?.trim() || null,
    },
  };
}

export function parseDirectoryFiltersFromQuery(query: ChampionQueryRecord): {
  filters: ChampionDirectoryFilterValues;
  hadQueueIdAlias: boolean;
} {
  const aggregate = parseAggregateFiltersFromQuery(query);
  return {
    hadQueueIdAlias: aggregate.hadQueueIdAlias,
    filters: {
      ...aggregate.filters,
      search: firstQueryValue(query, 'search')?.trim() || null,
      tag: firstQueryValue(query, 'tag')?.trim() || null,
    },
  };
}

export function resolveAggregateFilterDefaults(
  parsed: ChampionAggregateFilterValues,
  meta: ChampionStatsFiltersResponse,
): ChampionAggregateFilterValues {
  return {
    platform: parsed.platform ?? meta.defaultPlatform,
    queue: parsed.queue ?? meta.defaultQueueId,
    tier: parsed.tier ?? 'ALL',
    position: parsed.position,
    patch: parsed.patch ?? meta.defaultPatch ?? 'unavailable',
  };
}

export function resolveDirectoryFilterDefaults(
  parsed: ChampionDirectoryFilterValues,
  meta: ChampionStatsFiltersResponse,
): ChampionDirectoryFilterValues {
  return {
    ...resolveAggregateFilterDefaults(parsed, meta),
    search: parsed.search,
    tag: parsed.tag,
  };
}
