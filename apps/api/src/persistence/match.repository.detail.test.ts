import { describe, expect, it } from 'vitest';
import {
  matchDetailParticipantSelect,
  matchDetailSelect,
  matchTimelineEventSelect,
  matchTimelineFrameSelect,
} from './match.repository';

const FORBIDDEN_SELECT_KEYS = [
  'rawPayload',
  'externalAccountId',
  'externalMatchId',
  'gameId',
  'rankTierAtIngestion',
  'rankDivisionAtIngestion',
  'rankResolutionStatus',
  'rankResolvedAt',
  'rankObservationId',
  'skillOrder',
  'playerAccountId',
] as const;

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return keys;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }

  return keys;
}

describe('matchDetailSelect', () => {
  it('omits raw payloads, Riot identifiers, and rank internals', () => {
    const keys = collectKeys(matchDetailSelect);
    for (const forbidden of FORBIDDEN_SELECT_KEYS) {
      expect(keys.has(forbidden), `select must not include ${forbidden}`).toBe(false);
    }
    expect(JSON.stringify(matchDetailSelect)).not.toContain('rawPayload');
    expect(JSON.stringify(matchDetailSelect)).not.toContain('externalAccountId');
  });

  it('includes match, teams, participants, public account fields, and cheap timeline coverage', () => {
    expect(matchDetailSelect).toMatchObject({
      id: true,
      teams: { select: { teamId: true, win: true, bans: true, objectives: true } },
      timeline: { select: { fetchStatus: true, productCoverage: true } },
    });
    expect(Object.keys(matchDetailSelect.timeline.select).sort()).toEqual([
      'fetchStatus',
      'productCoverage',
    ]);
    expect(matchDetailParticipantSelect.playerAccount).toEqual({
      select: {
        playerId: true,
        currentGameName: true,
        currentTagLine: true,
      },
    });
    expect(matchDetailParticipantSelect.participantId).toBe(true);
    expect(matchDetailParticipantSelect.itemIds).toBe(true);
    expect(matchDetailParticipantSelect.perkIds).toBe(true);
  });

  it('does not load events or frames on the overview select', () => {
    const keys = collectKeys(matchDetailSelect);
    expect(keys.has('events')).toBe(false);
    expect(keys.has('frames')).toBe(false);
    expect(matchDetailSelect.timeline.select).not.toHaveProperty('events');
    expect(matchDetailSelect.timeline.select).not.toHaveProperty('frames');
    expect(JSON.stringify(matchDetailSelect)).not.toContain('MatchTimelineEvent');
    expect(JSON.stringify(matchDetailSelect)).not.toContain('MatchTimelineFrame');
  });
});

describe('timeline product selects', () => {
  it('omits raw payloads and Riot identifiers from events and frames', () => {
    for (const select of [matchTimelineEventSelect, matchTimelineFrameSelect]) {
      const keys = collectKeys(select);
      for (const forbidden of FORBIDDEN_SELECT_KEYS) {
        expect(keys.has(forbidden), `select must not include ${forbidden}`).toBe(false);
      }
      expect(JSON.stringify(select)).not.toContain('rawPayload');
      expect(JSON.stringify(select)).not.toContain('externalAccountId');
      expect(JSON.stringify(select)).not.toContain('externalMatchId');
    }
  });

  it('selects public event and frame fields without participant row ids', () => {
    expect(matchTimelineEventSelect).toMatchObject({
      eventIndex: true,
      type: true,
      timestampMs: true,
      participantId: true,
      killerParticipantId: true,
      victimParticipantId: true,
    });
    expect(matchTimelineEventSelect).not.toHaveProperty('id');
    expect(matchTimelineFrameSelect).toMatchObject({
      timestampMs: true,
      participantId: true,
      totalGold: true,
      xp: true,
      cs: true,
      level: true,
    });
    expect(matchTimelineFrameSelect).not.toHaveProperty('id');
  });
});
