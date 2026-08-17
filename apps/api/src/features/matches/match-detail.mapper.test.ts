import { describe, expect, it } from 'vitest';
import { MatchIngestionStatus, TimelineFetchStatus } from '@prisma/client';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import type { MatchDetailRow } from '../../persistence/match.repository';
import { assertNoPuuidLeak } from '../players/player-response.mapper';
import { mapPublicMatchDetail, type MatchDetailMapContext } from './match-detail.mapper';
import type { MatchStaticLookups } from './match-detail-static';

const PLAYER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MATCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const tryndamere: DataDragonChampion = {
  id: 'Tryndamere',
  key: '23',
  name: 'Tryndamere',
  title: 'the Barbarian King',
  iconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
  splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg',
};

const lookups: MatchStaticLookups = {
  dataDragonVersion: '14.11.1',
  items: new Map([[3031, { name: 'Infinity Edge' }]]),
  runes: new Map([
    [
      8005,
      {
        name: 'Press the Attack',
        icon: 'perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
        treeId: 8000,
        treeName: 'Precision',
      },
    ],
  ]),
  spells: new Map([[4, { name: 'Flash', imageFull: 'SummonerFlash.png' }]]),
  styleNames: new Map([[8000, 'Precision']]),
};

const ctx: MatchDetailMapContext = {
  champions: new Map([[23, tryndamere]]),
  lookups,
  icons: {
    itemIcon: (id, version) => `https://cdn.test/item/${version}/${id}.png`,
    runeIcon: (path) => `https://cdn.test/${path}`,
    spellIcon: (imageFull, version) => `https://cdn.test/spell/${version}/${imageFull}`,
  },
};

type DetailParticipant = MatchDetailRow['participants'][number];

function participant(overrides: Partial<DetailParticipant> = {}): DetailParticipant {
  return {
    participantId: 1,
    teamId: 100,
    riotIdGameName: 'Alice',
    riotIdTagLine: 'NA1',
    championId: 23,
    championName: 'Tryndamere',
    teamPosition: 'TOP',
    individualPosition: 'TOP',
    lane: 'TOP',
    role: 'SOLO',
    win: true,
    kills: 1,
    deaths: 0,
    assists: 1,
    totalMinionsKilled: 80,
    neutralMinionsKilled: 20,
    totalCs: 100,
    goldEarned: 8000,
    totalDamageDealtToChampions: 1000,
    totalDamageTaken: 8000,
    visionScore: 10,
    wardsPlaced: 5,
    wardsKilled: 1,
    controlWardsPurchased: 2,
    itemIds: [3031, 0, 0, 0, 0, 0, 0],
    perkIds: [8005],
    statPerkIds: [],
    primaryPerkStyleId: 8000,
    secondaryPerkStyleId: null,
    summonerSpell1Id: 4,
    summonerSpell2Id: 0,
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
    killParticipation: null,
    playerAccount: null,
    ...overrides,
  };
}

function team(teamId: number, win: boolean, overrides: Partial<MatchDetailRow['teams'][number]> = {}) {
  return {
    teamId,
    win,
    bans: [] as number[],
    objectives: null,
    ...overrides,
  };
}

function detailRow(overrides: Partial<MatchDetailRow> = {}): MatchDetailRow {
  const base: MatchDetailRow = {
    id: MATCH_ID,
    provider: 'RIOT',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    gameCreation: new Date('2026-08-01T00:00:00.000Z'),
    gameEndTimestamp: new Date('2026-08-01T00:30:00.000Z'),
    gameDurationSeconds: 1800,
    gameVersion: '14.11.1.123',
    normalizedPatch: '14.11',
    remake: false,
    earlySurrender: false,
    ingestionStatus: MatchIngestionStatus.COMPLETED,
    teams: [team(100, true), team(200, false)],
    participants: [
      participant(),
      participant({
        participantId: 6,
        teamId: 200,
        win: false,
        riotIdGameName: 'Bob',
        riotIdTagLine: 'NA1',
        totalDamageDealtToChampions: 3000,
      }),
    ],
    timeline: { fetchStatus: TimelineFetchStatus.SKIPPED },
  };
  return {
    ...base,
    ...overrides,
    teams: overrides.teams ?? base.teams,
    participants: overrides.participants ?? base.participants,
    timeline: overrides.timeline === undefined ? base.timeline : overrides.timeline,
  };
}

function tenPlayerParticipants(): DetailParticipant[] {
  const positions = ['MIDDLE', 'BOTTOM', 'JUNGLE', 'UNKNOWN', 'TOP'] as const;
  const blue = positions.map((teamPosition, index) =>
    participant({
      participantId: index + 1,
      teamId: 100,
      teamPosition,
      individualPosition: teamPosition === 'UNKNOWN' ? 'NONE' : teamPosition,
      lane: teamPosition === 'UNKNOWN' ? null : teamPosition,
      role: teamPosition === 'UNKNOWN' ? null : 'SOLO',
      riotIdGameName: `Blue${index + 1}`,
      riotIdTagLine: 'NA1',
    }),
  );
  const red = positions.map((teamPosition, index) =>
    participant({
      participantId: index + 6,
      teamId: 200,
      win: false,
      teamPosition,
      individualPosition: teamPosition === 'UNKNOWN' ? 'NONE' : teamPosition,
      lane: teamPosition === 'UNKNOWN' ? null : teamPosition,
      role: teamPosition === 'UNKNOWN' ? null : 'SOLO',
      riotIdGameName: `Red${index + 1}`,
      riotIdTagLine: 'NA1',
    }),
  );
  return [...blue, ...red];
}

