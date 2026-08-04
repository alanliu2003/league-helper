import { z } from 'zod';
import { ProviderIdSchema } from './provider-id';
import { RankDivisionSchema, RankTierSchema } from './ranks';
import { QueueTypeSchema } from './queues';
import { RiotIdSchema } from './riot-id';
import { PlatformRouteSchema, RegionalRouteSchema } from './routing';

/**
 * Provider-neutral player account.
 * For Riot, `externalAccountId` is the PUUID (persistent identity), not the Riot ID.
 */
export const PlayerAccountSchema = z.object({
  provider: ProviderIdSchema,
  /** Persistent external account id for the provider (Riot: PUUID). */
  externalAccountId: z.string().min(1),
  riotId: RiotIdSchema,
  platform: PlatformRouteSchema,
  regionalRoute: RegionalRouteSchema,
  /** Encrypted summoner id when the provider still returns it (may be omitted). */
  summonerId: z.string().min(1).nullable().optional(),
  /** Encrypted account id when the provider still returns it (may be omitted). */
  accountId: z.string().min(1).nullable().optional(),
  profileIconId: z.number().int().nullable().optional(),
  summonerLevel: z.number().int().nonnegative().nullable().optional(),
});

export type PlayerAccount = z.infer<typeof PlayerAccountSchema>;

export const RankedEntrySchema = z.object({
  provider: ProviderIdSchema,
  externalAccountId: z.string().min(1),
  platform: PlatformRouteSchema,
  queueType: QueueTypeSchema,
  tier: RankTierSchema,
  division: RankDivisionSchema.nullable(),
  leaguePoints: z.number().int(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  veteran: z.boolean().optional(),
  inactive: z.boolean().optional(),
  freshBlood: z.boolean().optional(),
  hotStreak: z.boolean().optional(),
});

export type RankedEntry = z.infer<typeof RankedEntrySchema>;
