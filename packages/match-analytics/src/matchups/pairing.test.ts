import { describe, expect, it } from 'vitest';
import {
  RELIABLE_LANE_POSITIONS,
  findUniqueSamePositionOpponent,
  pairLaneOpponents,
  type LanePairableParticipant,
} from './pairing';

const RELIABLE_RAW = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

function participant(
  overrides: Partial<LanePairableParticipant> & Pick<LanePairableParticipant, 'participantId'>,
): LanePairableParticipant {
  return {
    teamId: overrides.participantId <= 5 ? 100 : 200,
    championId: overrides.participantId,
    position: 'TOP',
    win: overrides.participantId <= 5,
    ...overrides,
  };
}

function standardFiveLaneMatch(): LanePairableParticipant[] {
  const positions = [...RELIABLE_LANE_POSITIONS];
  return [
    ...positions.map((position, index) =>
      participant({
        participantId: index + 1,
        teamId: 100,
        championId: 100 + index,
        position,
        win: true,
      }),
    ),
    ...positions.map((position, index) =>
      participant({
        participantId: index + 6,
        teamId: 200,
        championId: 200 + index,
        position,
        win: false,
      }),
    ),
  ];
}

describe('findUniqueSamePositionOpponent', () => {
  it('returns the unique opposing-team occupant of the same position', () => {
    const all = standardFiveLaneMatch();
    const subject = all[0]!;
    const opponent = findUniqueSamePositionOpponent(subject, all, {
      getPosition: (row) => row.position,
      reliablePositions: new Set(RELIABLE_LANE_POSITIONS),
    });
    expect(opponent?.participantId).toBe(6);
    expect(opponent?.championId).toBe(200);
  });

  it('returns null when the enemy position is duplicated', () => {
    const all = standardFiveLaneMatch();
    all[6] = { ...all[6]!, position: 'TOP' };
    const opponent = findUniqueSamePositionOpponent(all[0]!, all, {
      getPosition: (row) => row.position,
      reliablePositions: new Set(RELIABLE_LANE_POSITIONS),
    });
    expect(opponent).toBeNull();
  });

  it('accepts raw UTILITY when that is the caller position vocabulary', () => {
    const all = [
      participant({ participantId: 1, teamId: 100, position: 'UTILITY', championId: 412 }),
      participant({ participantId: 6, teamId: 200, position: 'UTILITY', championId: 89 }),
    ];
    const opponent = findUniqueSamePositionOpponent(all[0]!, all, {
      getPosition: (row) => row.position,
      reliablePositions: RELIABLE_RAW,
    });
    expect(opponent?.championId).toBe(89);
  });
});

describe('pairLaneOpponents', () => {
  it('pairs a normal 5-lane match into five undirected slots and ten directional observations', () => {
    const result = pairLaneOpponents(standardFiveLaneMatch());
    expect(result.pairs).toHaveLength(5);
    expect(result.directional).toHaveLength(10);
    expect(result.matchesAllFive).toBe(true);
    expect(result.skips).toEqual({
      UNKNOWN_POSITION: 0,
      DUPLICATE_POSITION: 0,
      MISSING_OPPONENT: 0,
      MALFORMED_TEAM: 0,
      SAME_CHAMPION_MIRROR: 0,
    });
  });

  it('emits both directions exactly once without double-counting', () => {
    const result = pairLaneOpponents(standardFiveLaneMatch());
    const mid = result.directional.filter((row) => row.position === 'MIDDLE');
    expect(mid).toHaveLength(2);
    const keys = mid.map(
      (row) => `${row.subject.championId}->${row.opponent.championId}:${row.won}`,
    );
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain('102->202:true');
    expect(keys).toContain('202->102:false');
  });

  it('skips a missing opponent rather than inventing a pair', () => {
    const rows = standardFiveLaneMatch().filter((row) => row.participantId !== 6);
    const result = pairLaneOpponents(rows);
    expect(result.pairs.some((pair) => pair.position === 'TOP')).toBe(false);
    expect(result.skips.MISSING_OPPONENT).toBe(1);
    expect(result.skips.MALFORMED_TEAM).toBe(1);
    expect(result.matchesAllFive).toBe(false);
  });

  it('skips duplicate same-position occupants', () => {
    const rows = standardFiveLaneMatch();
    rows[6] = { ...rows[6]!, position: 'TOP' };
    const result = pairLaneOpponents(rows);
    expect(result.pairs.some((pair) => pair.position === 'TOP')).toBe(false);
    expect(result.skips.DUPLICATE_POSITION).toBe(1);
    expect(result.skips.MISSING_OPPONENT).toBe(1);
  });

  it('skips UNKNOWN positions', () => {
    const rows = standardFiveLaneMatch();
    rows[0] = { ...rows[0]!, position: 'UNKNOWN' };
    rows[5] = { ...rows[5]!, position: 'UNKNOWN' };
    const result = pairLaneOpponents(rows);
    expect(result.skips.UNKNOWN_POSITION).toBe(2);
    expect(result.pairs.some((pair) => pair.position === 'TOP')).toBe(false);
    expect(result.matchesAllFive).toBe(false);
  });

  it('excludes same-champion mirrors when the schema forbids them', () => {
    const rows = standardFiveLaneMatch();
    rows[5] = { ...rows[5]!, championId: rows[0]!.championId };
    const result = pairLaneOpponents(rows);
    expect(result.skips.SAME_CHAMPION_MIRROR).toBe(1);
    expect(result.pairs.some((pair) => pair.position === 'TOP')).toBe(false);
    expect(result.directional.some((row) => row.subject.championId === row.opponent.championId)).toBe(
      false,
    );
  });

  it('does not emit a directional pair when A wins vs B without the inverse', () => {
    const rows = [
      participant({
        participantId: 1,
        teamId: 100,
        championId: 103,
        position: 'MIDDLE',
        win: true,
      }),
      participant({
        participantId: 6,
        teamId: 200,
        championId: 134,
        position: 'MIDDLE',
        win: false,
      }),
    ];
    const result = pairLaneOpponents(rows);
    const mid = result.directional.filter((row) => row.position === 'MIDDLE');
    expect(mid).toHaveLength(2);
    const ahri = mid.find((row) => row.subject.championId === 103);
    const syndra = mid.find((row) => row.subject.championId === 134);
    expect(ahri?.won).toBe(true);
    expect(syndra?.won).toBe(false);
  });
});
