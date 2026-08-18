import { describe, expect, it } from 'vitest';
import { normalizeTimeline } from './timeline-normalizer.js';
import { extractTimelineFrames } from './timeline-frames.js';
import { buildRichTimelineDto } from './test-utils/ranked-match-fixture.js';

function expectedGold(minute: number, participantId: number): number {
  return 500 + minute * 800 + participantId * 10;
}

function expectedCs(minute: number, participantId: number): number {
  return minute * 6 + participantId + minute;
}

function expectedXp(minute: number, participantId: number): number {
  return minute * 1000 + participantId;
}

function expectedLevel(minute: number): number {
  return minute === 0 ? 1 : minute;
}

describe('extractTimelineFrames', () => {
  it('emits 30 unique gold/cs/xp/level rows for 0/10/15 minute frames', () => {
    const raw = buildRichTimelineDto();
    const timeline = normalizeTimeline({ raw, storeRawPayloads: false });

    for (const frame of timeline.frames) {
      for (const participantFrame of Object.values(frame.participantFrames)) {
        (participantFrame as { position?: { x: number; y: number } }).position = {
          x: 123,
          y: 456,
        };
      }
    }

    const rows = extractTimelineFrames(timeline.frames);
    expect(rows).toHaveLength(30);

    const keys = rows.map((row) => `${row.timestampMs}:${row.participantId}`);
    expect(new Set(keys).size).toBe(30);

    for (const row of rows) {
      expect(row).not.toHaveProperty('position');
      expect(row).not.toHaveProperty('positionX');
      expect(row).not.toHaveProperty('positionY');
    }

    const minutes = [0, 10, 15];
    for (const minute of minutes) {
      for (let participantId = 1; participantId <= 10; participantId += 1) {
        const row = rows.find(
          (candidate) =>
            candidate.timestampMs === minute * 60_000 && candidate.participantId === participantId,
        );
        expect(row).toMatchObject({
          totalGold: expectedGold(minute, participantId),
          cs: expectedCs(minute, participantId),
          xp: expectedXp(minute, participantId),
          level: expectedLevel(minute),
        });
      }
    }
  });

  it('skips empty participantFrames and unresolvable participants', () => {
    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto(),
      storeRawPayloads: false,
    });
    timeline.frames.push(
      {
        timestamp: 1_200_000,
        participantFrames: {},
        events: [],
      },
      {
        timestamp: 1_260_000,
        participantFrames: {
          bad: { totalGold: 999, xp: 999, minionsKilled: 9, jungleMinionsKilled: 9, level: 9 },
        },
        events: [],
      },
    );

    const rows = extractTimelineFrames(timeline.frames);
    expect(rows).toHaveLength(30);
    expect(rows.some((row) => row.timestampMs === 1_200_000)).toBe(false);
    expect(rows.some((row) => row.timestampMs === 1_260_000)).toBe(false);
  });

  it('emits 20 rows when the 15-minute frame is omitted', () => {
    const timeline = normalizeTimeline({
      raw: buildRichTimelineDto({ omitFrame15: true }),
      storeRawPayloads: false,
    });
    const rows = extractTimelineFrames(timeline.frames);
    expect(rows).toHaveLength(20);
    expect(rows.some((row) => row.timestampMs === 15 * 60_000)).toBe(false);
  });
});
