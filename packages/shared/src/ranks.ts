import { z } from 'zod';

export const RankTierSchema = z.enum([
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
]);

export type RankTier = z.infer<typeof RankTierSchema>;

export const RankDivisionSchema = z.enum(['I', 'II', 'III', 'IV']);

export type RankDivision = z.infer<typeof RankDivisionSchema>;
