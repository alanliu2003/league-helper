import {
  FAKE_PUUID,
  type RiotMatchDto,
  type RiotMatchTimelineDto,
} from '@league-helper/server-riot';

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

export function buildPuuid(index: number): string {
  if (index === 0) {
    return FAKE_PUUID;
  }
  return `fake-puuid-participant-${String(index).padStart(2, '0')}-${'x'.repeat(40)}`;
}

/** Full 10-participant ranked solo fixture for persistence / normalizer tests. */
export function buildRankedMatchDto(
  overrides: {
    matchId?: string;
    gameDuration?: number;
    queueId?: number;
    earlySurrenderParticipant?: boolean;
    surrenderParticipant?: boolean;
    omitOptional?: boolean;
    unknownRole?: boolean;
    invalidParticipant?: boolean;
  } = {},
): RiotMatchDto {
  const matchId = overrides.matchId ?? 'NA1_FAKE_MATCH_RANKED_10';
  const participants = Array.from({ length: 10 }, (_, index) => {
    const teamId = index < 5 ? 100 : 200;
    const positionIndex = index % 5;
    const position = overrides.unknownRole && index === 0 ? '' : POSITIONS[positionIndex]!;
    return {
      participantId: index + 1,
      puuid: buildPuuid(index),
      riotIdGameName: `Player${index + 1}`,
      riotIdTagline: 'NA1',
      championId: 100 + index,
      championName: `Champ${index + 1}`,
      teamId,
      teamPosition: position,
      individualPosition: position || 'Invalid',
      lane: overrides.omitOptional ? undefined : 'MIDDLE',
      role: overrides.omitOptional ? undefined : 'SOLO',
      win: teamId === 100,
      kills: index,
      deaths: 1,
      assists: 2,
      totalMinionsKilled: 100 + index,
      neutralMinionsKilled: 10,
      goldEarned: 10_000 + index * 100,
      goldSpent: 9_000,
      totalDamageDealtToChampions: 20_000,
      physicalDamageDealtToChampions: 10_000,
      magicDamageDealtToChampions: 8_000,
      trueDamageDealtToChampions: 2_000,
      totalDamageTaken: 15_000,
      visionScore: 20,
      wardsPlaced: 5,
      wardsKilled: 2,
      detectorWardsPlaced: 1,
      largestKillingSpree: 3,
      timePlayed: overrides.gameDuration ?? 1800,
      item0: 3031,
      item1: 3006,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 3340,
      summoner1Id: 4,
      summoner2Id: 14,
      gameEndedInEarlySurrender: overrides.earlySurrenderParticipant === true && index === 0,
      gameEndedInSurrender: overrides.surrenderParticipant === true && index === 0,
      perks: {
        statPerks: { offense: 5008, flex: 5008, defense: 5002 },
        styles: [
          {
            description: 'primaryStyle',
            style: 8000,
            selections: [
              { perk: 8005, var1: 1, var2: 2, var3: 3 },
              { perk: 8008, var1: 1, var2: 2, var3: 3 },
            ],
          },
          {
            description: 'subStyle',
            style: 8100,
            selections: [{ perk: 8126, var1: 1, var2: 2, var3: 3 }],
          },
        ],
      },
    };
  });

  if (overrides.invalidParticipant) {
    delete (participants[0] as { championId?: number }).championId;
  }

  return {
    metadata: {
      dataVersion: '2',
      matchId,
      participants: participants.map((participant) => participant.puuid),
    },
    info: {
      gameCreation: 1_700_000_000_000,
      gameDuration: overrides.gameDuration ?? 1800,
      gameEndTimestamp: 1_700_001_800_000,
      gameId: 987_654_321,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      gameVersion: '14.1.1.123',
      mapId: 11,
      platformId: 'NA1',
      queueId: overrides.queueId ?? 420,
      participants,
      teams: [
        {
          teamId: 100,
          win: true,
          bans: [{ championId: 99, pickTurn: 1 }],
          objectives: {
            baron: { first: false, kills: 0 },
            champion: { first: true, kills: 25 },
            dragon: { first: true, kills: 2 },
            inhibitor: { first: false, kills: 0 },
            riftHerald: { first: true, kills: 1 },
            tower: { first: true, kills: 7 },
          },
        },
        {
          teamId: 200,
          win: false,
          bans: [{ championId: 55, pickTurn: 2 }],
          objectives: {
            baron: { first: true, kills: 1 },
            champion: { first: false, kills: 18 },
            dragon: { first: false, kills: 1 },
            inhibitor: { first: true, kills: 1 },
            riftHerald: { first: false, kills: 0 },
            tower: { first: false, kills: 3 },
          },
        },
      ],
    },
  };
}

