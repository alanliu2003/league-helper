import { z } from 'zod';

/** Account-v1 AccountDto */
export const RiotAccountDtoSchema = z.object({
  puuid: z.string().min(1),
  gameName: z.string().min(1).optional(),
  tagLine: z.string().min(1).optional(),
});

export type RiotAccountDto = z.infer<typeof RiotAccountDtoSchema>;

/** Summoner-v4 SummonerDto — id/accountId may be omitted after Riot's 2025 identity changes. */
export const RiotSummonerDtoSchema = z.object({
  id: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  puuid: z.string().min(1),
  profileIconId: z.number().int().optional(),
  revisionDate: z.number().optional(),
  summonerLevel: z.number().int().nonnegative().optional(),
  name: z.string().optional(),
});

export type RiotSummonerDto = z.infer<typeof RiotSummonerDtoSchema>;

export const RiotMiniSeriesDtoSchema = z.object({
  target: z.number().int().optional(),
  wins: z.number().int().optional(),
  losses: z.number().int().optional(),
  progress: z.string().optional(),
});

export type RiotMiniSeriesDto = z.infer<typeof RiotMiniSeriesDtoSchema>;

/** League-v4 LeagueEntryDto */
/**
 * League-v4 LeagueEntryDTO.
 * Official current identity field is `puuid` (Player's encrypted puuid).
 * summonerId / summonerName / riotId* are not present on the current documented DTO;
 * optional summonerId retained for transitional payloads only.
 */
export const RiotLeagueEntryDtoSchema = z.object({
  leagueId: z.string().optional(),
  queueType: z.string().min(1),
  tier: z.string().optional(),
  rank: z.string().optional(),
  summonerId: z.string().optional(),
  puuid: z.string().optional(),
  leaguePoints: z.number().int().optional(),
  wins: z.number().int().nonnegative().optional(),
  losses: z.number().int().nonnegative().optional(),
  hotStreak: z.boolean().optional(),
  veteran: z.boolean().optional(),
  freshBlood: z.boolean().optional(),
  inactive: z.boolean().optional(),
  miniSeries: RiotMiniSeriesDtoSchema.optional(),
});

export type RiotLeagueEntryDto = z.infer<typeof RiotLeagueEntryDtoSchema>;

export const RiotLeagueEntryDtoArraySchema = z.array(RiotLeagueEntryDtoSchema);

/**
 * League-v4 LeagueItemDTO (entries inside apex LeagueListDTO).
 * Official current identity field is `puuid`. No riotIdGameName / riotIdTagLine / summonerId
 * on the current developer.riotgames.com league-v4 contract.
 */
export const RiotLeagueItemDtoSchema = z.object({
  puuid: z.string().optional(),
  rank: z.string().optional(),
  leaguePoints: z.number().int().optional(),
  wins: z.number().int().nonnegative().optional(),
  losses: z.number().int().nonnegative().optional(),
  hotStreak: z.boolean().optional(),
  veteran: z.boolean().optional(),
  freshBlood: z.boolean().optional(),
  inactive: z.boolean().optional(),
  miniSeries: RiotMiniSeriesDtoSchema.optional(),
});

export type RiotLeagueItemDto = z.infer<typeof RiotLeagueItemDtoSchema>;

/** League-v4 LeagueListDTO (challenger / grandmaster / master by-queue responses). */
export const RiotLeagueListDtoSchema = z.object({
  leagueId: z.string().optional(),
  entries: z.array(RiotLeagueItemDtoSchema),
  tier: z.string().min(1),
  name: z.string().optional(),
  queue: z.string().min(1),
});

export type RiotLeagueListDto = z.infer<typeof RiotLeagueListDtoSchema>;

export const RiotMatchIdListSchema = z.array(z.string().min(1));

export const RiotMatchMetadataDtoSchema = z.object({
  dataVersion: z.string().optional(),
  matchId: z.string().min(1),
  participants: z.array(z.string()).default([]),
});

