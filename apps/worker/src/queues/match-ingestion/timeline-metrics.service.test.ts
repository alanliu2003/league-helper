import { describe, expect, it } from 'vitest';
import { mockTimelineDto } from '@league-helper/server-riot';
import {
  calculateTimelineMetrics,
  detectFirstCompletedItem,
  selectFrameAtOrBeforeMinute,
} from './timeline-metrics.service.js';
import { normalizeTimeline } from './timeline-normalizer.js';
import { buildRankedMatchDto, buildRichTimelineDto } from './test-utils/ranked-match-fixture.js';
import { normalizeMatch } from './match-normalizer.js';

describe('timeline-metrics.service', () => {
  const identities = normalizeMatch({
    raw: buildRankedMatchDto(),
    regionalRoute: 'americas',
    normalizationVersion: 1,
    storeRawPayloads: false,
  }).participants.map((participant) => ({
    participantId: participant.participantId,
    teamId: participant.teamId,
    teamPosition: participant.teamPosition,
    kills: participant.kills,
    assists: participant.assists,
  }));

  it('selects latest frame at or before target minute', () => {
    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto(),
      storeRawPayloads: false,
    });
    const frame10 = selectFrameAtOrBeforeMinute(timeline.frames, 10);
    const frame14 = selectFrameAtOrBeforeMinute(timeline.frames, 14);
    expect(frame10?.timestamp).toBe(600_000);
    // No frame between 10 and 15 → use 10 for minute 14.
    expect(frame14?.timestamp).toBe(600_000);
  });

  it('computes gold/cs/xp at 10 and 15 with opponent diffs', () => {
    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto(),
      storeRawPayloads: false,
    });
    const metrics = calculateTimelineMetrics({
      frames: timeline.frames,
      events: timeline.events,
      participants: identities,
    });

    const p1 = metrics.find((metric) => metric.participantId === 1);
    expect(p1?.goldAt10).toBe(500 + 10 * 800 + 10);
    expect(p1?.csAt10).toBe(10 * 6 + 1 + 10);
    expect(p1?.xpAt10).toBe(10 * 1000 + 1);
    expect(p1?.goldAt15).toBe(500 + 15 * 800 + 10);
    // Opponent for TOP is participant 6 (same position, other team).
    expect(p1?.goldDifferenceAt10).not.toBeNull();
    expect(p1?.deathsBefore10).toBe(1);
    expect(p1?.deathsBetween10And20).toBe(1);
    expect(p1?.skillOrder).toEqual([1, 3, 2]);
    expect(p1?.deathsBeforeObjectives).toBeNull();
    expect(p1?.firstCompletedItemId).toBeNull();
  });

  it('returns null diffs when role opponent is ambiguous', () => {
    const ambiguous = identities.map((participant, index) =>
      index === 5
        ? { ...participant, teamPosition: 'TOP' as const } // second enemy TOP
        : participant,
    );
    // Also make participant 6 TOP while participant 1 is TOP → two enemy TOPs if both on team 200.
    // participant 6 is already TOP on team 200; change participant 7 to TOP too.
    ambiguous[6] = { ...ambiguous[6]!, teamPosition: 'TOP' };

    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto(),
      storeRawPayloads: false,
    });
    const metrics = calculateTimelineMetrics({
      frames: timeline.frames,
      events: timeline.events,
      participants: ambiguous,
    });
    expect(metrics[0]?.goldDifferenceAt10).toBeNull();
  });

  it('returns null kill participation when team kills are zero', () => {
    const zeroKills = identities.map((participant) => ({
      ...participant,
      kills: 0,
      assists: 0,
    }));
    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto(),
      storeRawPayloads: false,
    });
    const metrics = calculateTimelineMetrics({
      frames: timeline.frames,
      events: timeline.events,
      participants: zeroKills,
    });
    expect(metrics[0]?.killParticipation).toBeNull();
  });

  it('handles missing frame 15 without throwing', () => {
    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto({ omitFrame15: true }),
      storeRawPayloads: false,
    });
    const metrics = calculateTimelineMetrics({
      frames: timeline.frames,
      events: timeline.events,
      participants: identities,
    });
    expect(metrics[0]?.goldAt15).toBe(metrics[0]?.goldAt10);
  });

  it('leaves first completed item null without item metadata', () => {
    expect(
      detectFirstCompletedItem({
        events: [
          { type: 'ITEM_PURCHASED', timestamp: 1, participantId: 1, itemId: 3031 },
          { type: 'ITEM_SOLD', timestamp: 2, participantId: 1, itemId: 3031 },
        ],
        participantId: 1,
      }),
    ).toEqual({ itemId: null, atSeconds: null });
  });

  it('accepts server-riot mockTimelineDto', () => {
    const timeline = normalizeTimeline({
      raw: mockTimelineDto(),
      storeRawPayloads: false,
    });
    expect(timeline.frames.length).toBeGreaterThan(0);
  });

  it('rejects malformed timeline', () => {
    expect(() =>
      normalizeTimeline({
        raw: { not: 'a-timeline' },
        storeRawPayloads: false,
      }),
    ).toThrow();
  });
});