/** Timeline covering 0/10/15 minute frames with kills, skills, and item events. */
export function buildRichTimelineDto(
  overrides: {
    matchId?: string;
    omitFrame15?: boolean;
    ambiguousRoles?: boolean;
  } = {},
): RiotMatchTimelineDto {
  const matchId = overrides.matchId ?? 'NA1_FAKE_MATCH_RANKED_10';

  const frameAt = (minute: number): RiotMatchTimelineDto['info']['frames'][number] => {
    const participantFrames: RiotMatchTimelineDto['info']['frames'][number]['participantFrames'] =
      {};
    for (let i = 1; i <= 10; i += 1) {
      participantFrames[String(i)] = {
        participantId: i,
        level: minute === 0 ? 1 : minute,
        xp: minute * 1000 + i,
        totalGold: 500 + minute * 800 + i * 10,
        currentGold: 200,
        minionsKilled: minute * 6 + i,
        jungleMinionsKilled: minute,
      };
    }
    return {
      timestamp: minute * 60_000,
      participantFrames,
      events:
        minute === 0
          ? [
              {
                type: 'ITEM_PURCHASED',
                timestamp: 5_000,
                participantId: 1,
                itemId: 1055,
              },
              {
                type: 'ITEM_UNDO',
                timestamp: 6_000,
                participantId: 1,
                itemId: 1055,
              },
              {
                type: 'ITEM_PURCHASED',
                timestamp: 7_000,
                participantId: 1,
                itemId: 1055,
              },
              {
                type: 'SKILL_LEVEL_UP',
                timestamp: 90_000,
                participantId: 1,
                skillSlot: 1,
                levelUpType: 'NORMAL',
              },
              {
                type: 'SKILL_LEVEL_UP',
                timestamp: 150_000,
                participantId: 1,
                skillSlot: 3,
                levelUpType: 'NORMAL',
              },
              {
                type: 'SKILL_LEVEL_UP',
                timestamp: 210_000,
                participantId: 1,
                skillSlot: 2,
                levelUpType: 'NORMAL',
              },
              {
                type: 'CHAMPION_KILL',
                timestamp: 120_000,
                killerId: 2,
                victimId: 1,
                assistingParticipantIds: [],
                position: { x: 50, y: 60 },
              },
              {
                type: 'CHAMPION_KILL',
                timestamp: 700_000,
                killerId: 6,
                victimId: 1,
                assistingParticipantIds: [7],
                position: { x: 100, y: 200 },
              },
              {
                type: 'ITEM_SOLD',
                timestamp: 800_000,
                participantId: 1,
                itemId: 1055,
              },
              {
                type: 'ELITE_MONSTER_KILL',
                timestamp: 360_000,
                killerId: 2,
                monsterType: 'DRAGON',
                monsterSubType: 'FIRE_DRAGON',
                position: { x: 9800, y: 4400 },
                killerTeamId: 100,
              } as RiotMatchTimelineDto['info']['frames'][number]['events'][number],
              {
                type: 'BUILDING_KILL',
                timestamp: 480_000,
                killerId: 1,
                buildingType: 'TOWER_BUILDING',
                towerType: 'OUTER_TURRET',
                laneType: 'TOP_LANE',
                teamId: 200,
                position: { x: 1000, y: 14000 },
              },
            ]
          : [],
    };
  };

  const frames = [frameAt(0), frameAt(10)];
  if (!overrides.omitFrame15) {
    frames.push(frameAt(15));
  }

  return {
    metadata: {
      dataVersion: '2',
      matchId,
      participants: Array.from({ length: 10 }, (_, index) => buildPuuid(index)),
    },
    info: {
      frameInterval: 60_000,
      frames,
    },
  };
}
