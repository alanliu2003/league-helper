import { z } from 'zod';
import { ProviderIdSchema } from './provider-id';
import { RankDivisionSchema, RankTierSchema } from './ranks';
import { QueueTypeSchema } from './queues';
import { RiotIdSchema } from './riot-id';
import {
  PlatformRouteSchema,
  RegionalRouteSchema,
  parsePlatformRoute,
  type PlatformRoute,
} from './routing';

/** Public refresh lifecycle states for search/refresh responses. */
export const PlayerRefreshStateSchema = z.enum([
  'IDLE',
  'PROCESSING',
  'PARTIAL',
  'COMPLETE',
  'RATE_LIMITED',
  'FAILED',
  'STALE',
]);

export type PlayerRefreshState = z.infer<typeof PlayerRefreshStateSchema>;

export const PlayerSafeWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

export type PlayerSafeWarning = z.infer<typeof PlayerSafeWarningSchema>;

/** Public player identity — never includes PUUID. */
export const PublicPlayerSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  provider: ProviderIdSchema,
  platform: PlatformRouteSchema,
  regionalRoute: RegionalRouteSchema,
  riotId: RiotIdSchema,
  profileIconId: z.number().int().nullable(),
  summonerLevel: z.number().int().nonnegative().nullable(),
  lastResolvedAt: z.string().datetime().nullable(),
});

export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

export const PublicRankSummarySchema = z.object({
  id: z.string().uuid(),
  queueType: QueueTypeSchema,
  tier: RankTierSchema,
  division: RankDivisionSchema.nullable(),
  leaguePoints: z.number().int(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  veteran: z.boolean(),
  inactive: z.boolean(),
  freshBlood: z.boolean(),
  hotStreak: z.boolean(),
  capturedAt: z.string().datetime(),
});

export type PublicRankSummary = z.infer<typeof PublicRankSummarySchema>;

export const PublicMasterySummarySchema = z.object({
  id: z.string().uuid(),
  championId: z.number().int(),
  championLevel: z.number().int().nonnegative(),
  championPoints: z.number().int().nonnegative(),
  lastPlayTime: z.string().datetime().nullable(),
  chestGranted: z.boolean().nullable(),
  tokensEarned: z.number().int().nonnegative().nullable(),
  capturedAt: z.string().datetime(),
});

export type PublicMasterySummary = z.infer<typeof PublicMasterySummarySchema>;

/** Stored match summary for list endpoints — never raw provider JSON. */
export const PublicMatchSummarySchema = z.object({
  id: z.string().uuid(),
  externalMatchId: z.string().min(1),
  queueId: z.number().int(),
  gameCreation: z.string().datetime(),
  gameDurationSeconds: z.number().int().nonnegative(),
  gameVersion: z.string().min(1),
  remake: z.boolean(),
  championId: z.number().int().nullable(),
  win: z.boolean().nullable(),
  kills: z.number().int().nonnegative().nullable(),
  deaths: z.number().int().nonnegative().nullable(),
  assists: z.number().int().nonnegative().nullable(),
});

export type PublicMatchSummary = z.infer<typeof PublicMatchSummarySchema>;

export const PlayerRefreshStatusSchema = z.object({
  state: PlayerRefreshStateSchema,
  requestedMatchCount: z.number().int().nonnegative(),
  discoveredMatchCount: z.number().int().nonnegative(),
  knownMatchCount: z.number().int().nonnegative(),
  queuedMatchCount: z.number().int().nonnegative(),
  activeMatchCount: z.number().int().nonnegative(),
  delayedMatchCount: z.number().int().nonnegative(),
  completedMatchCount: z.number().int().nonnegative(),
  failedMatchCount: z.number().int().nonnegative(),
  lastResolvedAt: z.string().datetime().nullable(),
  lastRefreshStartedAt: z.string().datetime().nullable(),
  lastRefreshCompletedAt: z.string().datetime().nullable(),
  lastRefreshedAt: z.string().datetime().nullable(),
  isStale: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  warnings: z.array(PlayerSafeWarningSchema),
});

export type PlayerRefreshStatus = z.infer<typeof PlayerRefreshStatusSchema>;

export const PlayerSearchResponseSchema = z.object({
  player: PublicPlayerSchema,
  ranks: z.array(PublicRankSummarySchema),
  mastery: z.array(PublicMasterySummarySchema),
  matches: z.array(PublicMatchSummarySchema),
  refresh: PlayerRefreshStatusSchema,
});

export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;

export const PlayerProfileResponseSchema = PlayerSearchResponseSchema;
export type PlayerProfileResponse = PlayerSearchResponse;

export const PlayerSearchRequestSchema = z.object({
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
  platform: z
    .string()
    .min(1)
    .transform((value): PlatformRoute => parsePlatformRoute(value)),
  matchCount: z.number().int().positive().max(100).optional(),
});

export type PlayerSearchRequest = z.infer<typeof PlayerSearchRequestSchema>;

export const PlayerRefreshRequestSchema = z.object({
  matchCount: z.number().int().positive().max(100).optional(),
  queueId: z.number().int().positive().optional(),
  force: z.boolean().optional().default(false),
});

export type PlayerRefreshRequest = z.infer<typeof PlayerRefreshRequestSchema>;

export const PlayerRanksQuerySchema = z.object({
  queueType: QueueTypeSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export type PlayerRanksQuery = z.infer<typeof PlayerRanksQuerySchema>;

export const PlayerMasteryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(10),
  championId: z.coerce.number().int().optional(),
  latestOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return true;
      }
      if (typeof value === 'boolean') {
        return value;
      }
      return value === 'true';
    }),
  cursor: z.string().min(1).optional(),
});

export type PlayerMasteryQuery = z.infer<typeof PlayerMasteryQuerySchema>;

export const PlayerMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().min(1).optional(),
  queueId: z.coerce.number().int().optional(),
  championId: z.coerce.number().int().optional(),
  result: z.enum(['win', 'loss']).optional(),
  includeRemakes: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return false;
      }
      if (typeof value === 'boolean') {
        return value;
      }
      return value === 'true';
    }),
});

export type PlayerMatchesQuery = z.infer<typeof PlayerMatchesQuerySchema>;

export const CursorPageSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    refresh: PlayerRefreshStatusSchema.optional(),
  });
