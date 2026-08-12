import { describe, expect, it } from 'vitest';
import { normalizeTimeline } from './timeline-normalizer.js';
import { extractBuildRelevantTimelineEvents } from './timeline-build-events.js';
import { buildRichTimelineDto } from './test-utils/ranked-match-fixture.js';

describe('extractBuildRelevantTimelineEvents', () => {
  it('preserves item purchase/sell/undo/destroy and skill level-ups with join keys', () => {
    const raw = buildRichTimelineDto();
    // Enrich UNDO with Riot beforeId/afterId and add DESTROYED for coverage.
    const frame0 = raw.info.frames[0];
    if (frame0) {
      frame0.events = [
        ...(frame0.events ?? []),
        {
          type: 'ITEM_DESTROYED',
          timestamp: 850_000,
          participantId: 1,
          itemId: 2003,
        },
      ];
      for (const event of frame0.events) {
        if (event.type === 'ITEM_UNDO') {
          (event as { beforeId?: number; afterId?: number }).beforeId = 1055;
          (event as { afterId?: number }).afterId = 0;
        }
      }
    }

    const timeline = normalizeTimeline({ raw, storeRawPayloads: false });
    const preserved = extractBuildRelevantTimelineEvents(timeline.events);

    const types = preserved.map((event) => event.type);
    expect(types).toContain('ITEM_PURCHASED');
    expect(types).toContain('ITEM_SOLD');
    expect(types).toContain('ITEM_UNDO');
    expect(types).toContain('ITEM_DESTROYED');
    expect(types).toContain('SKILL_LEVEL_UP');
    expect(types).not.toContain('CHAMPION_KILL');

    const undo = preserved.find((event) => event.type === 'ITEM_UNDO');
    expect(undo).toMatchObject({
      participantId: 1,
      itemId: 1055,
      beforeItemId: 1055,
      afterItemId: 0,
      timestampMs: 6_000,
    });

    const skills = preserved.filter((event) => event.type === 'SKILL_LEVEL_UP');
    expect(skills.map((event) => event.skillSlot)).toEqual([1, 3, 2]);
    expect(skills.every((event) => event.participantId === 1)).toBe(true);

    const purchases = preserved.filter((event) => event.type === 'ITEM_PURCHASED');
    expect(purchases.length).toBeGreaterThanOrEqual(2);
    expect(preserved.every((event, index) => event.eventIndex === index)).toBe(true);
  });
});
