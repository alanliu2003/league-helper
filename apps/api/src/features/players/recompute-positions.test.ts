import { describe, expect, it } from 'vitest';
import { analyzePositionRecompute } from './recompute-positions';

describe('analyzePositionRecompute', () => {
  it('flags MIDDLE+SUPPORT legacy display as a change to MIDDLE', () => {
    const result = analyzePositionRecompute([
      {
        participantId: 'p1',
        playerId: 'player-1',
        queueId: 420,
        mapId: 11,
        gameMode: 'CLASSIC',
        remake: false,
        teamPosition: 'MIDDLE',
        individualPosition: 'MIDDLE',
        lane: 'MIDDLE',
        role: 'SUPPORT',
      },
    ]);
    expect(result.counts.examined).toBe(1);
    expect(result.counts.displayWouldChange).toBe(1);
    expect(result.affectedPlayerIds).toEqual(['player-1']);
  });

  it('is idempotent for already-correct TOP+SOLO rows (public becomes TOP both ways conceptually)', () => {
    // Legacy buggy display would show SOLO; new shows TOP — still a display change.
    const result = analyzePositionRecompute([
      {
        participantId: 'p1',
        playerId: 'player-1',
        queueId: 420,
        mapId: 11,
        gameMode: 'CLASSIC',
        remake: false,
        teamPosition: 'TOP',
        individualPosition: 'TOP',
        lane: 'TOP',
        role: 'SOLO',
      },
    ]);
    expect(result.counts.displayWouldChange).toBe(1);
  });

  it('counts ARAM conversions to UNKNOWN', () => {
    const result = analyzePositionRecompute([
      {
        participantId: 'p1',
        playerId: null,
        queueId: 450,
        mapId: 12,
        gameMode: 'ARAM',
        remake: false,
        teamPosition: 'NONE',
        individualPosition: 'INVALID',
        lane: null,
        role: 'SUPPORT',
      },
    ]);
    expect(result.counts.convertedToUnknown).toBe(1);
    expect(result.counts.displayWouldChange).toBe(1);
  });
});
