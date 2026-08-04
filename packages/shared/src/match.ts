import { z } from 'zod';
import { ProviderIdSchema } from './provider-id';
import { TeamPositionSchema } from './positions';
import { PlatformRouteSchema, RegionalRouteSchema } from './routing';

export const MatchParticipantSchema = z.object({
  provider: ProviderIdSchema,
  externalAccountId: z.string().min(1).optional(),
  riotGameName: z.string().optional(),
  riotTagLine: z.string().optional(),
  championId: z.number().int(),
  championName: z.string().min(1).optional(),
  teamId: z.number().int(),
  teamPosition: TeamPositionSchema,
  win: z.boolean(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  individualPosition: z.string().optional(),
});

export type MatchParticipant = z.infer<typeof MatchParticipantSchema>;

export const MatchSummarySchema = z.object({
  provider: ProviderIdSchema,
  matchId: z.string().min(1),
  platform: PlatformRouteSchema.optional(),
  regionalRoute: RegionalRouteSchema,
  queueId: z.number().int(),
  gameCreation: z.string().datetime(),
  gameDurationSeconds: z.number().int().nonnegative(),
  gameVersion: z.string().min(1),
  patchLabel: z.string().min(1).nullable(),
  participants: z.array(MatchParticipantSchema),
});

export type MatchSummary = z.infer<typeof MatchSummarySchema>;