export type RiotMatchMetadataDto = z.infer<typeof RiotMatchMetadataDtoSchema>;

const RiotPerkStyleSelectionSchema = z
  .object({
    perk: z.number().int().optional(),
    var1: z.number().int().optional(),
    var2: z.number().int().optional(),
    var3: z.number().int().optional(),
  })
  .passthrough();

const RiotPerkStyleSchema = z
  .object({
    description: z.string().optional(),
    selections: z.array(RiotPerkStyleSelectionSchema).optional(),
    style: z.number().int().optional(),
  })
  .passthrough();

const RiotPerksSchema = z
  .object({
    statPerks: z
      .object({
        defense: z.number().int().optional(),
        flex: z.number().int().optional(),
        offense: z.number().int().optional(),
      })
      .passthrough()
      .optional(),
    styles: z.array(RiotPerkStyleSchema).optional(),
  })
  .passthrough();

export const RiotMatchParticipantDtoSchema = z
  .object({
    puuid: z.string().optional(),
    summonerId: z.string().optional(),
    riotIdGameName: z.string().optional(),
    riotIdTagline: z.string().optional(),
    summonerName: z.string().optional(),
    championId: z.number().int().optional(),
    championName: z.string().optional(),
    teamId: z.number().int().optional(),
    teamPosition: z.string().optional(),
    individualPosition: z.string().optional(),
    win: z.boolean().optional(),
    kills: z.number().int().optional(),
    deaths: z.number().int().optional(),
    assists: z.number().int().optional(),
    totalMinionsKilled: z.number().int().optional(),
    neutralMinionsKilled: z.number().int().optional(),
    goldEarned: z.number().int().optional(),
    champLevel: z.number().int().optional(),
    item0: z.number().int().optional(),
    item1: z.number().int().optional(),
    item2: z.number().int().optional(),
    item3: z.number().int().optional(),
    item4: z.number().int().optional(),
    item5: z.number().int().optional(),
    item6: z.number().int().optional(),
    summoner1Id: z.number().int().optional(),
    summoner2Id: z.number().int().optional(),
    perks: RiotPerksSchema.optional(),
  })
  .passthrough();

export type RiotMatchParticipantDto = z.infer<typeof RiotMatchParticipantDtoSchema>;

export const RiotMatchObjectiveDtoSchema = z
  .object({
    first: z.boolean().optional(),
    kills: z.number().int().optional(),
  })
  .passthrough();

export type RiotMatchObjectiveDto = z.infer<typeof RiotMatchObjectiveDtoSchema>;

