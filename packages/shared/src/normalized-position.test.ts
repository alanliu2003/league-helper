import { describe, expect, it } from 'vitest';
import {
  getNormalizedPositionLabel,
  normalizeParticipantPosition,
  type NormalizeParticipantPositionInput,
} from './normalized-position';

function pos(
  overrides: NormalizeParticipantPositionInput,
): ReturnType<typeof normalizeParticipantPosition> {
  return normalizeParticipantPosition({
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    ...overrides,
  });
}

describe('normalizeParticipantPosition', () => {
  it.each([
    [
      'teamPosition=MIDDLE, role=SOLO -> MIDDLE',
      { teamPosition: 'MIDDLE', role: 'SOLO' },
      'MIDDLE',
    ],
    ['teamPosition=TOP, role=SOLO -> TOP', { teamPosition: 'TOP', role: 'SOLO' }, 'TOP'],
    [
      'teamPosition=JUNGLE, role=NONE -> JUNGLE',
      { teamPosition: 'JUNGLE', role: 'NONE' },
      'JUNGLE',
    ],
    [
      'teamPosition=BOTTOM, role=DUO_CARRY -> BOTTOM',
      { teamPosition: 'BOTTOM', role: 'DUO_CARRY' },
      'BOTTOM',
    ],
    [
      'teamPosition=UTILITY, role=DUO_SUPPORT -> SUPPORT',
      { teamPosition: 'UTILITY', role: 'DUO_SUPPORT' },
      'SUPPORT',
    ],
    [
      'teamPosition=MIDDLE, role=DUO_SUPPORT -> MIDDLE',
      { teamPosition: 'MIDDLE', role: 'DUO_SUPPORT' },
      'MIDDLE',
    ],
    [
      'teamPosition=TOP, role=DUO_SUPPORT -> TOP',
      { teamPosition: 'TOP', role: 'DUO_SUPPORT' },
      'TOP',
    ],
    [
      'teamPosition missing, individualPosition=MIDDLE -> MIDDLE',
      { teamPosition: 'NONE', individualPosition: 'MIDDLE' },
      'MIDDLE',
    ],
    [
      'teamPosition invalid, individualPosition=UTILITY -> SUPPORT',
      { teamPosition: 'INVALID', individualPosition: 'UTILITY' },
      'SUPPORT',
    ],
    [
      'lane=BOTTOM + role=DUO_CARRY -> BOTTOM',
      {
        teamPosition: 'NONE',
        individualPosition: 'NONE',
        lane: 'BOTTOM',
        role: 'DUO_CARRY',
      },
      'BOTTOM',
    ],
    [
      'lane=BOTTOM + role=DUO_SUPPORT -> SUPPORT',
      {
        teamPosition: '',
        individualPosition: '',
        lane: 'BOTTOM',
        role: 'DUO_SUPPORT',
      },
      'SUPPORT',
    ],
    [
      'lane=BOTTOM + role=SOLO -> UNKNOWN',
      {
        teamPosition: 'NONE',
        individualPosition: 'INVALID',
        lane: 'BOTTOM',
        role: 'SOLO',
      },
      'UNKNOWN',
    ],
    [
      'role=DUO_SUPPORT with no lane -> UNKNOWN',
      {
        teamPosition: 'NONE',
        individualPosition: 'NONE',
        lane: null,
        role: 'DUO_SUPPORT',
      },
      'UNKNOWN',
    ],
    [
      'role=SOLO only -> UNKNOWN',
      {
        teamPosition: 'NONE',
        individualPosition: 'NONE',
        lane: null,
        role: 'SOLO',
      },
      'UNKNOWN',
    ],
    [
      'ARAM -> UNKNOWN',
      {
        queueId: 450,
        gameMode: 'ARAM',
        mapId: 12,
        teamPosition: 'MIDDLE',
        role: 'SOLO',
      },
      'UNKNOWN',
    ],
    [
      'Arena -> UNKNOWN',
      {
        queueId: 1700,
        gameMode: 'CHERRY',
        teamPosition: 'TOP',
        role: 'SOLO',
      },
      'UNKNOWN',
    ],
    [
      'remake with missing positions -> UNKNOWN',
      {
        remake: true,
        teamPosition: 'NONE',
        individualPosition: 'INVALID',
        lane: null,
        role: null,
      },
      'UNKNOWN',
    ],
    [
      'unknown future Riot position -> UNKNOWN',
      {
        teamPosition: 'APEX',
        individualPosition: 'APEX',
        lane: null,
        role: null,
      },
      'UNKNOWN',
    ],
  ] as const)('%s', (_name, input, expected) => {
    expect(pos(input)).toBe(expected);
  });

  it('labels normalized positions for UI', () => {
    expect(getNormalizedPositionLabel('MIDDLE')).toBe('Mid');
    expect(getNormalizedPositionLabel('SUPPORT')).toBe('Support');
    expect(getNormalizedPositionLabel('UNKNOWN')).toBe('Unknown role');
  });
});
