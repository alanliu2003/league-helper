import type { RiotTimelineEventDto } from '@league-helper/server-riot';

/** Timeline event types required for future OP.GG-style build/skill reconstruction. */
export const BUILD_RELEVANT_TIMELINE_EVENT_TYPES = [
  'ITEM_PURCHASED',
  'ITEM_SOLD',
  'ITEM_UNDO',
  'ITEM_DESTROYED',
  'SKILL_LEVEL_UP',
] as const;

export type BuildRelevantTimelineEventType =
  (typeof BUILD_RELEVANT_TIMELINE_EVENT_TYPES)[number];

export type PreservedTimelineEvent = {
  eventIndex: number;
  type: BuildRelevantTimelineEventType;
  timestampMs: number;
  participantId: number | null;
  itemId: number | null;
  beforeItemId: number | null;
  afterItemId: number | null;
  skillSlot: number | null;
  levelUpType: string | null;
};

const BUILD_TYPE_SET = new Set<string>(BUILD_RELEVANT_TIMELINE_EVENT_TYPES);

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

/**
 * Extract a compact, joinable event list for build/skill reconstruction.
 * Does not retain frames, positions, or unrelated event types.
 */
export function extractBuildRelevantTimelineEvents(
  events: RiotTimelineEventDto[],
): PreservedTimelineEvent[] {
  const preserved: PreservedTimelineEvent[] = [];
  let eventIndex = 0;

  for (const event of events) {
    if (!BUILD_TYPE_SET.has(event.type)) {
      continue;
    }
    const record = asRecord(event);
    preserved.push({
      eventIndex,
      type: event.type as BuildRelevantTimelineEventType,
      timestampMs: event.timestamp,
      participantId: asOptionalInt(event.participantId),
      itemId: asOptionalInt(event.itemId),
      beforeItemId: asOptionalInt(record.beforeId),
      afterItemId: asOptionalInt(record.afterId),
      skillSlot: asOptionalInt(event.skillSlot),
      levelUpType: asOptionalString(event.levelUpType),
    });
    eventIndex += 1;
  }

  return preserved;
}
