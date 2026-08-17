import { describe, expect, it } from 'vitest';
import { MatchIngestionStatus } from '@prisma/client';
import type { PlayerMatchListRow } from '../../persistence/match.repository';
import { assertNoPuuidLeak, computePublicKda, computeGoldPerMinute, mapPublicMatch } from './player-response.mapper';

function matchRow(overrides: Partial<PlayerMatchListRow> = {}): PlayerMatchListRow {
  const base = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    provider: 'RIOT',
    externalMatchId: 'NA1_100',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    gameId: null,
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    gameType: 'MATCHED_GAME',
    gameCreation: new Date('2024-06-01T12:00:00.000Z'),
    gameEndTimestamp: null,
    gameDurationSeconds: 1800,
    gameVersion: '14.11.1.123',
    normalizedPatch: '14.11',
    remake: false,
    earlySurrender: false,
    ingestionStatus: MatchIngestionStatus.COMPLETED,
    normalizationVersion: '1',
    rawPayload: null,
    ingestedAt: new Date('2024-06-01T12:05:00.000Z'),
    createdAt: new Date('2024-06-01T12:05:00.000Z'),
    updatedAt: new Date('2024-06-01T12:05:00.000Z'),
    participants: [
      {
        championId: 23,
        championName: 'Tryndamere',
        teamPosition: 'TOP',
        individualPosition: 'TOP',
        lane: 'TOP',
        role: 'SOLO',
        win: true,
        kills: 5,
        deaths: 2,
        assists: 7,
        totalCs: 200,
        itemIds: [3031, 0, 3071],
        summonerSpell1Id: 4,
        summonerSpell2Id: 12,
        goldAt10: 3000,
        goldAt15: 5000,
        csAt10: 70,
        csAt15: 110,
        xpAt10: null,
        xpAt15: null,
        goldDifferenceAt10: 200,
        goldDifferenceAt15: null,
        csDifferenceAt10: null,
        csDifferenceAt15: null,
        killParticipation: 0.55,
      },
    ],
  } satisfies PlayerMatchListRow;

  return { ...base, ...overrides, participants: overrides.participants ?? base.participants };
}

describe('mapPublicMatch', () => {
  it('maps enriched match card fields without leaking PUUID', () => {
    const mapped = mapPublicMatch(matchRow(), {
      champion: {
        id: 'Tryndamere',
        key: '23',
        name: 'Tryndamere',
        title: 'the Barbarian King',
        iconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
        splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg',
      },
      dataDragonVersion: '14.11.1',
      dataDragonBaseUrl: 'https://ddragon.leagueoflegends.com',
    });

    expect(mapped.result).toBe('victory');
    expect(mapped.championKey).toBe('Tryndamere');
    expect(mapped.championName).toBe('Tryndamere');
    expect(mapped.championIconUrl).toContain('/img/champion/Tryndamere.png');
    expect(mapped.championIconUrl).not.toContain('/img/champion/23.png');
    // Legacy role=SOLO must not override teamPosition=TOP.
    expect(mapped.role).toBe('TOP');
    expect(mapped.teamPosition).toBe('TOP');
    expect(mapped.kda).toBeCloseTo(6);
    expect(mapped.csPerMinute).toBeCloseTo(200 / 30);
    expect(mapped.killParticipation).toBe(0.55);
    expect(mapped.itemIds).toEqual([3031, 0, 3071]);
    expect(mapped.itemIconUrls[0]).toContain('/img/item/3031.png');
    expect(mapped.itemIconUrls[1]).toBeNull();
    expect(mapped.timelineMetricsAvailable).toBe(true);
    expect(mapped.ingestionStatus).toBe('COMPLETED');
    expect(mapped.normalizedPatch).toBe('14.11');

    assertNoPuuidLeak(mapped);
    expect(JSON.stringify(mapped).toLowerCase()).not.toContain('puuid');
    expect(JSON.stringify(mapped)).not.toContain('rawPayload');
  });

  it('marks remake result over win/loss', () => {
    const mapped = mapPublicMatch(
      matchRow({
        remake: true,
        participants: [
          {
            ...matchRow().participants[0]!,
            win: true,
            goldAt10: null,
            goldAt15: null,
            csAt10: null,
            csAt15: null,
            goldDifferenceAt10: null,
            killParticipation: null,
          },
        ],
      }),
    );
    expect(mapped.result).toBe('remake');
    expect(mapped.remake).toBe(true);
    expect(mapped.timelineMetricsAvailable).toBe(false);
  });

  it('uses perfect-game KDA when deaths are zero', () => {
    expect(computePublicKda(4, 0, 2)).toBe(6);
    expect(computePublicKda(4, 2, 2)).toBe(3);
  });

  it('computes gold per minute from match duration', () => {
    expect(computeGoldPerMinute(8000, 1800)).toBeCloseTo(8000 / 30);
    expect(computeGoldPerMinute(8000, 0)).toBeNull();
  });

  it('keeps Riot champion name when Data Dragon is unavailable but never invents a numeric icon URL', () => {
    const mapped = mapPublicMatch(matchRow(), { champion: null });
    expect(mapped.championName).toBe('Tryndamere');
    expect(mapped.championKey).toBeNull();
    expect(mapped.championIconUrl).toBeNull();
  });

  it('keeps MIDDLE when legacy Riot role is SUPPORT', () => {
    const mapped = mapPublicMatch(
      matchRow({
        participants: [
          {
            ...matchRow().participants[0]!,
            teamPosition: 'MIDDLE',
            individualPosition: 'MIDDLE',
            lane: 'MIDDLE',
            role: 'SUPPORT',
            championId: 517,
            championName: 'Sylas',
          },
        ],
      }),
    );
    expect(mapped.role).toBe('MIDDLE');
    expect(mapped.teamPosition).toBe('MIDDLE');
  });

  it('maps UTILITY to SUPPORT and does not expose DUO_SUPPORT', () => {
    const mapped = mapPublicMatch(
      matchRow({
        participants: [
          {
            ...matchRow().participants[0]!,
            teamPosition: 'UTILITY',
            individualPosition: 'UTILITY',
            lane: 'BOTTOM',
            role: 'DUO_SUPPORT',
          },
        ],
      }),
    );
    expect(mapped.role).toBe('SUPPORT');
    expect(mapped.teamPosition).toBe('SUPPORT');
  });

  it('returns UNKNOWN for ARAM instead of inventing a SR role', () => {
    const mapped = mapPublicMatch(
      matchRow({
        queueId: 450,
        gameMode: 'ARAM',
        mapId: 12,
        participants: [
          {
            ...matchRow().participants[0]!,
            teamPosition: 'NONE',
            individualPosition: 'Invalid',
            lane: null,
            role: 'SUPPORT',
          },
        ],
      }),
    );
    expect(mapped.role).toBe('UNKNOWN');
  });

  it('uses DrMundo asset key for Dr. Mundo display name', () => {
    const mapped = mapPublicMatch(
      matchRow({
        participants: [
          {
            ...matchRow().participants[0]!,
            championId: 36,
            championName: 'Dr. Mundo',
          },
        ],
      }),
      {
        champion: {
          id: 'DrMundo',
          key: '36',
          name: 'Dr. Mundo',
          title: 'the Madman of Zaun',
          iconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/DrMundo.png',
          splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/DrMundo_0.jpg',
        },
      },
    );
    expect(mapped.championName).toBe('Dr. Mundo');
    expect(mapped.championKey).toBe('DrMundo');
    expect(mapped.championIconUrl).toContain('/img/champion/DrMundo.png');
  });
});
