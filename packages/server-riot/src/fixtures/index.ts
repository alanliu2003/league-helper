import type { ChampionMastery, PlayerAccount, RankedEntry } from '@league-helper/shared';
import type {
  RiotAccountDto,
  RiotChampionMasteryDto,
  RiotLeagueEntryDto,
  RiotMatchDto,
  RiotMatchTimelineDto,
  RiotSummonerDto,
} from '../riot-api.schemas';

export const FAKE_PUUID = 'fake-puuid-000000000000000000000000000000000000000000000000000000000000';
export const FAKE_SUMMONER_ID = 'fake-summoner-id-aaaaaaaaaaaaaaaaaaaaaa';
export const FAKE_ACCOUNT_ID = 'fake-account-id-bbbbbbbbbbbbbbbbbbbbbb';
export const FAKE_MATCH_IDS = [
  'NA1_FAKE_MATCH_1001',
  'NA1_FAKE_MATCH_1002',
  'NA1_FAKE_MATCH_1003',
  'NA1_FAKE_MATCH_1004',
  'NA1_FAKE_MATCH_1005',
] as const;

export function mockAccountDto(overrides: Partial<RiotAccountDto> = {}): RiotAccountDto {
  return {
    puuid: FAKE_PUUID,
    gameName: 'ExamplePlayer',
    tagLine: 'NA1',
    ...overrides,
  };
}

export function mockSummonerDto(overrides: Partial<RiotSummonerDto> = {}): RiotSummonerDto {
  return {
    id: FAKE_SUMMONER_ID,
    accountId: FAKE_ACCOUNT_ID,
    puuid: FAKE_PUUID,
    profileIconId: 1234,
    revisionDate: 1_700_000_000_000,
    summonerLevel: 120,
    ...overrides,
  };
}

/** Modern summoner payload shape without id/accountId (post-2025 Riot change). */
export function mockSummonerDtoWithoutIds(
  overrides: Partial<RiotSummonerDto> = {},
): RiotSummonerDto {
  return {
    puuid: FAKE_PUUID,
    profileIconId: 1234,
    revisionDate: 1_700_000_000_000,
    summonerLevel: 120,
    ...overrides,
  };
}

export function mockLeagueEntriesDto(): RiotLeagueEntryDto[] {
  return [
    {
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      rank: 'II',
      leaguePoints: 54,
      wins: 40,
      losses: 35,
      veteran: false,
      inactive: false,
      freshBlood: true,
      hotStreak: false,
      puuid: FAKE_PUUID,
    },
    {
      queueType: 'RANKED_FLEX_SR',
      tier: 'SILVER',
      rank: 'I',
      leaguePoints: 12,
      wins: 10,
      losses: 12,
      veteran: false,
      inactive: false,
      freshBlood: false,
      hotStreak: true,
      puuid: FAKE_PUUID,
    },
  ];
}

export function mockEmptyLeagueEntriesDto(): RiotLeagueEntryDto[] {
  return [];
}

export function mockMatchIdList(): string[] {
  return [...FAKE_MATCH_IDS];
}

export function mockMatchDto(overrides: { matchId?: string } = {}): RiotMatchDto {
  const matchId = overrides.matchId ?? FAKE_MATCH_IDS[0];
  return {
    metadata: {
      dataVersion: '2',
      matchId,
      participants: [FAKE_PUUID, 'fake-puuid-teammate-000000000000000000000000000000000000'],
    },
    info: {
      gameCreation: 1_700_000_000_000,
      gameDuration: 1800,
      gameEndTimestamp: 1_700_001_800_000,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      gameVersion: '14.1.1.123',
      mapId: 11,
      queueId: 420,
      participants: [
        {
          puuid: FAKE_PUUID,
          championId: 157,
          teamId: 100,
          teamPosition: 'MIDDLE',
          win: true,
          kills: 8,
          deaths: 3,
          assists: 7,
          item0: 3031,
          item1: 0,
          item2: 0,
          item3: 0,
          item4: 0,
          item5: 0,
          item6: 3340,
          summoner1Id: 4,
          summoner2Id: 14,
          perks: {
            styles: [
              {
                description: 'primaryStyle',
                style: 8000,
                selections: [{ perk: 8005, var1: 1, var2: 2, var3: 3 }],
              },
            ],
          },
        },
      ],
      teams: [
        {
          teamId: 100,
          win: true,
          bans: [{ championId: 99, pickTurn: 1 }],
          objectives: {
            baron: { first: false, kills: 0 },
            champion: { first: true, kills: 20 },
            dragon: { first: true, kills: 2 },
            inhibitor: { first: false, kills: 0 },
            riftHerald: { first: true, kills: 1 },
            tower: { first: true, kills: 5 },
          },
        },
      ],
    },
  };
}

