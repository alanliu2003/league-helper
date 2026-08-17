import { z } from 'zod';
import { ChampionBuildStaticIdentitySchema } from './champion-builds';
import { PublicMatchTeamSideSchema, matchTeamSide, sortMatchTeams } from './match-detail';
import { NormalizedPositionSchema } from './normalized-position';
import { RiotIdSchema } from './riot-id';

export const PublicMatchTimelineCoverageSchema = z.object({
  items: z.boolean(),
  skills: z.boolean(),
  kills: z.boolean(),
  objectives: z.boolean(),
  frames: z.boolean(),
});
export type PublicMatchTimelineCoverage = z.infer<typeof PublicMatchTimelineCoverageSchema>;

export const PERSISTED_TIMELINE_EVENT_TYPES = [
  'ITEM_PURCHASED',
  'ITEM_SOLD',
  'ITEM_UNDO',
  'ITEM_DESTROYED',
  'SKILL_LEVEL_UP',
  'CHAMPION_KILL',
  'ELITE_MONSTER_KILL',
  'BUILDING_KILL',
] as const;

export const PublicMatchTimelineEventTypeSchema = z.enum(PERSISTED_TIMELINE_EVENT_TYPES);
export type PublicMatchTimelineEventType = z.infer<typeof PublicMatchTimelineEventTypeSchema>;

export const PublicMatchTimelineParticipantSchema = z.object({
  participantId: z.number().int().positive(),
  teamId: z.number().int(),
  side: PublicMatchTeamSideSchema,
  playerId: z.string().uuid().nullable(),
  riotId: RiotIdSchema.nullable(),
  championId: z.number().int(),
  championKey: z.string().min(1).nullable(),
  championName: z.string().min(1).nullable(),
  championIconUrl: z.string().url().nullable(),
  teamPosition: NormalizedPositionSchema,
});
export type PublicMatchTimelineParticipant = z.infer<typeof PublicMatchTimelineParticipantSchema>;

export const PublicMatchPositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type PublicMatchPosition = z.infer<typeof PublicMatchPositionSchema>;

export const PublicMatchTimelineEventSchema = z.object({
  eventIndex: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  type: PublicMatchTimelineEventTypeSchema,
  participantId: z.number().int().nullable(),
  killerParticipantId: z.number().int().nullable(),
  victimParticipantId: z.number().int().nullable(),
  assistingParticipantIds: z.array(z.number().int()),
  teamId: z.number().int().nullable(),
  itemId: z.number().int().nullable(),
  beforeItemId: z.number().int().nullable(),
  afterItemId: z.number().int().nullable(),
  skillSlot: z.number().int().nullable(),
  levelUpType: z.string().nullable(),
  monsterType: z.string().nullable(),
  monsterSubType: z.string().nullable(),
  buildingType: z.string().nullable(),
  towerType: z.string().nullable(),
  laneType: z.string().nullable(),
  position: PublicMatchPositionSchema.nullable(),
  item: ChampionBuildStaticIdentitySchema.nullable(),
  skillLabel: z.enum(['Q', 'W', 'E', 'R']).nullable(),
});
export type PublicMatchTimelineEvent = z.infer<typeof PublicMatchTimelineEventSchema>;

export const PublicMatchKillEventSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  killerKind: z.enum(['CHAMPION', 'ENVIRONMENT']),
  killerParticipantId: z.number().int().nullable(),
  victimParticipantId: z.number().int(),
  assistingParticipantIds: z.array(z.number().int()),
  position: PublicMatchPositionSchema.nullable(),
});
export type PublicMatchKillEvent = z.infer<typeof PublicMatchKillEventSchema>;

export const PublicMatchObjectiveEventTypeSchema = z.enum([
  'dragon',
  'baron',
  'riftHerald',
  'tower',
  'inhibitor',
]);
export type PublicMatchObjectiveEventType = z.infer<typeof PublicMatchObjectiveEventTypeSchema>;

export const PublicMatchObjectiveEventSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  type: PublicMatchObjectiveEventTypeSchema,
  killerKind: z.enum(['CHAMPION', 'ENVIRONMENT']),
  killerParticipantId: z.number().int().nullable(),
  assistingParticipantIds: z.array(z.number().int()),
  ownerTeamId: z.number().int().nullable(),
  killerTeamId: z.number().int().nullable(),
  monsterSubType: z.string().nullable(),
  towerType: z.string().nullable(),
  laneType: z.string().nullable(),
  position: PublicMatchPositionSchema.nullable(),
});
export type PublicMatchObjectiveEvent = z.infer<typeof PublicMatchObjectiveEventSchema>;

export const PublicMatchTimelineFrameSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  participantId: z.number().int().positive(),
  totalGold: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  cs: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
});
export type PublicMatchTimelineFrame = z.infer<typeof PublicMatchTimelineFrameSchema>;

export const PublicMatchGoldSeriesSchema = z.object({
  timestampsMs: z.array(z.number().int().nonnegative()),
  teams: z.array(
    z.object({
      teamId: z.number().int(),
      side: PublicMatchTeamSideSchema,
      gold: z.array(z.number().int().nonnegative()),
    }),
  ),
  participants: z.array(
    z.object({
      participantId: z.number().int().positive(),
      gold: z.array(z.number().int().nonnegative()),
    }),
  ),
  difference: z.array(z.number().int()).nullable(),
});
export type PublicMatchGoldSeries = z.infer<typeof PublicMatchGoldSeriesSchema>;

