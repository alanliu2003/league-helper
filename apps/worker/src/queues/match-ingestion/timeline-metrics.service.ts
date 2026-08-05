import type { RiotTimelineEventDto, RiotTimelineFrameDto } from '@league-helper/server-riot';
import type { TeamPosition } from '@league-helper/shared';

export type ParticipantIdentityForMetrics = {
  participantId: number;
  teamId: number;
  teamPosition: TeamPosition;
  kills: number;
  assists: number;
};

export type ParticipantTimelineMetrics = {
  participantId: number;
  goldAt10: number | null;
  goldAt15: number | null;
  csAt10: number | null;
  csAt15: number | null;
  xpAt10: number | null;
  xpAt15: number | null;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  xpDifferenceAt10: number | null;
  xpDifferenceAt15: number | null;
  deathsBefore10: number | null;
  deathsBetween10And20: number | null;
  /** Deferred — always null in v1. */
  deathsBeforeObjectives: null;
  firstCompletedItemId: number | null;
  firstCompletedItemAtSeconds: number | null;
  killParticipation: number | null;
  skillOrder: number[];
};

const RELIABLE_POSITIONS = new Set<TeamPosition>(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Latest frame at or before the target minute (inclusive). */
export function selectFrameAtOrBeforeMinute(
  frames: RiotTimelineFrameDto[],
  minute: number,
): RiotTimelineFrameDto | null {
  const targetMs = minute * 60_000;
  let best: RiotTimelineFrameDto | null = null;
  let bestTs = -1;
  for (const frame of frames) {
    const ts = frame.timestamp;
    if (typeof ts !== 'number' || ts > targetMs) {
      continue;
    }
    if (ts >= bestTs) {
      best = frame;
      bestTs = ts;
    }
  }
  return best;
}

function readParticipantFrame(
  frame: RiotTimelineFrameDto | null,
  participantId: number,
): { gold: number; cs: number; xp: number } | null {
  if (!frame?.participantFrames) {
    return null;
  }
  const byKey =
    frame.participantFrames[String(participantId)] ??
    frame.participantFrames[participantId as unknown as string];
  const record = asRecord(byKey);
  if (!byKey) {
    // Some payloads key by participantId field inside values.
    for (const value of Object.values(frame.participantFrames)) {
      const candidate = asRecord(value);
      if (asNumber(candidate.participantId) === participantId) {
        return {
          gold: asNumber(candidate.totalGold) ?? 0,
          cs:
            (asNumber(candidate.minionsKilled) ?? 0) +
            (asNumber(candidate.jungleMinionsKilled) ?? 0),
          xp: asNumber(candidate.xp) ?? 0,
        };
      }
    }
    return null;
  }
  return {
    gold: asNumber(record.totalGold) ?? 0,
    cs: (asNumber(record.minionsKilled) ?? 0) + (asNumber(record.jungleMinionsKilled) ?? 0),
    xp: asNumber(record.xp) ?? 0,
  };
}

function findRoleOpponent(
  participant: ParticipantIdentityForMetrics,
  all: ParticipantIdentityForMetrics[],
): ParticipantIdentityForMetrics | null {
  if (!RELIABLE_POSITIONS.has(participant.teamPosition)) {
    return null;
  }
  const opponents = all.filter(
    (other) =>
      other.participantId !== participant.participantId &&
      other.teamId !== participant.teamId &&
      other.teamPosition === participant.teamPosition,
  );
  return opponents.length === 1 ? (opponents[0] ?? null) : null;
}

function countDeaths(
  events: RiotTimelineEventDto[],
  participantId: number,
  fromMs: number,
  toMsExclusive: number,
): number {
  let count = 0;
  for (const event of events) {
    if (event.type !== 'CHAMPION_KILL') {
      continue;
    }
    if (event.victimId !== participantId) {
      continue;
    }
    if (event.timestamp >= fromMs && event.timestamp < toMsExclusive) {
      count += 1;
    }
  }
  return count;
}

function extractSkillOrder(events: RiotTimelineEventDto[], participantId: number): number[] {
  const order: number[] = [];
  const skillEvents = events
    .filter(
      (event) =>
        event.type === 'SKILL_LEVEL_UP' &&
        event.participantId === participantId &&
        typeof event.skillSlot === 'number',
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const event of skillEvents) {
    if (typeof event.skillSlot === 'number') {
      order.push(event.skillSlot);
    }
  }
  return order;
}

/**
 * First completed item: without Data Dragon item metadata we cannot reliably
 * distinguish completed items from components. Leave null (deferred).
 * Item undo/sale events are tracked only to keep the door open for future use.
 */
export function detectFirstCompletedItem(_input: {
  events: RiotTimelineEventDto[];
  participantId: number;
}): { itemId: number | null; atSeconds: number | null } {
  return { itemId: null, atSeconds: null };
}

function computeKillParticipation(
  participant: ParticipantIdentityForMetrics,
  all: ParticipantIdentityForMetrics[],
): number | null {
  const teamKills = all
    .filter((other) => other.teamId === participant.teamId)
    .reduce((sum, other) => sum + other.kills, 0);
  if (teamKills <= 0) {
    return null;
  }
  // Incomplete participant samples (or odd Riot payloads) can exceed 1.0; clamp
  // to the DB / public DTO range [0, 1].
  const raw = (participant.kills + participant.assists) / teamKills;
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.min(raw, 1);
}

export function calculateTimelineMetrics(input: {
  frames: RiotTimelineFrameDto[];
  events: RiotTimelineEventDto[];
  participants: ParticipantIdentityForMetrics[];
}): ParticipantTimelineMetrics[] {
  const frame10 = selectFrameAtOrBeforeMinute(input.frames, 10);
  const frame15 = selectFrameAtOrBeforeMinute(input.frames, 15);

  return input.participants.map((participant) => {
    const stats10 = readParticipantFrame(frame10, participant.participantId);
    const stats15 = readParticipantFrame(frame15, participant.participantId);
    const opponent = findRoleOpponent(participant, input.participants);
    const opponent10 = opponent ? readParticipantFrame(frame10, opponent.participantId) : null;
    const opponent15 = opponent ? readParticipantFrame(frame15, opponent.participantId) : null;

    const firstItem = detectFirstCompletedItem({
      events: input.events,
      participantId: participant.participantId,
    });

    return {
      participantId: participant.participantId,
      goldAt10: stats10?.gold ?? null,
      goldAt15: stats15?.gold ?? null,
      csAt10: stats10?.cs ?? null,
      csAt15: stats15?.cs ?? null,
      xpAt10: stats10?.xp ?? null,
      xpAt15: stats15?.xp ?? null,
      goldDifferenceAt10: stats10 && opponent10 ? stats10.gold - opponent10.gold : null,
      goldDifferenceAt15: stats15 && opponent15 ? stats15.gold - opponent15.gold : null,
      csDifferenceAt10: stats10 && opponent10 ? stats10.cs - opponent10.cs : null,
      csDifferenceAt15: stats15 && opponent15 ? stats15.cs - opponent15.cs : null,
      xpDifferenceAt10: stats10 && opponent10 ? stats10.xp - opponent10.xp : null,
      xpDifferenceAt15: stats15 && opponent15 ? stats15.xp - opponent15.xp : null,
      deathsBefore10: countDeaths(input.events, participant.participantId, 0, 600_000),
      deathsBetween10And20: countDeaths(
        input.events,
        participant.participantId,
        600_000,
        1_200_000,
      ),
      deathsBeforeObjectives: null,
      firstCompletedItemId: firstItem.itemId,
      firstCompletedItemAtSeconds: firstItem.atSeconds,
      killParticipation: computeKillParticipation(participant, input.participants),
      skillOrder: extractSkillOrder(input.events, participant.participantId),
    };
  });
}
