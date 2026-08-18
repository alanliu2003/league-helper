import { describe, expect, it } from 'vitest';
import { MatchIngestionStatus, TimelineFetchStatus, TimelineProductCoverage } from '@prisma/client';
import { PublicMatchTimelineDetailSchema } from '@league-helper/shared';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import type { MatchDetailRow } from '../../persistence/match.repository';
import { assertNoPuuidLeak } from '../players/player-response.mapper';
import type { MatchDetailMapContext } from './match-detail.mapper';
import type { MatchStaticLookups } from './match-detail-static';
import {
  mapPublicMatchTimelineDetail,
  type MatchTimelineEventLoad,
  type MatchTimelineFrameLoad,
} from './match-timeline.mapper';

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

const aatrox: DataDragonChampion = {
  id: 'Aatrox',
  key: '266',
  name: 'Aatrox',
  title: 'the Darkin Blade',
  iconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Aatrox.png',
  splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_0.jpg',
};

const lookups: MatchStaticLookups = {
  dataDragonVersion: '14.11.1',
  items: new Map([[3031, { name: 'Infinity Edge' }]]),
  runes: new Map(),
  spells: new Map(),
  styleNames: new Map(),
};

const ctx: MatchDetailMapContext = {
  champions: new Map([
    [23, tryndamere],
    [266, aatrox],
  ]),
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
    perkIds: [],
    statPerkIds: [],
    primaryPerkStyleId: null,
    secondaryPerkStyleId: null,
    summonerSpell1Id: 0,
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
    teams: [
      { teamId: 100, win: true, bans: [], objectives: null },
      { teamId: 200, win: false, bans: [], objectives: null },
    ],
    participants: [
      participant(),
      participant({
        participantId: 6,
        teamId: 200,
        win: false,
        championId: 266,
        championName: 'Aatrox',
        riotIdGameName: 'Bob',
        riotIdTagLine: 'NA1',
      }),
    ],
    timeline: {
      fetchStatus: TimelineFetchStatus.FETCHED,
      productCoverage: TimelineProductCoverage.STORED,
    },
  };
  return {
    ...base,
    ...overrides,
    teams: overrides.teams ?? base.teams,
    participants: overrides.participants ?? base.participants,
    timeline: overrides.timeline === undefined ? base.timeline : overrides.timeline,
  };
}

function event(overrides: Partial<MatchTimelineEventLoad> = {}): MatchTimelineEventLoad {
  return {
    eventIndex: 0,
    type: 'ITEM_PURCHASED',
    timestampMs: 1000,
    participantId: 1,
    itemId: 3031,
    beforeItemId: null,
    afterItemId: null,
    skillSlot: null,
    levelUpType: null,
    killerParticipantId: null,
    victimParticipantId: null,
    assistingParticipantIds: [],
    teamId: null,
    positionX: null,
    positionY: null,
    monsterType: null,
    monsterSubType: null,
    buildingType: null,
    towerType: null,
    laneType: null,
    ...overrides,
  };
}

function frame(overrides: Partial<MatchTimelineFrameLoad> = {}): MatchTimelineFrameLoad {
  return {
    timestampMs: 0,
    participantId: 1,
    totalGold: 500,
    xp: 0,
    cs: 0,
    level: 1,
    ...overrides,
  };
}

function map(
  overrides: {
    row?: MatchDetailRow;
    events?: MatchTimelineEventLoad[];
    frames?: MatchTimelineFrameLoad[];
    frameIntervalMs?: number | null;
  } = {},
) {
  return mapPublicMatchTimelineDetail({
    row: overrides.row ?? detailRow(),
    events: overrides.events ?? [],
    frames: overrides.frames ?? [],
    frameIntervalMs: overrides.frameIntervalMs === undefined ? 60_000 : overrides.frameIntervalMs,
    ctx,
  });
}

