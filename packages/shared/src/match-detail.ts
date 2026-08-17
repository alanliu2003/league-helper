import { z } from 'zod';
import { ChampionBuildStaticIdentitySchema } from './champion-builds';
import { NormalizedPositionSchema, type NormalizedPosition } from './normalized-position';
import { PublicMatchIngestionStatusSchema } from './player-api';
import { RiotIdSchema } from './riot-id';
import { PlatformRouteSchema, RegionalRouteSchema } from './routing';

export const PublicMatchTeamSideSchema = z.enum(['BLUE', 'RED', 'UNKNOWN']);
export type PublicMatchTeamSide = z.infer<typeof PublicMatchTeamSideSchema>;

export const PublicMatchTimelineStatusSchema = z.enum(['PENDING', 'AVAILABLE', 'UNAVAILABLE']);
export type PublicMatchTimelineStatus = z.infer<typeof PublicMatchTimelineStatusSchema>;

export const PublicMatchItemSlotSchema = z.object({
  slot: z.number().int().min(0).max(6),
  itemId: z.number().int().nonnegative(),
  name: z.string().min(1).nullable(),
  iconUrl: z.string().url().nullable(),
});
export type PublicMatchItemSlot = z.infer<typeof PublicMatchItemSlotSchema>;

export const PublicMatchObjectiveSchema = z.object({
  type: z.enum(['baron', 'dragon', 'riftHerald', 'tower', 'inhibitor', 'champion']),
  kills: z.number().int().nonnegative(),
  first: z.boolean().nullable(),
});
export type PublicMatchObjective = z.infer<typeof PublicMatchObjectiveSchema>;

