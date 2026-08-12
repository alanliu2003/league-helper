import { describe, expect, it } from 'vitest';
import { mockMatchDto } from '@league-helper/server-riot';
import { ProviderResponseInvalidError } from '@league-helper/shared';
import {
  REMAKE_MAX_DURATION_SECONDS,
  detectRemakeAndEarlySurrender,
  normalizeMatch,
  normalizeParticipantPosition,
} from './match-normalizer.js';
import { buildRankedMatchDto } from './test-utils/ranked-match-fixture.js';

describe('match-normalizer', () => {
  it('keeps raw Riot role while shared normalizer prefers teamPosition for display', () => {
    const normalized = normalizeMatch({
      raw: buildRankedMatchDto(),
      regionalRoute: 'americas',
      normalizationVersion: 1,
      storeRawPayloads: false,
    });
    const mid = normalized.participants.find((p) => p.teamPosition === 'MIDDLE');
    expect(mid?.role).toBe('SOLO');
    expect(
      normalizeParticipantPosition({
        queueId: normalized.queueId,
        mapId: normalized.mapId,
        gameMode: normalized.gameMode,
        teamPosition: mid?.teamPosition,
        individualPosition: mid?.individualPosition,
        lane: mid?.lane,
        role: mid?.role,
      }),
    ).toBe('MIDDLE');
  });

  it('normalizes a ranked 10-player match with teams, perks, objectives, and patch', () => {
    const normalized = normalizeMatch({
      raw: buildRankedMatchDto(),
      regionalRoute: 'americas',
      normalizationVersion: 1,
      storeRawPayloads: false,
    });

    expect(normalized.externalMatchId).toBe('NA1_FAKE_MATCH_RANKED_10');
    expect(normalized.platformRoute).toBe('na1');
    expect(normalized.regionalRoute).toBe('americas');
    expect(normalized.queueId).toBe(420);
    expect(normalized.gameDurationSeconds).toBe(1800);
    expect(normalized.normalizedPatch).toBe('14.1');
    expect(normalized.remake).toBe(false);
    expect(normalized.participants).toHaveLength(10);
    expect(normalized.teams).toHaveLength(2);
    expect(normalized.teams[0]?.objectives).toBeTruthy();
    expect(normalized.participants[0]?.perkIds).toEqual([8005, 8008, 8126]);
    expect(normalized.participants[0]?.statPerkIds).toEqual([5008, 5008, 5002]);
    expect(normalized.participants[0]?.primaryPerkStyleId).toBe(8000);
    expect(normalized.participants[0]?.secondaryPerkStyleId).toBe(8100);
    // Preserve empty inventory slots (item2–item5 = 0) and trinket slot.
    expect(normalized.participants[0]?.itemIds).toEqual([3031, 3006, 0, 0, 0, 0, 3340]);
    expect(normalized.participants[0]?.summonerSpell1Id).toBe(4);
    expect(normalized.participants[0]?.summonerSpell2Id).toBe(14);
    expect(normalized.participants[0]?.totalDamageDealtToChampions).toBe(20_000);
    expect(normalized.rawPayload).toBeNull();
  });

  it('maps unknown role to NONE/INVALID without guessing', () => {
    const normalized = normalizeMatch({
      raw: buildRankedMatchDto({ unknownRole: true }),
      regionalRoute: 'americas',
      normalizationVersion: 1,
      storeRawPayloads: false,
    });
    expect(normalized.participants[0]?.teamPosition).toBe('NONE');
  });

  it('tolerates missing optional participant fields', () => {
    const normalized = normalizeMatch({
      raw: buildRankedMatchDto({ omitOptional: true }),
      regionalRoute: 'americas',
      normalizationVersion: 1,
      storeRawPayloads: true,
    });
    expect(normalized.participants[0]?.lane).toBeNull();
    expect(normalized.participants[0]?.role).toBeNull();
    expect(normalized.rawPayload).toBeTruthy();
  });

  it('rejects invalid participants missing championId', () => {
    expect(() =>
      normalizeMatch({
        raw: buildRankedMatchDto({ invalidParticipant: true }),
        regionalRoute: 'americas',
        normalizationVersion: 1,
        storeRawPayloads: false,
      }),
    ).toThrow(ProviderResponseInvalidError);
  });

  it('uses mockMatchDto fixture from server-riot', () => {
    const normalized = normalizeMatch({
      raw: mockMatchDto({ matchId: 'NA1_FAKE_MATCH_1001' }),
      regionalRoute: 'americas',
      normalizationVersion: 1,
      storeRawPayloads: false,
    });
    expect(normalized.participants.length).toBeGreaterThan(0);
    expect(normalized.externalMatchId).toBe('NA1_FAKE_MATCH_1001');
  });
});

describe('detectRemakeAndEarlySurrender', () => {
  it('classifies remake only with short duration + early surrender signal', () => {
    const remake = detectRemakeAndEarlySurrender({
      gameDurationSeconds: REMAKE_MAX_DURATION_SECONDS,
      participants: [{ gameEndedInEarlySurrender: true } as never],
      teams: [],
    });
    expect(remake).toEqual({ remake: true, earlySurrender: true });
  });

  it('does not classify ordinary short games as remakes', () => {
    const short = detectRemakeAndEarlySurrender({
      gameDurationSeconds: 240,
      participants: [{ gameEndedInEarlySurrender: false } as never],
      teams: [],
    });
    expect(short.remake).toBe(false);
  });

  it('treats early surrender FF outside remake window as earlySurrender only', () => {
    const result = detectRemakeAndEarlySurrender({
      gameDurationSeconds: 900,
      participants: [{ gameEndedInSurrender: true } as never],
      teams: [],
    });
    expect(result).toEqual({ remake: false, earlySurrender: true });
  });

  it('normalizes remake fixture end-to-end', () => {
    const normalized = normalizeMatch({
      raw: buildRankedMatchDto({
        gameDuration: 180,
        earlySurrenderParticipant: true,
      }),
      regionalRoute: 'americas',
      normalizationVersion: 1,
      storeRawPayloads: false,
    });
    expect(normalized.remake).toBe(true);
    expect(normalized.earlySurrender).toBe(true);
  });
});