describe('mapPublicMatchTimelineDetail', () => {
  it('maps participants with side, riot id, and champion identity', () => {
    const mapped = map({
      row: detailRow({
        participants: [
          participant({
            playerAccount: {
              playerId: PLAYER_ID,
              currentGameName: 'Current',
              currentTagLine: 'NA1',
            },
          }),
          participant({
            participantId: 6,
            teamId: 200,
            win: false,
            championId: 266,
            championName: 'Aatrox',
            riotIdGameName: 'Bob',
            riotIdTagLine: 'NA1',
          }),
        ],
      }),
    });
    expect(mapped.participants).toEqual([
      expect.objectContaining({
        participantId: 1,
        teamId: 100,
        side: 'BLUE',
        playerId: PLAYER_ID,
        riotId: { gameName: 'Current', tagLine: 'NA1' },
        championId: 23,
        championKey: 'Tryndamere',
        championName: 'Tryndamere',
        teamPosition: 'TOP',
      }),
      expect.objectContaining({
        participantId: 6,
        teamId: 200,
        side: 'RED',
        playerId: null,
        riotId: { gameName: 'Bob', tagLine: 'NA1' },
        championId: 266,
        championKey: 'Aatrox',
      }),
    ]);
  });

  it('returns empty coverage and 200-shaped payload when a match has no product rows', () => {
    const mapped = map({ events: [], frames: [], frameIntervalMs: null });
    const parsed = PublicMatchTimelineDetailSchema.parse(mapped);
    expect(parsed.coverage).toEqual({
      items: false,
      skills: false,
      kills: false,
      objectives: false,
      frames: false,
    });
    expect(parsed.events).toEqual([]);
    expect(parsed.frames).toEqual([]);
    expect(parsed.derived.kills).toEqual([]);
    expect(parsed.derived.objectives).toEqual([]);
    expect(parsed.status).toBe('AVAILABLE');
  });

  it('emits only persisted event types and sorts by timestamp then eventIndex', () => {
    const mapped = map({
      events: [
        event({ eventIndex: 2, type: 'SKILL_LEVEL_UP', timestampMs: 2000, skillSlot: 1 }),
        event({ eventIndex: 0, type: 'WARD_PLACED', timestampMs: 500, participantId: 1 }),
        event({ eventIndex: 1, type: 'ITEM_PURCHASED', timestampMs: 2000, itemId: 3031 }),
      ],
    });
    expect(mapped.events.map((row) => row.type)).toEqual(['ITEM_PURCHASED', 'SKILL_LEVEL_UP']);
    expect(mapped.events.map((row) => row.eventIndex)).toEqual([1, 2]);
    expect(mapped.events.some((row) => row.type === 'WARD_PLACED')).toBe(false);
    expect(mapped.coverage).toEqual({
      items: true,
      skills: true,
      kills: false,
      objectives: false,
      frames: false,
    });
  });

  it('maps item identity and skill labels from static lookups', () => {
    const mapped = map({
      events: [
        event({ eventIndex: 0, type: 'ITEM_PURCHASED', itemId: 3031, participantId: 1 }),
        event({
          eventIndex: 1,
          type: 'ITEM_UNDO',
          itemId: null,
          beforeItemId: 3031,
          afterItemId: 0,
          participantId: 1,
        }),
        event({ eventIndex: 2, type: 'SKILL_LEVEL_UP', skillSlot: 4, participantId: 1 }),
      ],
    });
    expect(mapped.events[0]!.item).toEqual({
      id: 3031,
      name: 'Infinity Edge',
      iconUrl: 'https://cdn.test/item/14.11.1/3031.png',
    });
    expect(mapped.events[1]!.beforeItemId).toBe(3031);
    expect(mapped.events[1]!.afterItemId).toBe(0);
    expect(mapped.events[2]!.skillLabel).toBe('R');
  });

  it('maps position only when both coordinates are integers', () => {
    const mapped = map({
      events: [
        event({ eventIndex: 0, positionX: 12, positionY: 34 }),
        event({ eventIndex: 1, timestampMs: 2000, positionX: 12, positionY: null }),
      ],
    });
    expect(mapped.events[0]!.position).toEqual({ x: 12, y: 34 });
    expect(mapped.events[1]!.position).toBeNull();
  });

  it('treats killer 0 or missing as ENVIRONMENT and never emits participant 0', () => {
    const mapped = map({
      events: [
        event({
          eventIndex: 0,
          type: 'CHAMPION_KILL',
          timestampMs: 5000,
          participantId: 0,
          killerParticipantId: 0,
          victimParticipantId: 6,
          assistingParticipantIds: [0, 1],
          positionX: 1,
          positionY: 2,
        }),
        event({
          eventIndex: 1,
          type: 'CHAMPION_KILL',
          timestampMs: 6000,
          killerParticipantId: null,
          victimParticipantId: 6,
        }),
      ],
    });
    expect(mapped.derived.kills).toEqual([
      {
        timestampMs: 5000,
        killerKind: 'ENVIRONMENT',
        killerParticipantId: null,
        victimParticipantId: 6,
        assistingParticipantIds: [1],
        position: { x: 1, y: 2 },
      },
      {
        timestampMs: 6000,
        killerKind: 'ENVIRONMENT',
        killerParticipantId: null,
        victimParticipantId: 6,
        assistingParticipantIds: [],
        position: null,
      },
    ]);
    expect(mapped.events[0]!.killerParticipantId).toBeNull();
    expect(mapped.events[0]!.participantId).toBeNull();
    expect(JSON.stringify(mapped)).not.toContain('"killerParticipantId":0');
    expect(mapped.participants.some((row) => row.participantId === 0)).toBe(false);
  });

  it('skips kills whose victim participant is missing', () => {
    const mapped = map({
      events: [
        event({
          eventIndex: 0,
          type: 'CHAMPION_KILL',
          killerParticipantId: 1,
          victimParticipantId: 99,
        }),
        event({
          eventIndex: 1,
          type: 'CHAMPION_KILL',
          timestampMs: 2000,
          killerParticipantId: 1,
          victimParticipantId: null,
        }),
      ],
    });
    expect(mapped.derived.kills).toEqual([]);
    expect(mapped.coverage.kills).toBe(true);
  });

  it('maps champion kills with killer participant id', () => {
    const mapped = map({
      events: [
        event({
          eventIndex: 0,
          type: 'CHAMPION_KILL',
          killerParticipantId: 1,
          victimParticipantId: 6,
          assistingParticipantIds: [1],
        }),
      ],
    });
    expect(mapped.derived.kills).toEqual([
      {
        timestampMs: 1000,
        killerKind: 'CHAMPION',
        killerParticipantId: 1,
        victimParticipantId: 6,
        assistingParticipantIds: [1],
        position: null,
      },
    ]);
  });

  it('omits HORDE and ATAKHAN from derived objectives even when stored', () => {
    const mapped = map({
      events: [
        event({
          eventIndex: 0,
          type: 'ELITE_MONSTER_KILL',
          monsterType: 'HORDE',
          teamId: 100,
          killerParticipantId: 1,
        }),
        event({
          eventIndex: 1,
          type: 'ELITE_MONSTER_KILL',
          timestampMs: 2000,
          monsterType: 'ATAKHAN',
          teamId: 100,
          killerParticipantId: 1,
        }),
        event({
          eventIndex: 2,
          type: 'ELITE_MONSTER_KILL',
          timestampMs: 3000,
          monsterType: 'DRAGON',
          monsterSubType: 'FIRE_DRAGON',
          teamId: 100,
          killerParticipantId: 1,
        }),
      ],
    });
    expect(mapped.events).toHaveLength(3);
    expect(mapped.derived.objectives).toEqual([
      expect.objectContaining({
        type: 'dragon',
        killerKind: 'CHAMPION',
        killerParticipantId: 1,
        ownerTeamId: null,
        killerTeamId: 100,
        monsterSubType: 'FIRE_DRAGON',
      }),
    ]);
    expect(mapped.coverage.objectives).toBe(true);
  });

  it('maps BUILDING_KILL ownerTeamId from event teamId and killerTeamId from the champion killer', () => {
    const mapped = map({
      events: [
        event({
          eventIndex: 0,
          type: 'BUILDING_KILL',
          buildingType: 'TOWER_BUILDING',
          towerType: 'OUTER_TURRET',
          laneType: 'TOP_LANE',
          teamId: 200,
          killerParticipantId: 1,
          victimParticipantId: null,
        }),
        event({
          eventIndex: 1,
          type: 'BUILDING_KILL',
          timestampMs: 2000,
          buildingType: 'INHIBITOR_BUILDING',
          teamId: 200,
          killerParticipantId: 0,
        }),
      ],
    });
    expect(mapped.derived.objectives).toEqual([
      expect.objectContaining({
        type: 'tower',
        ownerTeamId: 200,
        killerTeamId: 100,
        killerKind: 'CHAMPION',
        killerParticipantId: 1,
        towerType: 'OUTER_TURRET',
        laneType: 'TOP_LANE',
      }),
      expect.objectContaining({
        type: 'inhibitor',
        ownerTeamId: 200,
        killerTeamId: null,
        killerKind: 'ENVIRONMENT',
        killerParticipantId: null,
      }),
    ]);
  });

  it('derives gold from complete frame snapshots only', () => {
    const mapped = map({
      frames: [
        frame({ timestampMs: 0, participantId: 1, totalGold: 500 }),
        frame({ timestampMs: 0, participantId: 6, totalGold: 400 }),
        frame({ timestampMs: 60_000, participantId: 1, totalGold: 1500 }),
      ],
      frameIntervalMs: 60_000,
    });
    expect(mapped.frameIntervalMs).toBe(60_000);
    expect(mapped.coverage.frames).toBe(true);
    expect(mapped.derived.gold.timestampsMs).toEqual([0]);
    expect(mapped.derived.gold.teams).toEqual([
      { teamId: 100, side: 'BLUE', gold: [500] },
      { teamId: 200, side: 'RED', gold: [400] },
    ]);
    expect(mapped.derived.gold.difference).toEqual([100]);
  });

  it('does not leak PUUID-looking fields from a mock row', () => {
    const leakyRow = {
      ...detailRow(),
      externalMatchId: 'NA1_SECRET',
      participants: [
        {
          ...participant(),
          externalAccountId: 'puuid-looking',
        },
        participant({
          participantId: 6,
          teamId: 200,
          win: false,
          championId: 266,
          championName: 'Aatrox',
        }),
      ],
    };
    const leakyEvents = [
      {
        ...event(),
        externalAccountId: 'puuid-looking',
        rawPayload: { puuid: 'puuid-looking' },
      },
    ];
    const mapped = map({
      row: leakyRow as MatchDetailRow,
      events: leakyEvents as MatchTimelineEventLoad[],
    });
    assertNoPuuidLeak(mapped);
    const json = JSON.stringify(mapped);
    expect(json).not.toContain('puuid-looking');
    expect(json).not.toContain('externalAccountId');
    expect(json).not.toContain('rawPayload');
    expect(json.toLowerCase()).not.toContain('puuid');
    expect(mapped).not.toHaveProperty('externalMatchId');
  });
});
