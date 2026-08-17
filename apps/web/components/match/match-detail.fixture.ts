import type {
  PublicMatchDetail,
  PublicMatchItemSlot,
  PublicMatchParticipant,
} from '@league-helper/shared';

export const ORIGIN_PLAYER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
export const MATCH_DETAIL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

export function itemSlot(slot: number, itemId = 0, name?: string | null): PublicMatchItemSlot {
  return {
    slot,
    itemId,
    name: itemId ? (name ?? `Item ${itemId}`) : null,
    iconUrl: itemId ? `https://cdn.test/item/${itemId}.png` : null,
  };
}

export function matchParticipant(
  overrides: Partial<PublicMatchParticipant> = {},
): PublicMatchParticipant {
  return {
    participantId: 1,
    teamId: 100,
    playerId: null,
    riotId: { gameName: 'Alice', tagLine: 'NA1' },
    championId: 23,
    championKey: 'Tryndamere',
    championName: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
    teamPosition: 'TOP',
    win: true,
    kills: 1,
    deaths: 0,
    assists: 1,
    kda: 2,
    totalCs: 100,
    csPerMinute: 5,
    goldEarned: 8000,
    goldPerMinute: 400,
    totalDamageDealtToChampions: 10000,
    damageShare: 1,
    totalDamageTaken: 8000,
    visionScore: 10,
    wardsPlaced: 5,
    wardsKilled: 1,
    controlWardsPurchased: 2,
    killParticipation: 0.4,
    items: [0, 1, 2, 3, 4, 5, 6].map((slot) => itemSlot(slot)),
    summonerSpells: [
      { id: 4, name: 'Flash', iconUrl: 'https://cdn.test/spell/Flash.png' },
      { id: 12, name: 'Teleport', iconUrl: 'https://cdn.test/spell/Teleport.png' },
    ],
    keystone: {
      id: 8005,
      name: 'Press the Attack',
      iconUrl: 'https://cdn.test/rune/8005.png',
    },
    primaryPerkStyle: { id: 8000, name: 'Precision', iconUrl: 'https://cdn.test/style/8000.png' },
    secondaryPerkStyle: { id: 8100, name: 'Domination', iconUrl: 'https://cdn.test/style/8100.png' },
    statShards: [],
    goldAt10: null,
    goldAt15: null,
    csAt10: null,
    csAt15: null,
    xpAt10: null,
    xpAt15: null,
    goldDifferenceAt10: null,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    xpDifferenceAt10: null,
    xpDifferenceAt15: null,
    deathsBefore10: null,
    deathsBetween10And20: null,
    ...overrides,
  };
}

export function matchDetailFixture(
  overrides: Partial<PublicMatchDetail> & {
    remake?: boolean;
    winningSide?: PublicMatchDetail['match']['winningSide'];
  } = {},
): PublicMatchDetail {
  const remake = overrides.remake ?? overrides.match?.remake ?? false;
  return {
    match: {
      id: MATCH_DETAIL_ID,
      queueId: 420,
      queueLabel: 'Ranked Solo/Duo',
      platform: 'na1',
      regionalRoute: 'americas',
      mapId: 11,
      gameMode: 'CLASSIC',
      gameCreation: '2026-08-01T00:00:00.000Z',
      gameEndTimestamp: '2026-08-01T00:30:00.000Z',
      gameDurationSeconds: 1800,
      gameVersion: '14.11.1.123',
      normalizedPatch: '14.11',
      remake,
      earlySurrender: false,
      ingestionStatus: 'COMPLETED',
      winningSide: overrides.winningSide === undefined ? (remake ? null : 'BLUE') : overrides.winningSide,
      ...overrides.match,
    },
    timeline: overrides.timeline ?? { status: 'UNAVAILABLE', metricsAvailable: false },
    teams: overrides.teams ?? [
      {
        teamId: 100,
        side: 'BLUE',
        win: !remake,
        bans: [{ id: 103, name: 'Ahri', iconUrl: 'https://cdn.test/champion/Ahri.png' }],
        objectives: [
          { type: 'dragon', kills: 2, first: true },
          { type: 'baron', kills: 1, first: null },
        ],
        totals: {
          kills: 1,
          deaths: 0,
          assists: 1,
          goldEarned: 8000,
          damageDealtToChampions: 10000,
          visionScore: 10,
        },
        participants: [
          matchParticipant({
            playerId: ORIGIN_PLAYER_ID,
            riotId: { gameName: 'Alice', tagLine: 'NA1' },
          }),
        ],
      },
      {
        teamId: 200,
        side: 'RED',
        win: false,
        bans: [],
        objectives: [],
        totals: {
          kills: 0,
          deaths: 1,
          assists: 0,
          goldEarned: 7000,
          damageDealtToChampions: 8000,
          visionScore: 8,
        },
        participants: [
          matchParticipant({
            participantId: 6,
            teamId: 200,
            win: false,
            playerId: null,
            riotId: { gameName: 'Bob', tagLine: 'NA1' },
            championId: 64,
            championKey: 'LeeSin',
            championName: 'Lee Sin',
            championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/LeeSin.png',
            totalDamageDealtToChampions: 8000,
            damageShare: 1,
          }),
        ],
      },
    ],
  };
}
