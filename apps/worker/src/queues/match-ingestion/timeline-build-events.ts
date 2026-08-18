import type { RiotTimelineEventDto } from '@league-helper/server-riot';
import { extractPersistedTimelineEvents } from './timeline-product-events.js';

/** Timeline event types required for future OP.GG-style build/skill reconstruction. */
export const BUILD_RELEVANT_TIMELINE_EVENT_TYPES = [
  'ITEM_PURCHASED',
  'ITEM_SOLD',
  'ITEM_UNDO',
  'ITEM_DESTROYED',
  'SKILL_LEVEL_UP',
] as const;

export type BuildRelevantTimelineEventType = (typeof BUILD_RELEVANT_TIMELINE_EVENT_TYPES)[number];

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

/**
 * Extract a compact, joinable event list for build/skill reconstruction.
 * Does not retain frames, positions, or unrelated event types.
 * Indexes are 0..n-1 among build types only (product events use a wider allowlist).
 */
export function extractBuildRelevantTimelineEvents(
  events: RiotTimelineEventDto[],
): PreservedTimelineEvent[] {
  return extractPersistedTimelineEvents(events)
    .filter((event) => BUILD_TYPE_SET.has(event.type))
    .map((event, eventIndex) => ({
      eventIndex,
      type: event.type as BuildRelevantTimelineEventType,
      timestampMs: event.timestampMs,
      participantId: event.participantId,
      itemId: event.itemId,
      beforeItemId: event.beforeItemId,
      afterItemId: event.afterItemId,
      skillSlot: event.skillSlot,
      levelUpType: event.levelUpType,
    }));
}
