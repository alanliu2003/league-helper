import {
  PERSISTED_TIMELINE_EVENT_TYPES,
  PublicMatchTimelineDetailSchema,
  RiotIdSchema,
  coverageFromEventAndFrameRows,
  deriveTeamGoldSeries,
  mapPublicObjectiveType,
  matchTeamSide,
  normalizeParticipantPosition,
  publicSkillSlotLabel,
  sortMatchParticipants,
  sortMatchTeams,
  type ChampionBuildStaticIdentity,
  type PublicMatchKillEvent,
  type PublicMatchObjectiveEvent,
  type PublicMatchTimelineDetail,
  type PublicMatchTimelineEvent,
  type PublicMatchTimelineEventType,
  type PublicMatchTimelineParticipant,
  type RiotId,
} from '@league-helper/shared';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import type {
  MatchDetailRow,
  MatchTimelineEventRow,
  MatchTimelineFrameRow,
} from '../../persistence/match.repository';
import {
  identityFromItem,
  type MatchStaticIcons,
  type MatchStaticLookups,
} from './match-detail-static';
import { mapTimelineStatus, type MatchDetailMapContext } from './match-detail.mapper';

export type MatchTimelineEventLoad = MatchTimelineEventRow;
export type MatchTimelineFrameLoad = MatchTimelineFrameRow;

const PERSISTED_TYPE_SET = new Set<string>(PERSISTED_TIMELINE_EVENT_TYPES);

export type MatchTimelineMapInput = {
  row: MatchDetailRow;
  events: MatchTimelineEventLoad[];
  frames: MatchTimelineFrameLoad[];
  frameIntervalMs: number | null;
  ctx: MatchDetailMapContext;
};

function parseRiotIdOrNull(gameName: string | null | undefined, tagLine: string | null | undefined): RiotId | null {
  const parsed = RiotIdSchema.safeParse({
    gameName: gameName ?? '',
    tagLine: tagLine ?? '',
  });
  return parsed.success ? parsed.data : null;
}

function championIdentity(
  championId: number,
  storedName: string | null | undefined,
  champions: Map<number, DataDragonChampion>,
): { key: string | null; name: string | null; iconUrl: string | null } {
  const champion = champions.get(championId);
  const stored = storedName?.trim() ? storedName.trim() : null;
  return {
    key: champion?.id ?? null,
    name: champion?.name ?? stored ?? (championId > 0 ? `Champion ${championId}` : null),
    iconUrl: champion?.iconUrl ?? null,
  };
}