export const PublicMatchTimelineDetailSchema = z.object({
  matchId: z.string().uuid(),
  status: z.enum(['PENDING', 'AVAILABLE', 'UNAVAILABLE']),
  coverage: PublicMatchTimelineCoverageSchema,
  frameIntervalMs: z.number().int().positive().nullable(),
  participants: z.array(PublicMatchTimelineParticipantSchema),
  events: z.array(PublicMatchTimelineEventSchema),
  frames: z.array(PublicMatchTimelineFrameSchema),
  derived: z.object({
    kills: z.array(PublicMatchKillEventSchema),
    objectives: z.array(PublicMatchObjectiveEventSchema),
    gold: PublicMatchGoldSeriesSchema,
  }),
});
export type PublicMatchTimelineDetail = z.infer<typeof PublicMatchTimelineDetailSchema>;

const ITEM_COVERAGE_EVENT_TYPES = new Set([
  'ITEM_PURCHASED',
  'ITEM_SOLD',
  'ITEM_UNDO',
  'ITEM_DESTROYED',
]);

export function mapPublicObjectiveType(input: {
  monsterType?: string | null;
  buildingType?: string | null;
}): PublicMatchObjectiveEventType | null {
  switch (input.monsterType) {
    case 'DRAGON':
      return 'dragon';
    case 'BARON_NASHOR':
      return 'baron';
    case 'RIFTHERALD':
      return 'riftHerald';
    default:
      break;
  }

  switch (input.buildingType) {
    case 'TOWER_BUILDING':
      return 'tower';
    case 'INHIBITOR_BUILDING':
      return 'inhibitor';
    default:
      return null;
  }
}

export function publicSkillSlotLabel(
  slot: number | null | undefined,
): 'Q' | 'W' | 'E' | 'R' | null {
  switch (slot) {
    case 1:
      return 'Q';
    case 2:
      return 'W';
    case 3:
      return 'E';
    case 4:
      return 'R';
    default:
      return null;
  }
}

type GoldSeriesParticipant = { participantId: number; teamId: number };
type GoldSeriesFrame = { timestampMs: number; participantId: number; totalGold: number };

export function deriveTeamGoldSeries(input: {
  participants: GoldSeriesParticipant[];
  frames: GoldSeriesFrame[];
}): PublicMatchGoldSeries {
  const requiredIds = input.participants.map((participant) => participant.participantId);
  const goldByTimestamp = new Map<number, Map<number, number>>();

  for (const frame of input.frames) {
    let goldByParticipant = goldByTimestamp.get(frame.timestampMs);
    if (!goldByParticipant) {
      goldByParticipant = new Map();
      goldByTimestamp.set(frame.timestampMs, goldByParticipant);
    }
    goldByParticipant.set(frame.participantId, frame.totalGold);
  }

  const timestampsMs = [...goldByTimestamp.keys()]
    .sort((a, b) => a - b)
    .filter((timestampMs) => {
      const goldByParticipant = goldByTimestamp.get(timestampMs);
      return goldByParticipant != null && requiredIds.every((id) => goldByParticipant.has(id));
    });

  const goldAt = (timestampMs: number, participantId: number): number => {
    const gold = goldByTimestamp.get(timestampMs)?.get(participantId);
    if (gold === undefined) {
      throw new Error('Incomplete timestamp leaked into gold series');
    }
    return gold;
  };

  const teamIds = [...new Set(input.participants.map((participant) => participant.teamId))];
  const teams = sortMatchTeams(
    teamIds.map((teamId) => {
      const memberIds = input.participants
        .filter((participant) => participant.teamId === teamId)
        .map((participant) => participant.participantId);
      return {
        teamId,
        side: matchTeamSide(teamId),
        gold: timestampsMs.map((timestampMs) =>
          memberIds.reduce((sum, participantId) => sum + goldAt(timestampMs, participantId), 0),
        ),
      };
    }),
  );

  const hasBlue = input.participants.some((participant) => participant.teamId === 100);
  const hasRed = input.participants.some((participant) => participant.teamId === 200);
  const blue = teams.find((team) => team.teamId === 100);
  const red = teams.find((team) => team.teamId === 200);
  const difference =
    hasBlue && hasRed && blue && red
      ? timestampsMs.map((_, index) => {
          const blueGold = blue.gold[index];
          const redGold = red.gold[index];
          if (blueGold === undefined || redGold === undefined) {
            throw new Error('Incomplete timestamp leaked into gold series');
          }
          return blueGold - redGold;
        })
      : null;

  return {
    timestampsMs,
    teams,
    participants: input.participants.map((participant) => ({
      participantId: participant.participantId,
      gold: timestampsMs.map((timestampMs) => goldAt(timestampMs, participant.participantId)),
    })),
    difference,
  };
}

export function coverageFromEventAndFrameRows(input: {
  events: Array<{ type: string; monsterType?: string | null; buildingType?: string | null }>;
  frames: unknown[];
}): PublicMatchTimelineCoverage {
  return {
    items: input.events.some((event) => ITEM_COVERAGE_EVENT_TYPES.has(event.type)),
    skills: input.events.some((event) => event.type === 'SKILL_LEVEL_UP'),
    kills: input.events.some((event) => event.type === 'CHAMPION_KILL'),
    objectives: input.events.some((event) => mapPublicObjectiveType(event) != null),
    frames: input.frames.length > 0,
  };
}
