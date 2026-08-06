import {
  ChampionStatsInvalidFilterError,
  ChampionStatsPositionRequiredError,
  PlatformRouteSchema,
  type ChampionRankingPosition,
  type ChampionStatsQuery,
  type ChampionStatsTableQuery,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import { isAllQueueId } from '@league-helper/match-analytics';
import type { ChampionStatsConfig } from '../../config/champion-stats.config';

export type ResolvedChampionStatsScope = {
  platform: PlatformRoute;
  queueId: number;
  tier: ChampionStatsTierFilter;
  position: ChampionRankingPosition | null;
  patch: string | null;
  usedDefaultPlatform: boolean;
  usedDefaultPatch: boolean;
  effectiveMinimumSample: number;
  includeInsufficient: boolean;
  requestedMinimumSample?: number;
};

export function computeEffectiveMinimumSample(
  config: ChampionStatsConfig,
  input: { minimumSample?: number; includeInsufficient?: boolean },
): number {
  const explicit = input.minimumSample ?? 0;
  const floor = input.includeInsufficient === true ? 0 : config.minimumSample;
  return Math.max(explicit, floor);
}

/**
 * Table ranking requires position. Zod requires it too; this surfaces the dedicated domain code
 * when the field is missing before/alongside schema parse.
 */
export function assertTablePositionPresent(query: Record<string, unknown>): void {
  const position = query.position;
  if (position === undefined || position === null || position === '') {
    throw new ChampionStatsPositionRequiredError();
  }
}

export function assertNotAllQueue(queueId: number): void {
  if (isAllQueueId(queueId)) {
    throw new ChampionStatsInvalidFilterError(
      'Champion stats do not support ALL-queue filters.',
      { queueId },
    );
  }
}

export function resolvePlatform(
  config: ChampionStatsConfig,
  platform: PlatformRoute | undefined,
): { platform: PlatformRoute; usedDefaultPlatform: boolean } {
  if (platform === undefined) {
    return { platform: config.defaultPlatform, usedDefaultPlatform: true };
  }

  const parsed = PlatformRouteSchema.safeParse(platform);
  if (!parsed.success) {
    throw new ChampionStatsInvalidFilterError('Champion stats platform filter is invalid.', {
      platform,
    });
  }

  return { platform: parsed.data, usedDefaultPlatform: false };
}

export function resolveSharedFilters(
  config: ChampionStatsConfig,
  input: {
    platform?: PlatformRoute;
    queueId?: number;
    tier?: ChampionStatsTierFilter;
    position?: ChampionRankingPosition;
    patch?: string;
    minimumSample?: number;
    includeInsufficient?: boolean;
  },
): Omit<ResolvedChampionStatsScope, 'patch' | 'usedDefaultPatch'> & {
  requestedPatch?: string;
} {
  const { platform, usedDefaultPlatform } = resolvePlatform(config, input.platform);
  const queueId = input.queueId ?? config.defaultQueueId;
  assertNotAllQueue(queueId);

  return {
    platform,
    usedDefaultPlatform,
    queueId,
    tier: input.tier ?? 'ALL',
    position: input.position ?? null,
    effectiveMinimumSample: computeEffectiveMinimumSample(config, input),
    includeInsufficient: input.includeInsufficient === true,
    requestedMinimumSample: input.minimumSample,
    requestedPatch: input.patch,
  };
}

export function toRequestedFiltersFromTable(query: ChampionStatsTableQuery) {
  return {
    ...(query.platform !== undefined ? { platform: query.platform } : {}),
    ...(query.patch !== undefined ? { patch: query.patch } : {}),
    ...(query.queueId !== undefined ? { queueId: query.queueId } : {}),
    ...(query.tier !== undefined ? { tier: query.tier } : {}),
    position: query.position,
    ...(query.minimumSample !== undefined ? { minimumSample: query.minimumSample } : {}),
    ...(query.includeInsufficient !== undefined
      ? { includeInsufficient: query.includeInsufficient }
      : {}),
  };
}

export function toRequestedFiltersFromStats(query: ChampionStatsQuery) {
  return {
    ...(query.platform !== undefined ? { platform: query.platform } : {}),
    ...(query.patch !== undefined ? { patch: query.patch } : {}),
    ...(query.queueId !== undefined ? { queueId: query.queueId } : {}),
    ...(query.tier !== undefined ? { tier: query.tier } : {}),
    ...(query.position !== undefined ? { position: query.position } : {}),
    ...(query.minimumSample !== undefined ? { minimumSample: query.minimumSample } : {}),
    ...(query.includeInsufficient !== undefined
      ? { includeInsufficient: query.includeInsufficient }
      : {}),
  };
}