describe('mapPublicMatchDetail', () => {
  it('orders 10 participants into Blue then Red with TOP first', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({ participants: tenPlayerParticipants() }),
      ctx,
    );
    expect(mapped.teams.map((t) => t.teamId)).toEqual([100, 200]);
    expect(mapped.teams[0]!.participants.map((p) => p.participantId)).toEqual([5, 3, 1, 2, 4]);
    expect(mapped.teams[1]!.participants.map((p) => p.participantId)).toEqual([10, 8, 6, 7, 9]);
    expect(mapped.teams[0]!.side).toBe('BLUE');
    expect(mapped.teams[1]!.side).toBe('RED');
  });

  it('maps untracked riot id without a public playerId', () => {
    const mapped = mapPublicMatchDetail(detailRow(), ctx);
    const alice = mapped.teams[0]!.participants[0]!;
    expect(alice.playerId).toBeNull();
    expect(alice.riotId).toEqual({ gameName: 'Alice', tagLine: 'NA1' });
  });

  it('maps tracked account playerId and current riot id without leaking PUUID', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({
        participants: [
          participant({
            riotIdGameName: 'OldName',
            riotIdTagLine: 'NA1',
            playerAccount: {
              playerId: PLAYER_ID,
              currentGameName: 'Current',
              currentTagLine: 'NA1',
            },
          }),
          participant({ participantId: 6, teamId: 200, win: false }),
        ],
      }),
      ctx,
    );
    const alice = mapped.teams[0]!.participants[0]!;
    expect(alice.playerId).toBe(PLAYER_ID);
    expect(alice.riotId).toEqual({ gameName: 'Current', tagLine: 'NA1' });
    assertNoPuuidLeak(mapped);
    expect(JSON.stringify(mapped)).not.toContain('externalAccountId');
    expect(JSON.stringify(mapped).toLowerCase()).not.toContain('puuid');
  });

  it('keeps empty item slots as itemId 0 and uses perkIds[0] as keystone', () => {
    const mapped = mapPublicMatchDetail(detailRow(), ctx);
    const items = mapped.teams[0]!.participants[0]!.items;
    expect(items).toHaveLength(7);
    expect(items[0]).toMatchObject({ slot: 0, itemId: 3031, name: 'Infinity Edge' });
    expect(items[1]).toMatchObject({ slot: 1, itemId: 0, name: null, iconUrl: null });
    expect(items[6]).toMatchObject({ slot: 6, itemId: 0 });
    expect(mapped.teams[0]!.participants[0]!.keystone).toMatchObject({
      id: 8005,
      name: 'Press the Attack',
    });
  });

  it('sets winningSide null for remakes and keeps goldAt10 null', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({
        remake: true,
        participants: [participant({ goldAt10: null }), participant({ participantId: 6, teamId: 200, win: false })],
      }),
      ctx,
    );
    expect(mapped.match.winningSide).toBeNull();
    expect(mapped.match.remake).toBe(true);
    expect(mapped.teams[0]!.participants[0]!.goldAt10).toBeNull();
  });

  it('computes team damage share and leaves it null when team damage is 0', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({
        participants: [
          participant({ totalDamageDealtToChampions: 1000 }),
          participant({
            participantId: 2,
            teamId: 100,
            totalDamageDealtToChampions: 3000,
            riotIdGameName: 'Carol',
            riotIdTagLine: 'NA1',
          }),
          participant({ participantId: 6, teamId: 200, win: false, totalDamageDealtToChampions: 0 }),
        ],
      }),
      ctx,
    );
    const shares = mapped.teams[0]!.participants.map((p) => p.damageShare);
    expect(shares).toEqual([0.25, 0.75]);
    expect(mapped.teams[1]!.participants[0]!.damageShare).toBeNull();
  });

  it('preserves UNKNOWN positions', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({
        queueId: 450,
        gameMode: 'ARAM',
        mapId: 12,
        participants: [
          participant({ teamPosition: 'NONE', individualPosition: 'Invalid', lane: null, role: 'SUPPORT' }),
          participant({ participantId: 6, teamId: 200, win: false, teamPosition: 'NONE' }),
        ],
      }),
      ctx,
    );
    expect(mapped.teams[0]!.participants[0]!.teamPosition).toBe('UNKNOWN');
  });

  it('maps incomplete matches with fewer than 10 participants', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({
        ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
        participants: [
          participant(),
          participant({ participantId: 2, riotIdGameName: 'Two', riotIdTagLine: 'NA1' }),
          participant({ participantId: 6, teamId: 200, win: false }),
        ],
      }),
      ctx,
    );
    expect(mapped.match.ingestionStatus).toBe('IN_PROGRESS');
    expect(mapped.teams.flatMap((t) => t.participants)).toHaveLength(3);
  });

  it('falls back to stored champion name when Data Dragon is missing', () => {
    const mapped = mapPublicMatchDetail(detailRow(), {
      ...ctx,
      champions: new Map(),
    });
    expect(mapped.teams[0]!.participants[0]!.championName).toBe('Tryndamere');
    expect(mapped.teams[0]!.participants[0]!.championKey).toBeNull();
  });

  it('maps FETCHED timeline to AVAILABLE when metrics exist', () => {
    const mapped = mapPublicMatchDetail(
      detailRow({
        timeline: { fetchStatus: TimelineFetchStatus.FETCHED },
        participants: [participant({ goldAt10: 3000 }), participant({ participantId: 6, teamId: 200, win: false })],
      }),
      ctx,
    );
    expect(mapped.timeline).toEqual({ status: 'AVAILABLE', metricsAvailable: true });
  });
});
