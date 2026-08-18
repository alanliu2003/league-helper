import type { RiotTimelineFrameDto } from '@league-helper/server-riot';

export type ParticipantFrameStats = {
  gold: number;
  cs: number;
  xp: number;
  level: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function participantFrameStatsFromValue(value: unknown): ParticipantFrameStats {
  const record = asRecord(value);
  return {
    gold: asNumber(record.totalGold) ?? 0,
    cs: (asNumber(record.minionsKilled) ?? 0) + (asNumber(record.jungleMinionsKilled) ?? 0),
    xp: asNumber(record.xp) ?? 0,
    level: asNumber(record.level) ?? 0,
  };
}

export function resolveParticipantFrameId(key: string, value: unknown): number | null {
  const record = asRecord(value);
  const fromField = record.participantId;
  if (typeof fromField === 'number' && Number.isInteger(fromField) && Number.isFinite(fromField)) {
    return fromField;
  }
  if (/^-?\d+$/.test(key)) {
    const fromKey = Number(key);
    if (Number.isInteger(fromKey) && Number.isFinite(fromKey)) {
      return fromKey;
    }
  }
  return null;
}

/**
 * Lookup by string key then scan values for participantId.
 * Missing gold/cs/xp/level are treated as 0, matching current metrics behavior.
 */
export function readParticipantFrameStats(
  frame: RiotTimelineFrameDto | null,
  participantId: number,
): ParticipantFrameStats | null {
  if (!frame?.participantFrames) {
    return null;
  }
  const byKey =
    frame.participantFrames[String(participantId)] ??
    frame.participantFrames[participantId as unknown as string];
  if (!byKey) {
    for (const value of Object.values(frame.participantFrames)) {
      const candidate = asRecord(value);
      if (asNumber(candidate.participantId) === participantId) {
        return participantFrameStatsFromValue(candidate);
      }
    }
    return null;
  }
  return participantFrameStatsFromValue(byKey);
}
