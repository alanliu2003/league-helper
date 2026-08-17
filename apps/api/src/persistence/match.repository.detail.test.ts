import { describe, expect, it } from 'vitest';
import { matchDetailParticipantSelect, matchDetailSelect } from './match.repository';

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

  it('includes match, teams, participants, public account fields, and timeline status', () => {
    expect(matchDetailSelect).toMatchObject({
      id: true,
      teams: { select: { teamId: true, win: true, bans: true, objectives: true } },
      timeline: { select: { fetchStatus: true } },
    });
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
});
