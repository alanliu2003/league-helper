import { describe, expect, it } from 'vitest';
import {
  PublicMatchDetailSchema,
  matchTeamSide,
  parseMatchTeamObjectives,
  sortMatchParticipants,
  sortMatchTeams,
  winningSideFromTeams,
  type PublicMatchItemSlot,
  type PublicMatchParticipant,
} from './match-detail';

describe('parseMatchTeamObjectives', () => {
  it('parses known keys and omits missing types', () => {
    const parsed = parseMatchTeamObjectives({
      dragon: { first: true, kills: 2 },
      baron: { kills: 1 },
      tower: { first: false, kills: 8 },
    });
    expect(parsed.map((o) => o.type)).toEqual(['dragon', 'baron', 'tower']);
    expect(parsed.find((o) => o.type === 'baron')?.first).toBeNull();
    expect(parsed.some((o) => o.type === 'riftHerald')).toBe(false);
  });

  it('ignores unknown keys and invalid kills', () => {
    expect(
      parseMatchTeamObjectives({
        atakhan: { first: true, kills: 1 },
        horde: { kills: 6 },
        dragon: { kills: '3' },
      }),
    ).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(parseMatchTeamObjectives(null)).toEqual([]);
  });
});

describe('ordering', () => {
  it('maps 100/200 to BLUE/RED', () => {
    expect(matchTeamSide(100)).toBe('BLUE');
    expect(matchTeamSide(200)).toBe('RED');
    expect(matchTeamSide(300)).toBe('UNKNOWN');
  });

  it('orders teams 100 then 200 then others', () => {
    expect(sortMatchTeams([{ teamId: 200 }, { teamId: 100 }, { teamId: 300 }]).map((t) => t.teamId)).toEqual([
      100, 200, 300,
    ]);
  });

  it('orders positions TOP…SUPPORT then UNKNOWN by participantId', () => {
    const rows = [
      { participantId: 2, teamPosition: 'UNKNOWN' as const },
      { participantId: 1, teamPosition: 'MIDDLE' as const },
      { participantId: 5, teamPosition: 'TOP' as const },
      { participantId: 3, teamPosition: 'UNKNOWN' as const },
    ];
    expect(sortMatchParticipants(rows).map((r) => r.participantId)).toEqual([5, 1, 2, 3]);
  });
});

describe('ten-player participant ordering', () => {
  it('orders a full lobby TOP → SUPPORT then UNKNOWN', () => {
    const rows = tenPlayerOrderingRows();
    expect(sortMatchParticipants(rows).map((r) => r.participantId)).toEqual([
      5, 8, 3, 7, 1, 6, 2, 9, 4, 10,
    ]);
  });
});

describe('winningSideFromTeams', () => {
  it('returns null for remakes', () => {
    expect(
      winningSideFromTeams(true, [
        { side: 'BLUE', win: true },
        { side: 'RED', win: false },
      ]),
    ).toBeNull();
  });
});

describe('PublicMatchDetailSchema', () => {
  it('parses a remake with null winningSide and empty optional metrics', () => {
    const parsed = PublicMatchDetailSchema.parse(validDetail({ remake: true, winningSide: null }));
    expect(parsed.match.remake).toBe(true);
    expect(parsed.match.winningSide).toBeNull();
  });

  it('requires seven item slots', () => {
    const detail = validDetail();
    detail.teams[0]!.participants[0]!.items = [];
    expect(() => PublicMatchDetailSchema.parse(detail)).toThrow();
  });

  it('preserves UNKNOWN team positions', () => {
    const parsed = PublicMatchDetailSchema.parse(
      validDetail({ participantPosition: 'UNKNOWN' }),
    );
    expect(parsed.teams[0]!.participants[0]!.teamPosition).toBe('UNKNOWN');
  });
});

function slot(slot: number, itemId = 0): PublicMatchItemSlot {
  return { slot, itemId, name: itemId ? `Item ${itemId}` : null, iconUrl: null };
}

function participant(overrides: Partial<PublicMatchParticipant> = {}): PublicMatchParticipant {
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
    items: [0, 1, 2, 3, 4, 5, 6].map((s) => slot(s)),
    summonerSpells: [null, null],
    keystone: null,
    primaryPerkStyle: null,
    secondaryPerkStyle: null,
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

function validDetail(
  overrides: {
    remake?: boolean;
    winningSide?: 'BLUE' | 'RED' | 'UNKNOWN' | null;
    participantPosition?: PublicMatchParticipant['teamPosition'];
  } = {},
) {
  return {
    match: {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
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
      remake: overrides.remake ?? false,
      earlySurrender: false,
      ingestionStatus: 'COMPLETED',
      winningSide: overrides.winningSide === undefined ? 'BLUE' : overrides.winningSide,
    },
    timeline: { status: 'UNAVAILABLE', metricsAvailable: false },
    teams: [
      {
        teamId: 100,
        side: 'BLUE',
        win: !(overrides.remake ?? false),
        bans: [],
        objectives: [],
        totals: { kills: 1, deaths: 0, assists: 1, goldEarned: 8000, damageDealtToChampions: 10000, visionScore: 10 },
        participants: [
          participant({
            teamPosition: overrides.participantPosition ?? 'TOP',
          }),
        ],
      },
      {
        teamId: 200,
        side: 'RED',
        win: false,
        bans: [],
        objectives: [],
        totals: { kills: 0, deaths: 1, assists: 0, goldEarned: 7000, damageDealtToChampions: 8000, visionScore: 8 },
        participants: [
          participant({
            participantId: 6,
            teamId: 200,
            win: false,
            teamPosition: 'TOP',
            riotId: { gameName: 'Bob', tagLine: 'NA1' },
          }),
        ],
      },
    ],
  };
}

function tenPlayerOrderingRows() {
  return [
    { participantId: 1, teamPosition: 'MIDDLE' as const },
    { participantId: 2, teamPosition: 'BOTTOM' as const },
    { participantId: 3, teamPosition: 'JUNGLE' as const },
    { participantId: 4, teamPosition: 'UNKNOWN' as const },
    { participantId: 5, teamPosition: 'TOP' as const },
    { participantId: 6, teamPosition: 'MIDDLE' as const },
    { participantId: 7, teamPosition: 'JUNGLE' as const },
    { participantId: 8, teamPosition: 'TOP' as const },
    { participantId: 9, teamPosition: 'SUPPORT' as const },
    { participantId: 10, teamPosition: 'UNKNOWN' as const },
  ];
}
