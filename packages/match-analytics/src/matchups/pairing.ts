/**
 * Deterministic same-position lane pairing.
 *
 * Ambiguity is skipped, never guessed. Callers pass an already-chosen position
 * string (normalized SUPPORT for matchups; raw Riot teamPosition including
 * UTILITY for ingestion timeline diffs).
 */

export const RELIABLE_LANE_POSITIONS = [
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'SUPPORT',
] as const;

export type ReliableLanePosition = (typeof RELIABLE_LANE_POSITIONS)[number];

export const RELIABLE_LANE_POSITION_SET: ReadonlySet<string> = new Set(RELIABLE_LANE_POSITIONS);

export type LanePairSkipReason =
  | 'UNKNOWN_POSITION'
  | 'DUPLICATE_POSITION'
  | 'MISSING_OPPONENT'
  | 'MALFORMED_TEAM'
  | 'SAME_CHAMPION_MIRROR';

export type LanePairableParticipant = {
  participantId: number;
  teamId: number;
  championId: number;
  position: string;
  win: boolean;
};

export type UndirectedLanePair<T> = {
  position: ReliableLanePosition;
  team100: T;
  team200: T;
};

export type DirectionalMatchupObservation<T> = {
  position: ReliableLanePosition;
  subject: T;
  opponent: T;
  won: boolean;
};

export type LanePairingResult<T> = {
  pairs: UndirectedLanePair<T>[];
  directional: DirectionalMatchupObservation<T>[];
  skips: Record<LanePairSkipReason, number>;
  matchesAllFive: boolean;
};

export type FindUniqueSamePositionOpponentOptions<T> = {
  getPosition: (row: T) => string;
  reliablePositions: ReadonlySet<string>;
};

/**
 * Return the unique opposing-team participant in the same position, or null
 * when the slot is unknown, missing, or duplicated.
 */
export function findUniqueSamePositionOpponent<
  T extends { participantId: number; teamId: number },
>(
  participant: T,
  all: readonly T[],
  options: FindUniqueSamePositionOpponentOptions<T>,
): T | null {
  const position = options.getPosition(participant);
  if (!options.reliablePositions.has(position)) {
    return null;
  }
  const opponents = all.filter(
    (other) =>
      other.participantId !== participant.participantId &&
      other.teamId !== participant.teamId &&
      options.getPosition(other) === position,
  );
  return opponents.length === 1 ? (opponents[0] ?? null) : null;
}

function emptySkips(): Record<LanePairSkipReason, number> {
  return {
    UNKNOWN_POSITION: 0,
    DUPLICATE_POSITION: 0,
    MISSING_OPPONENT: 0,
    MALFORMED_TEAM: 0,
    SAME_CHAMPION_MIRROR: 0,
  };
}

function isReliableLanePosition(value: string): value is ReliableLanePosition {
  return RELIABLE_LANE_POSITION_SET.has(value);
}

/**
 * Pair a match's participants into unique same-position lane slots.
 * Emits both directional observations exactly once per valid undirected slot.
 */
export function pairLaneOpponents<T extends LanePairableParticipant>(
  participants: readonly T[],
  options: { excludeMirrors?: boolean } = {},
): LanePairingResult<T> {
  const excludeMirrors = options.excludeMirrors !== false;
  const skips = emptySkips();

  const teamIds = new Set(participants.map((row) => row.teamId));
  const malformed =
    participants.length !== 10 ||
    !teamIds.has(100) ||
    !teamIds.has(200) ||
    [...teamIds].some((id) => id !== 100 && id !== 200);
  if (malformed) {
    skips.MALFORMED_TEAM += 1;
  }

  for (const participant of participants) {
    if (!isReliableLanePosition(participant.position)) {
      skips.UNKNOWN_POSITION += 1;
    }
  }

  const pairs: UndirectedLanePair<T>[] = [];
  const directional: DirectionalMatchupObservation<T>[] = [];

  for (const position of RELIABLE_LANE_POSITIONS) {
    const inSlot = participants.filter((row) => row.position === position);
    const team100 = inSlot.filter((row) => row.teamId === 100);
    const team200 = inSlot.filter((row) => row.teamId === 200);

    if (team100.length > 1 || team200.length > 1) {
      skips.DUPLICATE_POSITION += 1;
      continue;
    }
    if (team100.length === 0 || team200.length === 0) {
      skips.MISSING_OPPONENT += 1;
      continue;
    }

    const left = team100[0]!;
    const right = team200[0]!;
    if (excludeMirrors && left.championId === right.championId) {
      skips.SAME_CHAMPION_MIRROR += 1;
      continue;
    }

    pairs.push({ position, team100: left, team200: right });
    directional.push({
      position,
      subject: left,
      opponent: right,
      won: left.win,
    });
    directional.push({
      position,
      subject: right,
      opponent: left,
      won: right.win,
    });
  }

  return {
    pairs,
    directional,
    skips,
    matchesAllFive: pairs.length === RELIABLE_LANE_POSITIONS.length,
  };
}