export const RiotMatchTeamDtoSchema = z
  .object({
    teamId: z.number().int().optional(),
    win: z.boolean().optional(),
    bans: z
      .array(
        z
          .object({
            championId: z.number().int().optional(),
            pickTurn: z.number().int().optional(),
          })
          .passthrough(),
      )
      .optional(),
    objectives: z
      .object({
        baron: RiotMatchObjectiveDtoSchema.optional(),
        champion: RiotMatchObjectiveDtoSchema.optional(),
        dragon: RiotMatchObjectiveDtoSchema.optional(),
        inhibitor: RiotMatchObjectiveDtoSchema.optional(),
        riftHerald: RiotMatchObjectiveDtoSchema.optional(),
        tower: RiotMatchObjectiveDtoSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RiotMatchTeamDto = z.infer<typeof RiotMatchTeamDtoSchema>;

export const RiotMatchInfoDtoSchema = z
  .object({
    gameCreation: z.number(),
    gameDuration: z.number().int(),
    gameEndTimestamp: z.number().optional(),
    gameId: z.number().optional(),
    gameMode: z.string().optional(),
    gameName: z.string().optional(),
    gameStartTimestamp: z.number().optional(),
    gameType: z.string().optional(),
    gameVersion: z.string().min(1),
    mapId: z.number().int(),
    participants: z.array(RiotMatchParticipantDtoSchema).default([]),
    platformId: z.string().optional(),
    queueId: z.number().int(),
    teams: z.array(RiotMatchTeamDtoSchema).default([]),
    tournamentCode: z.string().optional(),
  })
  .passthrough();

export type RiotMatchInfoDto = z.infer<typeof RiotMatchInfoDtoSchema>;

export const RiotMatchDtoSchema = z.object({
  metadata: RiotMatchMetadataDtoSchema,
  info: RiotMatchInfoDtoSchema,
});

export type RiotMatchDto = z.infer<typeof RiotMatchDtoSchema>;

export const RiotParticipantFrameDtoSchema = z
  .object({
    participantId: z.number().int().optional(),
    level: z.number().int().optional(),
    xp: z.number().int().optional(),
    totalGold: z.number().int().optional(),
    currentGold: z.number().int().optional(),
    minionsKilled: z.number().int().optional(),
    jungleMinionsKilled: z.number().int().optional(),
    position: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RiotParticipantFrameDto = z.infer<typeof RiotParticipantFrameDtoSchema>;

/**
 * Timeline events: keep known categories documented, allow unknown types via passthrough
 * so new Riot event types do not reject an otherwise valid timeline.
 */
export const RiotTimelineEventDtoSchema = z
  .object({
    type: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    participantId: z.number().int().optional(),
    killerId: z.number().int().optional(),
    victimId: z.number().int().optional(),
    assistingParticipantIds: z.array(z.number().int()).optional(),
    itemId: z.number().int().optional(),
    /// ITEM_UNDO (and some transforms) supply before/after item ids.
    beforeId: z.number().int().optional(),
    afterId: z.number().int().optional(),
    skillSlot: z.number().int().optional(),
    levelUpType: z.string().optional(),
    wardType: z.string().optional(),
    creatorId: z.number().int().optional(),
    monsterType: z.string().optional(),
    monsterSubType: z.string().optional(),
    buildingType: z.string().optional(),
    towerType: z.string().optional(),
    laneType: z.string().optional(),
    teamId: z.number().int().optional(),
    position: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RiotTimelineEventDto = z.infer<typeof RiotTimelineEventDtoSchema>;

export const RiotTimelineFrameDtoSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    participantFrames: z.record(z.string(), RiotParticipantFrameDtoSchema).default({}),
    events: z.array(RiotTimelineEventDtoSchema).default([]),
  })
  .passthrough();

export type RiotTimelineFrameDto = z.infer<typeof RiotTimelineFrameDtoSchema>;

export const RiotMatchTimelineDtoSchema = z.object({
  metadata: z.object({
    dataVersion: z.string().optional(),
    matchId: z.string().min(1),
    participants: z.array(z.string()).default([]),
  }),
  info: z
    .object({
      frameInterval: z.number().int().positive(),
      frames: z.array(RiotTimelineFrameDtoSchema).default([]),
      gameId: z.number().optional(),
      participants: z
        .array(
          z
            .object({
              participantId: z.number().int().optional(),
              puuid: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
});

export type RiotMatchTimelineDto = z.infer<typeof RiotMatchTimelineDtoSchema>;

export const RiotChampionMasteryDtoSchema = z
  .object({
    puuid: z.string().optional(),
    championId: z.number().int(),
    championLevel: z.number().int().nonnegative(),
    championPoints: z.number().int().nonnegative(),
    lastPlayTime: z.number().optional(),
    championPointsSinceLastLevel: z.number().int().optional(),
    championPointsUntilNextLevel: z.number().int().optional(),
    chestGranted: z.boolean().optional(),
    tokensEarned: z.number().int().nonnegative().optional(),
    summonerId: z.string().optional(),
  })
  .passthrough();

export type RiotChampionMasteryDto = z.infer<typeof RiotChampionMasteryDtoSchema>;

export const RiotChampionMasteryDtoArraySchema = z.array(RiotChampionMasteryDtoSchema);

/** Best-effort Riot status body — never trusted for control flow. */
export const RiotStatusErrorBodySchema = z
  .object({
    status: z
      .object({
        message: z.string().optional(),
        status_code: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