export const PublicMatchParticipantSchema = z.object({
  participantId: z.number().int().positive(),
  teamId: z.number().int(),
  playerId: z.string().uuid().nullable(),
  riotId: RiotIdSchema.nullable(),
  championId: z.number().int(),
  championKey: z.string().min(1).nullable(),
  championName: z.string().min(1).nullable(),
  championIconUrl: z.string().url().nullable(),
  teamPosition: NormalizedPositionSchema,
  win: z.boolean(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  kda: z.number().nonnegative().nullable(),
  totalCs: z.number().int().nonnegative(),
  csPerMinute: z.number().nonnegative().nullable(),
  goldEarned: z.number().int().nonnegative(),
  goldPerMinute: z.number().nonnegative().nullable(),
  totalDamageDealtToChampions: z.number().int().nonnegative(),
  damageShare: z.number().min(0).max(1).nullable(),
  totalDamageTaken: z.number().int().nonnegative(),
  visionScore: z.number().int().nonnegative(),
  wardsPlaced: z.number().int().nonnegative(),
  wardsKilled: z.number().int().nonnegative(),
  controlWardsPurchased: z.number().int().nonnegative().nullable(),
  killParticipation: z.number().min(0).max(1).nullable(),
  items: z.array(PublicMatchItemSlotSchema).length(7),
  summonerSpells: z.tuple([
    ChampionBuildStaticIdentitySchema.nullable(),
    ChampionBuildStaticIdentitySchema.nullable(),
  ]),
  keystone: ChampionBuildStaticIdentitySchema.nullable(),
  primaryPerkStyle: ChampionBuildStaticIdentitySchema.nullable(),
  secondaryPerkStyle: ChampionBuildStaticIdentitySchema.nullable(),
  statShards: z.array(ChampionBuildStaticIdentitySchema),
  goldAt10: z.number().int().nullable(),
  goldAt15: z.number().int().nullable(),
  csAt10: z.number().int().nullable(),
  csAt15: z.number().int().nullable(),
  xpAt10: z.number().int().nullable(),
  xpAt15: z.number().int().nullable(),
  goldDifferenceAt10: z.number().int().nullable(),
  goldDifferenceAt15: z.number().int().nullable(),
  csDifferenceAt10: z.number().int().nullable(),
  csDifferenceAt15: z.number().int().nullable(),
  xpDifferenceAt10: z.number().int().nullable(),
  xpDifferenceAt15: z.number().int().nullable(),
  deathsBefore10: z.number().int().nullable(),
  deathsBetween10And20: z.number().int().nullable(),
});
export type PublicMatchParticipant = z.infer<typeof PublicMatchParticipantSchema>;

export const PublicMatchTeamTotalsSchema = z.object({
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  goldEarned: z.number().int().nonnegative(),
  damageDealtToChampions: z.number().int().nonnegative(),
  visionScore: z.number().int().nonnegative(),
});
export type PublicMatchTeamTotals = z.infer<typeof PublicMatchTeamTotalsSchema>;

export const PublicMatchTeamSchema = z.object({
  teamId: z.number().int(),
  side: PublicMatchTeamSideSchema,
  win: z.boolean(),
  bans: z.array(ChampionBuildStaticIdentitySchema),
  objectives: z.array(PublicMatchObjectiveSchema),
  totals: PublicMatchTeamTotalsSchema,
  participants: z.array(PublicMatchParticipantSchema),
});
export type PublicMatchTeam = z.infer<typeof PublicMatchTeamSchema>;

export const PublicMatchProductCoverageSchema = z.enum(['NONE', 'STORED', 'INELIGIBLE']);
export type PublicMatchProductCoverage = z.infer<typeof PublicMatchProductCoverageSchema>;

export const PublicMatchTimelineSchema = z.object({
  status: PublicMatchTimelineStatusSchema,
  metricsAvailable: z.boolean(),
  productCoverage: PublicMatchProductCoverageSchema,
  productAvailable: z.boolean(),
});
export type PublicMatchTimeline = z.infer<typeof PublicMatchTimelineSchema>;

export const PublicMatchDetailSchema = z.object({
  match: z.object({
    id: z.string().uuid(),
    queueId: z.number().int(),
    queueLabel: z.string().min(1),
    platform: PlatformRouteSchema.nullable(),
    regionalRoute: RegionalRouteSchema,
    mapId: z.number().int().nullable(),
    gameMode: z.string().min(1).nullable(),
    gameCreation: z.string().datetime(),
    gameEndTimestamp: z.string().datetime().nullable(),
    gameDurationSeconds: z.number().int().nonnegative(),
    gameVersion: z.string().min(1),
    normalizedPatch: z.string().nullable(),
    remake: z.boolean(),
    earlySurrender: z.boolean(),
    ingestionStatus: PublicMatchIngestionStatusSchema,
    winningSide: PublicMatchTeamSideSchema.nullable(),
  }),
  timeline: PublicMatchTimelineSchema,
  teams: z.array(PublicMatchTeamSchema),
});
export type PublicMatchDetail = z.infer<typeof PublicMatchDetailSchema>;

export const MATCH_OBJECTIVE_DISPLAY_ORDER = [
  'dragon',
  'baron',
  'riftHerald',
  'tower',
  'inhibitor',
] as const;

const KNOWN_OBJECTIVE_TYPES = [
  'baron',
  'champion',
  'dragon',
  'inhibitor',
  'riftHerald',
  'tower',
] as const;

type KnownObjectiveType = (typeof KNOWN_OBJECTIVE_TYPES)[number];

const POSITION_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT', 'UNKNOWN'] as const;

export function matchTeamSide(teamId: number): PublicMatchTeamSide {
  if (teamId === 100) return 'BLUE';
  if (teamId === 200) return 'RED';
  return 'UNKNOWN';
}

export function parseMatchTeamObjectives(value: unknown): PublicMatchObjective[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const parsed: PublicMatchObjective[] = [];

  for (const type of KNOWN_OBJECTIVE_TYPES) {
    const entry = record[type];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const objective = entry as Record<string, unknown>;
    if (
      typeof objective.kills !== 'number' ||
      !Number.isInteger(objective.kills) ||
      objective.kills < 0
    ) {
      continue;
    }

    parsed.push({
      type,
      kills: objective.kills,
      first: typeof objective.first === 'boolean' ? objective.first : null,
    });
  }

  const displayIndex = (type: KnownObjectiveType) => {
    const index = MATCH_OBJECTIVE_DISPLAY_ORDER.indexOf(
      type as (typeof MATCH_OBJECTIVE_DISPLAY_ORDER)[number],
    );
    return index === -1 ? MATCH_OBJECTIVE_DISPLAY_ORDER.length : index;
  };

  return parsed.sort((a, b) => displayIndex(a.type) - displayIndex(b.type));
}

export function sortMatchParticipants<
  T extends { teamPosition: NormalizedPosition; participantId: number },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = POSITION_ORDER.indexOf(a.teamPosition) - POSITION_ORDER.indexOf(b.teamPosition);
    return d !== 0 ? d : a.participantId - b.participantId;
  });
}

export function sortMatchTeams<T extends { teamId: number }>(teams: T[]): T[] {
  return [...teams].sort((a, b) => {
    const rank = (id: number) => (id === 100 ? 0 : id === 200 ? 1 : 2 + id);
    return rank(a.teamId) - rank(b.teamId);
  });
}

export function winningSideFromTeams(
  remake: boolean,
  teams: Array<{ side: PublicMatchTeamSide; win: boolean }>,
): PublicMatchTeamSide | null {
  if (remake) return null;
  const winners = teams.filter((t) => t.win);
  if (winners.length !== 1) return null;
  return winners[0]!.side;
}

export function participantHasTimelineMetrics(p: {
  goldAt10: number | null;
  goldAt15: number | null;
  csAt10: number | null;
  csAt15: number | null;
  xpAt10: number | null;
  xpAt15: number | null;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  xpDifferenceAt10: number | null;
  xpDifferenceAt15: number | null;
  killParticipation: number | null;
}): boolean {
  return (
    p.goldAt10 != null ||
    p.goldAt15 != null ||
    p.csAt10 != null ||
    p.csAt15 != null ||
    p.xpAt10 != null ||
    p.xpAt15 != null ||
    p.goldDifferenceAt10 != null ||
    p.goldDifferenceAt15 != null ||
    p.csDifferenceAt10 != null ||
    p.csDifferenceAt15 != null ||
    p.xpDifferenceAt10 != null ||
    p.xpDifferenceAt15 != null ||
    p.killParticipation != null
  );
}
