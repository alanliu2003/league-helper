import { z } from 'zod';
import { ProviderIdSchema } from './provider-id';
import { PlatformRouteSchema } from './routing';

export const ChampionMasterySchema = z.object({
  provider: ProviderIdSchema,
  externalAccountId: z.string().min(1),
  platform: PlatformRouteSchema,
  championId: z.number().int(),
  championLevel: z.number().int().nonnegative(),
  championPoints: z.number().int().nonnegative(),
  lastPlayTime: z.string().datetime().optional(),
  chestGranted: z.boolean().optional(),
  tokensEarned: z.number().int().nonnegative().optional(),
});

export type ChampionMastery = z.infer<typeof ChampionMasterySchema>;
