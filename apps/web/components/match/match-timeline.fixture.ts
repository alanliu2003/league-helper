import {
  PublicMatchTimelineDetailSchema,
  type PublicMatchKillEvent,
  type PublicMatchObjectiveEvent,
  type PublicMatchTimelineDetail,
  type PublicMatchTimelineEvent,
  type PublicMatchTimelineFrame,
  type PublicMatchTimelineParticipant,
} from '@league-helper/shared';
import { MATCH_DETAIL_ID, ORIGIN_PLAYER_ID } from './match-detail.fixture';

export const TIMELINE_KILL_MS = 134_000;

export function timelineParticipant(
  overrides: Partial<PublicMatchTimelineParticipant> = {},
): PublicMatchTimelineParticipant {
  return {
    participantId: 1,
    teamId: 100,
    side: 'BLUE',
    playerId: ORIGIN_PLAYER_ID,
    riotId: { gameName: 'Alice', tagLine: 'NA1' },
    championId: 23,
    championKey: 'Tryndamere',
    championName: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
    teamPosition: 'TOP',
    ...overrides,
  };
}

export function timelineEvent(
  overrides: Partial<PublicMatchTimelineEvent> = {},
): PublicMatchTimelineEvent {
  return {
    eventIndex: 0,
    timestampMs: 10_000,
    type: 'ITEM_PURCHASED',
    participantId: 1,
    killerParticipantId: null,
    victimParticipantId: null,
    assistingParticipantIds: [],
    teamId: null,
    itemId: 3031,
    beforeItemId: null,
    afterItemId: null,
    skillSlot: null,
    levelUpType: null,
    monsterType: null,
    monsterSubType: null,
    buildingType: null,
    towerType: null,
    laneType: null,
    position: null,
    item: {
      id: 3031,
      name: 'Infinity Edge',
      iconUrl: 'https://cdn.test/item/3031.png',
    },
    skillLabel: null,
    ...overrides,
  };
}

export function timelineFrame(
  overrides: Partial<PublicMatchTimelineFrame> = {},
): PublicMatchTimelineFrame {
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

const defaultParticipants: PublicMatchTimelineParticipant[] = [
  timelineParticipant(),
  timelineParticipant({
    participantId: 6,
    teamId: 200,
    side: 'RED',
    playerId: null,
    riotId: { gameName: 'Bob', tagLine: 'NA1' },
    championId: 266,
    championKey: 'Aatrox',
    championName: 'Aatrox',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Aatrox.png',
  }),
];

const defaultKill: PublicMatchKillEvent = {
  timestampMs: TIMELINE_KILL_MS,
  killerKind: 'CHAMPION',
  killerParticipantId: 1,
  victimParticipantId: 6,
  assistingParticipantIds: [],
  position: null,
};

const defaultObjective: PublicMatchObjectiveEvent = {
  timestampMs: 300_000,
  type: 'dragon',
  killerKind: 'CHAMPION',
  killerParticipantId: 1,
  assistingParticipantIds: [],
  ownerTeamId: null,
  killerTeamId: 100,
  monsterSubType: 'FIRE_DRAGON',
  towerType: null,
  laneType: null,
  position: null,
};

export function timelineDetailFixture(
  overrides: Partial<PublicMatchTimelineDetail> = {},
): PublicMatchTimelineDetail {
  const base: PublicMatchTimelineDetail = {
    matchId: MATCH_DETAIL_ID,
    status: 'AVAILABLE',
    coverage: {
      items: true,
      skills: true,
      kills: true,
      objectives: true,
      frames: true,
    },
    frameIntervalMs: 60_000,
    participants: defaultParticipants,
    events: [
      timelineEvent({
        eventIndex: 0,
        timestampMs: 5_000,
        type: 'ITEM_PURCHASED',
        participantId: 6,
        itemId: 1055,
        item: { id: 1055, name: "Doran's Blade", iconUrl: 'https://cdn.test/item/1055.png' },
      }),
      timelineEvent({
        eventIndex: 1,
        timestampMs: 10_000,
        type: 'ITEM_PURCHASED',
        participantId: 1,
      }),
      timelineEvent({
        eventIndex: 2,
        timestampMs: 20_000,
        type: 'SKILL_LEVEL_UP',
        participantId: 1,
        itemId: null,
        item: null,
        skillSlot: 1,
        skillLabel: 'Q',
        levelUpType: 'NORMAL',
      }),
      timelineEvent({
        eventIndex: 3,
        timestampMs: TIMELINE_KILL_MS,
        type: 'CHAMPION_KILL',
        participantId: 1,
        killerParticipantId: 1,
        victimParticipantId: 6,
        itemId: null,
        item: null,
      }),
      timelineEvent({
        eventIndex: 4,
        timestampMs: 300_000,
        type: 'ELITE_MONSTER_KILL',
        participantId: 1,
        killerParticipantId: 1,
        teamId: 100,
        itemId: null,
        item: null,
        monsterType: 'DRAGON',
        monsterSubType: 'FIRE_DRAGON',
      }),
    ],
    frames: [
      timelineFrame({ timestampMs: 0, participantId: 1, totalGold: 500 }),
      timelineFrame({ timestampMs: 0, participantId: 6, totalGold: 500 }),
      timelineFrame({ timestampMs: 60_000, participantId: 1, totalGold: 1200 }),
      timelineFrame({ timestampMs: 60_000, participantId: 6, totalGold: 900 }),
    ],
    derived: {
      kills: [defaultKill],
      objectives: [defaultObjective],
      gold: {
        timestampsMs: [0, 60_000],
        teams: [
          { teamId: 100, side: 'BLUE', gold: [500, 1200] },
          { teamId: 200, side: 'RED', gold: [500, 900] },
        ],
        participants: [
          { participantId: 1, gold: [500, 1200] },
          { participantId: 6, gold: [500, 900] },
        ],
        difference: [0, 300],
      },
    },
  };

  return PublicMatchTimelineDetailSchema.parse({
    ...base,
    ...overrides,
    coverage: { ...base.coverage, ...overrides.coverage },
    derived: {
      ...base.derived,
      ...overrides.derived,
      gold: {
        ...base.derived.gold,
        ...overrides.derived?.gold,
      },
    },
  });
}

export function emptyTimelineDetailFixture(
  status: PublicMatchTimelineDetail['status'] = 'UNAVAILABLE',
): PublicMatchTimelineDetail {
  return timelineDetailFixture({
    status,
    coverage: {
      items: false,
      skills: false,
      kills: false,
      objectives: false,
      frames: false,
    },
    events: [],
    frames: [],
    derived: {
      kills: [],
      objectives: [],
      gold: {
        timestampsMs: [],
        teams: [],
        participants: [],
        difference: null,
      },
    },
  });
}
