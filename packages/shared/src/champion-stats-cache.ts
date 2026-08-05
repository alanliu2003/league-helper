import { z } from 'zod';
import { PlatformRouteSchema, type PlatformRoute } from './routing';

/**
 * Generation scope for champion-stats Redis keys.
 * Default generation absence is API-owned; this package only builds key strings.
 */
export type ChampionStatsGenerationScope = {
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  platform: PlatformRoute;
  patch: string;
  queueId: number;
};

const GenerationScopeSchema = z.object({
  sourceNormalizationVersion: z.string().min(1),
  aggregationVersion: z.string().min(1),
  platform: PlatformRouteSchema,
  patch: z.string().min(1),
  queueId: z.number().int().nonnegative(),
});

function assertValidScope(scope: ChampionStatsGenerationScope): ChampionStatsGenerationScope {
  return GenerationScopeSchema.parse(scope);
}

/**
 * Canonical fixed-order JSON array tuple.
 * Order: sourceNormalizationVersion, aggregationVersion, platform, patch, queueId.
 */
export function serializeChampionStatsGenerationScope(scope: ChampionStatsGenerationScope): string {
  const valid = assertValidScope(scope);
  return JSON.stringify([
    valid.sourceNormalizationVersion,
    valid.aggregationVersion,
    valid.platform,
    valid.patch,
    valid.queueId,
  ]);
}

export function buildChampionStatsGenerationKey(scope: ChampionStatsGenerationScope): string {
  return `champ_stats:gen:${serializeChampionStatsGenerationScope(scope)}`;
}

export type ChampionStatsTableCacheKeyInput = {
  scope: ChampionStatsGenerationScope;
  generation: number;
  position: string;
  tier: string;
  sortBy: string;
  sortDirection: string;
  limit: number;
  offset?: number;
  cursor?: string;
  minimumSample: number;
  includeInsufficient: boolean;
};

export type ChampionStatsChampionCacheKeyInput = {
  scope: ChampionStatsGenerationScope;
  generation: number;
  championKey: string;
  position?: string | null;
  tier: string;
};

export type ChampionStatsFiltersCacheKeyInput = {
  scope: ChampionStatsGenerationScope;
  generation: number;
};

function assertGeneration(generation: number): number {
  return z.number().int().nonnegative().parse(generation);
}

/**
 * Response cache key for the champion ranking table.
 * Distinct prefix from single-champion and filters keys.
 */
export function buildChampionStatsTableCacheKey(input: ChampionStatsTableCacheKeyInput): string {
  const scopeKey = serializeChampionStatsGenerationScope(input.scope);
  const generation = assertGeneration(input.generation);
  const fingerprint = JSON.stringify([
    input.position,
    input.tier,
    input.sortBy,
    input.sortDirection,
    input.limit,
    input.offset ?? null,
    input.cursor ?? null,
    input.minimumSample,
    input.includeInsufficient,
  ]);
  return `champ_stats:table:${generation}:${scopeKey}:${fingerprint}`;
}

/**
 * Response cache key for a single champion stats envelope.
 */
export function buildChampionStatsChampionCacheKey(
  input: ChampionStatsChampionCacheKeyInput,
): string {
  const scopeKey = serializeChampionStatsGenerationScope(input.scope);
  const generation = assertGeneration(input.generation);
  const championKey = z.string().min(1).parse(input.championKey);
  const fingerprint = JSON.stringify([championKey, input.position ?? null, input.tier]);
  return `champ_stats:champion:${generation}:${scopeKey}:${fingerprint}`;
}

/**
 * Response cache key for champion-stats filters metadata.
 */
export function buildChampionStatsFiltersCacheKey(
  input: ChampionStatsFiltersCacheKeyInput,
): string {
  const scopeKey = serializeChampionStatsGenerationScope(input.scope);
  const generation = assertGeneration(input.generation);
  return `champ_stats:filters:${generation}:${scopeKey}`;
}
