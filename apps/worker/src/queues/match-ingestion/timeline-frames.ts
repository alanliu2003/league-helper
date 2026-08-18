import type { RiotTimelineFrameDto } from '@league-helper/server-riot';
import {
  participantFrameStatsFromValue,
  resolveParticipantFrameId,
} from './timeline-frame-stats.js';

export type TimelineFrameRow = {
  timestampMs: number;
  participantId: number;
  totalGold: number;
  xp: number;
  cs: number;
  level: number;
};

/**
 * Flatten participant frame snapshots for product persist.
 * Skips empty frames and unresolvable participants. Does not persist positions.
 */
export function extractTimelineFrames(frames: RiotTimelineFrameDto[]): TimelineFrameRow[] {
  const rows: TimelineFrameRow[] = [];
  const seen = new Set<string>();

  for (const frame of frames) {
    const participantFrames = frame.participantFrames;
    if (!participantFrames || Object.keys(participantFrames).length === 0) {
      continue;
    }

    for (const [key, value] of Object.entries(participantFrames)) {
      const participantId = resolveParticipantFrameId(key, value);
      if (participantId === null) {
        continue;
      }
      const uniqueKey = `${frame.timestamp}:${participantId}`;
      if (seen.has(uniqueKey)) {
        continue;
      }
      seen.add(uniqueKey);

      const stats = participantFrameStatsFromValue(value);
      rows.push({
        timestampMs: frame.timestamp,
        participantId,
        totalGold: stats.gold,
        xp: stats.xp,
        cs: stats.cs,
        level: stats.level,
      });
    }
  }

  return rows;
}