export function mockTimelineDto(overrides: { matchId?: string } = {}): RiotMatchTimelineDto {
  const matchId = overrides.matchId ?? FAKE_MATCH_IDS[0];
  return {
    metadata: {
      dataVersion: '2',
      matchId,
      participants: [FAKE_PUUID],
    },
    info: {
      frameInterval: 60_000,
      frames: [
        {
          timestamp: 0,
          participantFrames: {
            '1': {
              participantId: 1,
              level: 1,
              xp: 0,
              totalGold: 500,
              currentGold: 500,
              minionsKilled: 0,
              jungleMinionsKilled: 0,
            },
          },
          events: [
            {
              type: 'ITEM_PURCHASED',
              timestamp: 1000,
              participantId: 1,
              itemId: 1055,
            },
            {
              type: 'CHAMPION_KILL',
              timestamp: 120_000,
              killerId: 1,
              victimId: 2,
              assistingParticipantIds: [],
            },
            {
              type: 'SOME_FUTURE_UNKNOWN_EVENT',
              timestamp: 130_000,
              mysteryField: 'kept-via-passthrough',
            } as RiotMatchTimelineDto['info']['frames'][number]['events'][number],
          ],
        },
      ],
    },
  };
}

export function mockChampionMasteryDtoList(): RiotChampionMasteryDto[] {
  return [
    {
      puuid: FAKE_PUUID,
      championId: 157,
      championLevel: 7,
      championPoints: 250_000,
      lastPlayTime: 1_700_000_000_000,
      chestGranted: true,
      tokensEarned: 0,
    },
    {
      puuid: FAKE_PUUID,
      championId: 64,
      championLevel: 5,
      championPoints: 40_000,
      lastPlayTime: 1_690_000_000_000,
      chestGranted: false,
      tokensEarned: 2,
    },
  ];
}

export function mockRankedEntries(player: PlayerAccount): RankedEntry[] {
  return [
    {
      provider: 'RIOT',
      externalAccountId: player.externalAccountId,
      platform: player.platform,
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      division: 'II',
      leaguePoints: 54,
      wins: 40,
      losses: 35,
      veteran: false,
      inactive: false,
      freshBlood: true,
      hotStreak: false,
    },
    {
      provider: 'RIOT',
      externalAccountId: player.externalAccountId,
      platform: player.platform,
      queueType: 'RANKED_FLEX_SR',
      tier: 'SILVER',
      division: 'I',
      leaguePoints: 12,
      wins: 10,
      losses: 12,
      veteran: false,
      inactive: false,
      freshBlood: false,
      hotStreak: true,
    },
  ];
}

export function mockChampionMasteryList(player: PlayerAccount): ChampionMastery[] {
  return mockChampionMasteryDtoList().map((entry) => ({
    provider: 'RIOT' as const,
    externalAccountId: player.externalAccountId,
    platform: player.platform,
    championId: entry.championId,
    championLevel: entry.championLevel,
    championPoints: entry.championPoints,
    lastPlayTime: entry.lastPlayTime ? new Date(entry.lastPlayTime).toISOString() : undefined,
    chestGranted: entry.chestGranted,
    tokensEarned: entry.tokensEarned,
  }));
}

export function mockHttpErrorBodies(): Record<string, unknown> {
  return {
    '400': { status: { message: 'Bad request', status_code: 400 } },
    '401': { status: { message: 'Unauthorized', status_code: 401 } },
    '403': { status: { message: 'Forbidden', status_code: 403 } },
    '404': { status: { message: 'Not found', status_code: 404 } },
    '429': { status: { message: 'Rate limit exceeded', status_code: 429 } },
    '500': { status: { message: 'Internal error', status_code: 500 } },
    '503': { status: { message: 'Unavailable', status_code: 503 } },
    malformed200: { not: 'a-match' },
  };
}
