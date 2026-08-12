import { z } from 'zod';
import { RankScopeSchema, type RankScope } from './rank-scope';

/**
 * Product ranking floor for champion ranking eligibility.
 * Locked for M12-v2; do not lower.
 */
export const CHAMPION_STATS_RANKING_FLOOR = 30 as const;

/**
 * Product-facing statistic quality metadata.
 *
 * Intentionally excludes pipeline operational health
 * (PENDING counts, exactRankCoverage, resolution coverage).
 */
export const RankAwareProductQualityMetaSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  rankingEligible: z.boolean(),
  rankingFloor: z.literal(CHAMPION_STATS_RANKING_FLOOR),
  rankScope: RankScopeSchema,
  lowSample: z.boolean(),
  patch: z.string().min(1).optional(),
});
export type RankAwareProductQualityMeta = z.infer<typeof RankAwareProductQualityMetaSchema>;

export function buildRankAwareProductQualityMeta(input: {
  sampleSize: number;
  rankScope: RankScope;
  patch?: string;
  rankingFloor?: typeof CHAMPION_STATS_RANKING_FLOOR;
}): RankAwareProductQualityMeta {
  const rankingFloor = input.rankingFloor ?? CHAMPION_STATS_RANKING_FLOOR;
  if (rankingFloor !== CHAMPION_STATS_RANKING_FLOOR) {
    throw new Error(
      `Ranking floor must remain ${CHAMPION_STATS_RANKING_FLOOR}; received ${rankingFloor}.`,
    );
  }
  const sampleSize = z.number().int().nonnegative().parse(input.sampleSize);
  const rankingEligible = sampleSize >= rankingFloor;
  return RankAwareProductQualityMetaSchema.parse({
    sampleSize,
    rankingEligible,
    rankingFloor,
    rankScope: input.rankScope,
    lowSample: !rankingEligible,
    ...(input.patch !== undefined ? { patch: input.patch } : {}),
  });
}
