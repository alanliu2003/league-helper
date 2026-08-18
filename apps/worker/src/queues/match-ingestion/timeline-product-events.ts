import type { RiotTimelineEventDto } from '@league-helper/server-riot';

/** Event types persisted for M19 product timeline (build + kills + objectives). */
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

export type PersistedTimelineEventType = (typeof PERSISTED_TIMELINE_EVENT_TYPES)[number];

export type PersistedTimelineEvent = {
  eventIndex: number;
  type: PersistedTimelineEventType;
  timestampMs: number;
  participantId: number | null;
  itemId: number | null;
  beforeItemId: number | null;
  afterItemId: number | null;
  skillSlot: number | null;
  levelUpType: string | null;
  killerParticipantId: number | null;
  victimParticipantId: number | null;
  assistingParticipantIds: number[];
  teamId: number | null;
  positionX: number | null;
  positionY: number | null;
  monsterType: string | null;
  monsterSubType: string | null;
  buildingType: string | null;
  towerType: string | null;
  laneType: string | null;
};

const PERSISTED_TYPE_SET = new Set<string>(PERSISTED_TIMELINE_EVENT_TYPES);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asOptionalInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
    ? value
    : null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readPositionComponent(
  position: RiotTimelineEventDto['position'] | undefined,
  axis: 'x' | 'y',
): number | null {
  if (!position) {
    return null;
  }
  return asOptionalInt(position[axis]);
}

/**
 * Compact allowlisted timeline events for product persist.
 * Does not copy unknown Riot fields or metadata.participants.
 */
export function extractPersistedTimelineEvents(
  events: RiotTimelineEventDto[],
): PersistedTimelineEvent[] {
  const persisted: PersistedTimelineEvent[] = [];
  let eventIndex = 0;

  for (const event of events) {
    if (!PERSISTED_TYPE_SET.has(event.type)) {
      continue;
    }
    const record = asRecord(event);
    persisted.push({
      eventIndex,
      type: event.type as PersistedTimelineEventType,
      timestampMs: event.timestamp,
      participantId: asOptionalInt(event.participantId),
      itemId: asOptionalInt(event.itemId),
      beforeItemId: asOptionalInt(record.beforeId),
      afterItemId: asOptionalInt(record.afterId),
      skillSlot: asOptionalInt(event.skillSlot),
      levelUpType: asOptionalString(event.levelUpType),
      killerParticipantId: asOptionalInt(event.killerId),
      victimParticipantId: asOptionalInt(event.victimId),
      assistingParticipantIds: Array.isArray(event.assistingParticipantIds)
        ? event.assistingParticipantIds.filter((id) => Number.isInteger(id))
        : [],
      teamId: asOptionalInt(event.teamId) ?? asOptionalInt(record.killerTeamId),
      positionX: readPositionComponent(event.position, 'x'),
      positionY: readPositionComponent(event.position, 'y'),
      monsterType: asOptionalString(event.monsterType),
      monsterSubType: asOptionalString(event.monsterSubType),
      buildingType: asOptionalString(event.buildingType),
      towerType: asOptionalString(event.towerType),
      laneType: asOptionalString(event.laneType),
    });
    eventIndex += 1;
  }

  return persisted;
}