function publicParticipantId(id: number | null | undefined): number | null {
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

function publicAssistIds(ids: number[]): number[] {
  return ids.filter((id) => Number.isInteger(id) && id > 0);
}

function mapPosition(x: number | null, y: number | null): { x: number; y: number } | null {
  if (typeof x === 'number' && Number.isInteger(x) && typeof y === 'number' && Number.isInteger(y)) {
    return { x, y };
  }
  return null;
}

function publicFrameIntervalMs(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function isPersistedType(type: string): type is PublicMatchTimelineEventType {
  return PERSISTED_TYPE_SET.has(type);
}

function mapItemIdentity(
  itemId: number | null | undefined,
  lookups: MatchStaticLookups,
  icons: Pick<MatchStaticIcons, 'itemIcon'>,
): ChampionBuildStaticIdentity | null {
  if (itemId == null || itemId <= 0) {
    return null;
  }
  const identity = identityFromItem(itemId, lookups, icons);
  return { id: itemId, name: identity.name ?? `Item ${itemId}`, iconUrl: identity.iconUrl };
}

function primaryItemId(event: MatchTimelineEventLoad): number | null {
  for (const id of [event.itemId, event.afterItemId, event.beforeItemId]) {
    if (id != null && id > 0) {
      return id;
    }
  }
  return null;
}

function mapTimelineParticipant(
  row: MatchDetailRow['participants'][number],
  match: MatchDetailRow,
  ctx: MatchDetailMapContext,
): PublicMatchTimelineParticipant {
  const champion = championIdentity(row.championId, row.championName, ctx.champions);
  const riotId = row.playerAccount
    ? parseRiotIdOrNull(row.playerAccount.currentGameName, row.playerAccount.currentTagLine)
    : parseRiotIdOrNull(row.riotIdGameName, row.riotIdTagLine);

  return {
    participantId: row.participantId,
    teamId: row.teamId,
    side: matchTeamSide(row.teamId),
    playerId: row.playerAccount?.playerId ?? null,
    riotId,
    championId: row.championId,
    championKey: champion.key,
    championName: champion.name,
    championIconUrl: champion.iconUrl,
    teamPosition: normalizeParticipantPosition({
      queueId: match.queueId,
      mapId: match.mapId,
      gameMode: match.gameMode,
      remake: match.remake,
      teamPosition: row.teamPosition,
      individualPosition: row.individualPosition,
      lane: row.lane,
      role: row.role,
    }),
  };
}

function resolveKiller(
  killerParticipantId: number | null | undefined,
  byId: Map<number, PublicMatchTimelineParticipant>,
): { killerKind: 'CHAMPION' | 'ENVIRONMENT'; killerParticipantId: number | null } {
  const id = publicParticipantId(killerParticipantId);
  if (id != null && byId.has(id)) {
    return { killerKind: 'CHAMPION', killerParticipantId: id };
  }
  return { killerKind: 'ENVIRONMENT', killerParticipantId: null };
}

function mapPublicEvent(
  event: MatchTimelineEventLoad,
  ctx: MatchDetailMapContext,
): PublicMatchTimelineEvent {
  return {
    eventIndex: event.eventIndex,
    timestampMs: event.timestampMs,
    type: event.type as PublicMatchTimelineEventType,
    participantId: publicParticipantId(event.participantId),
    killerParticipantId: publicParticipantId(event.killerParticipantId),
    victimParticipantId: publicParticipantId(event.victimParticipantId),
    assistingParticipantIds: publicAssistIds(event.assistingParticipantIds),
    teamId: event.teamId,
    itemId: event.itemId,
    beforeItemId: event.beforeItemId,
    afterItemId: event.afterItemId,
    skillSlot: event.skillSlot,
    levelUpType: event.levelUpType,
    monsterType: event.monsterType,
    monsterSubType: event.monsterSubType,
    buildingType: event.buildingType,
    towerType: event.towerType,
    laneType: event.laneType,
    position: mapPosition(event.positionX, event.positionY),
    item: mapItemIdentity(primaryItemId(event), ctx.lookups, ctx.icons),
    skillLabel: publicSkillSlotLabel(event.skillSlot),
  };
}

function mapDerivedKill(
  event: MatchTimelineEventLoad,
  byId: Map<number, PublicMatchTimelineParticipant>,
): PublicMatchKillEvent | null {
  const victimParticipantId = publicParticipantId(event.victimParticipantId);
  if (victimParticipantId == null || !byId.has(victimParticipantId)) {
    return null;
  }
  const killer = resolveKiller(event.killerParticipantId, byId);
  return {
    timestampMs: event.timestampMs,
    killerKind: killer.killerKind,
    killerParticipantId: killer.killerParticipantId,
    victimParticipantId,
    assistingParticipantIds: publicAssistIds(event.assistingParticipantIds).filter((id) => byId.has(id)),
    position: mapPosition(event.positionX, event.positionY),
  };
}

function mapDerivedObjective(
  event: MatchTimelineEventLoad,
  byId: Map<number, PublicMatchTimelineParticipant>,
): PublicMatchObjectiveEvent | null {
  const type = mapPublicObjectiveType(event);
  if (type == null) {
    return null;
  }
  const killer = resolveKiller(event.killerParticipantId, byId);
  const isBuilding = event.type === 'BUILDING_KILL';
  const killerTeamId = isBuilding
    ? killer.killerKind === 'CHAMPION' && killer.killerParticipantId != null
      ? (byId.get(killer.killerParticipantId)?.teamId ?? null)
      : null
    : event.teamId;

  return {
    timestampMs: event.timestampMs,
    type,
    killerKind: killer.killerKind,
    killerParticipantId: killer.killerParticipantId,
    assistingParticipantIds: publicAssistIds(event.assistingParticipantIds).filter((id) => byId.has(id)),
    ownerTeamId: isBuilding ? event.teamId : null,
    killerTeamId,
    monsterSubType: event.monsterSubType,
    towerType: event.towerType,
    laneType: event.laneType,
    position: mapPosition(event.positionX, event.positionY),
  };
}

export function mapPublicMatchTimelineDetail(input: MatchTimelineMapInput): PublicMatchTimelineDetail {
  const teamIds = [...new Set(input.row.participants.map((participant) => participant.teamId))];
  const participants = sortMatchTeams(
    teamIds.map((teamId) => ({
      teamId,
      participants: sortMatchParticipants(
        input.row.participants
          .filter((participant) => participant.teamId === teamId)
          .map((participant) => mapTimelineParticipant(participant, input.row, input.ctx)),
      ),
    })),
  ).flatMap((team) => team.participants);

  const byId = new Map(participants.map((participant) => [participant.participantId, participant]));

  const events = [...input.events]
    .filter((event) => isPersistedType(event.type))
    .sort((a, b) => a.timestampMs - b.timestampMs || a.eventIndex - b.eventIndex)
    .map((event) => mapPublicEvent(event, input.ctx));

  const frames = [...input.frames]
    .filter((frame) => frame.participantId > 0)
    .sort((a, b) => a.timestampMs - b.timestampMs || a.participantId - b.participantId)
    .map((frame) => ({
      timestampMs: frame.timestampMs,
      participantId: frame.participantId,
      totalGold: frame.totalGold,
      xp: frame.xp,
      cs: frame.cs,
      level: frame.level,
    }));

  const derivedSource = [...input.events]
    .filter((event) => isPersistedType(event.type))
    .sort((a, b) => a.timestampMs - b.timestampMs || a.eventIndex - b.eventIndex);

  const kills = derivedSource
    .filter((event) => event.type === 'CHAMPION_KILL')
    .flatMap((event) => {
      const kill = mapDerivedKill(event, byId);
      return kill ? [kill] : [];
    });

  const objectives = derivedSource.flatMap((event) => {
    if (event.type !== 'ELITE_MONSTER_KILL' && event.type !== 'BUILDING_KILL') {
      return [];
    }
    const objective = mapDerivedObjective(event, byId);
    return objective ? [objective] : [];
  });

  return PublicMatchTimelineDetailSchema.parse({
    matchId: input.row.id,
    status: mapTimelineStatus(input.row.timeline?.fetchStatus),
    coverage: coverageFromEventAndFrameRows({ events: input.events, frames: input.frames }),
    frameIntervalMs: publicFrameIntervalMs(input.frameIntervalMs),
    participants,
    events,
    frames,
    derived: {
      kills,
      objectives,
      gold: deriveTeamGoldSeries({
        participants: participants.map((participant) => ({
          participantId: participant.participantId,
          teamId: participant.teamId,
        })),
        frames,
      }),
    },
  });
}
