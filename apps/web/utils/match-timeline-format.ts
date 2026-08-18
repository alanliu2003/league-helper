import {
  getNormalizedPositionLabel,
  matchTeamSide,
  type PublicMatchKillEvent,
  type PublicMatchObjectiveEvent,
  type PublicMatchTeamSide,
  type PublicMatchTimelineEvent,
  type PublicMatchTimelineParticipant,
} from '@league-helper/shared';

export function formatMatchClock(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function teamSideLabel(side: PublicMatchTeamSide): string {
  switch (side) {
    case 'BLUE':
      return 'Blue';
    case 'RED':
      return 'Red';
    default:
      return 'Unknown';
  }
}

export function findTimelineParticipant(
  participants: PublicMatchTimelineParticipant[],
  participantId: number | null,
): PublicMatchTimelineParticipant | null {
  if (participantId == null) {
    return null;
  }
  return participants.find((row) => row.participantId === participantId) ?? null;
}

export function formatParticipantActor(participant: PublicMatchTimelineParticipant): string {
  const side = teamSideLabel(participant.side);
  const role = getNormalizedPositionLabel(participant.teamPosition);
  const champion = participant.championName?.trim() || 'Unknown champion';
  return `${side} ${role} · ${champion}`;
}

export function formatKillFeedLine(
  kill: PublicMatchKillEvent,
  participants: PublicMatchTimelineParticipant[],
): string {
  const clock = formatMatchClock(kill.timestampMs);
  const killer =
    kill.killerKind === 'CHAMPION'
      ? findTimelineParticipant(participants, kill.killerParticipantId)
      : null;
  const victim = findTimelineParticipant(participants, kill.victimParticipantId);
  const killerLabel = killer ? formatParticipantActor(killer) : 'Environment';
  const victimLabel = victim ? formatParticipantActor(victim) : 'Unknown';
  return `${clock} ${killerLabel} kills ${victimLabel}`;
}

const OBJECTIVE_NOUN: Record<PublicMatchObjectiveEvent['type'], string> = {
  dragon: 'Dragon',
  baron: 'Baron',
  riftHerald: 'Rift Herald',
  tower: 'tower',
  inhibitor: 'inhibitor',
};

export function formatObjectiveLine(
  objective: PublicMatchObjectiveEvent,
  participants: PublicMatchTimelineParticipant[],
): string {
  const clock = formatMatchClock(objective.timestampMs);
  const killer =
    objective.killerKind === 'CHAMPION'
      ? findTimelineParticipant(participants, objective.killerParticipantId)
      : null;
  const killerLabel = killer ? formatParticipantActor(killer) : 'Environment';
  const noun = OBJECTIVE_NOUN[objective.type];
  if (objective.type === 'tower' || objective.type === 'inhibitor') {
    const ownerSide =
      objective.ownerTeamId != null ? teamSideLabel(matchTeamSide(objective.ownerTeamId)) : null;
    const ownerBit = ownerSide ? ` ${ownerSide}` : '';
    return `${clock} ${killerLabel} destroys${ownerBit} ${noun}`;
  }
  return `${clock} ${killerLabel} slays ${noun}`;
}

const ITEM_EVENT_TYPES = new Set(['ITEM_PURCHASED', 'ITEM_SOLD', 'ITEM_UNDO', 'ITEM_DESTROYED']);

export function isItemTimelineEvent(type: PublicMatchTimelineEvent['type']): boolean {
  return ITEM_EVENT_TYPES.has(type);
}

export function orderTimelineParticipants(
  participants: PublicMatchTimelineParticipant[],
  originPlayerId: string | null | undefined,
): PublicMatchTimelineParticipant[] {
  return [...participants].sort((left, right) => {
    const leftOrigin = originPlayerId != null && left.playerId === originPlayerId ? 0 : 1;
    const rightOrigin = originPlayerId != null && right.playerId === originPlayerId ? 0 : 1;
    if (leftOrigin !== rightOrigin) {
      return leftOrigin - rightOrigin;
    }
    return left.participantId - right.participantId;
  });
}

export function itemEventVerb(type: PublicMatchTimelineEvent['type']): string {
  switch (type) {
    case 'ITEM_PURCHASED':
      return 'purchased';
    case 'ITEM_SOLD':
      return 'sold';
    case 'ITEM_UNDO':
      return 'undo';
    case 'ITEM_DESTROYED':
      return 'destroyed';
    default:
      return type;
  }
}

export function matchDetailTabFromHash(hash: string): 'overview' | 'timeline' {
  const normalized = hash.startsWith('#') ? hash : hash ? `#${hash}` : '';
  return normalized === '#timeline' ? 'timeline' : 'overview';
}
