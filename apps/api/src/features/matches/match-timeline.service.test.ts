import { describe, expect, it, vi } from 'vitest';
import { MatchIngestionStatus, TimelineFetchStatus, TimelineProductCoverage } from '@prisma/client';
import { PublicMatchTimelineDetailSchema, ResourceNotFoundError } from '@league-helper/shared';
import type { MatchDetailRow } from '../../persistence/match.repository';
import { MatchTimelineService } from './match-timeline.service';
import * as staticLoader from './match-detail-static';

const MATCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UNKNOWN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function participant(
  overrides: Partial<MatchDetailRow['participants'][number]> = {},
): MatchDetailRow['participants'][number] {
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
    itemIds: [0, 0, 0, 0, 0, 0, 0],
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
  return {
    id: MATCH_ID,
    provider: 'RIOT',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    gameCreation: new Date('2026-08-01T00:00:00.000Z'),
    gameEndTimestamp: null,
    gameDurationSeconds: 1800,
    gameVersion: '14.11.1.123',
    normalizedPatch: '14.11',
    remake: false,
    earlySurrender: false,
    ingestionStatus: MatchIngestionStatus.COMPLETED,
    teams: [
      { teamId: 100, win: true, bans: [103], objectives: null },
      { teamId: 200, win: false, bans: [], objectives: null },
    ],
    participants: [
      participant(),
      participant({
        participantId: 6,
        teamId: 200,
        win: false,
        championId: 64,
        riotIdGameName: 'Bob',
      }),
    ],
    timeline: {
      fetchStatus: TimelineFetchStatus.FETCHED,
      productCoverage: TimelineProductCoverage.NONE,
    },
    ...overrides,
  };
}

function createService() {
  const matches = {
    findDetailById: vi.fn(),
    findTimelineEventsByMatchId: vi.fn(),
    findTimelineFramesByMatchId: vi.fn(),
    findTimelineMetaByMatchId: vi.fn(),
  };
  const prisma = {
    matchTimelineEvent: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    matchTimelineFrame: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const staticRepo = {};
  const dataDragon = {
    getChampionByNumericId: vi.fn(async () => null),
    buildItemIconUrl: vi.fn(() => null),
    buildRuneIconUrl: vi.fn(() => null),
    buildSummonerSpellIconUrl: vi.fn(() => null),
  };
  const enqueue = vi.fn();
  const service = new MatchTimelineService(
    matches as never,
    prisma as never,
    staticRepo as never,
    dataDragon as never,
  );
  return { service, matches, dataDragon, prisma, enqueue };
}

describe('MatchTimelineService', () => {
  it('throws ResourceNotFoundError when the match is missing', async () => {
    const { service, matches } = createService();
    matches.findDetailById.mockResolvedValue(null);
    await expect(service.getTimeline(UNKNOWN_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.getTimeline(UNKNOWN_ID)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Match not found.',
    });
    expect(matches.findTimelineEventsByMatchId).not.toHaveBeenCalled();
    expect(matches.findTimelineFramesByMatchId).not.toHaveBeenCalled();
  });

  it('returns 200 empty coverage for a real match with no product rows', async () => {
    const { service, matches, prisma } = createService();
    matches.findDetailById.mockResolvedValue(detailRow());
    matches.findTimelineEventsByMatchId.mockResolvedValue([]);
    matches.findTimelineFramesByMatchId.mockResolvedValue([]);
    matches.findTimelineMetaByMatchId.mockResolvedValue({ frameIntervalMs: null });
    vi.spyOn(staticLoader, 'loadMatchStaticLookups').mockResolvedValue({
      dataDragonVersion: '14.11.1',
      items: new Map(),
      runes: new Map(),
      spells: new Map(),
      styleNames: new Map(),
    });

    const result = await service.getTimeline(MATCH_ID);
    const parsed = PublicMatchTimelineDetailSchema.parse(result);
    expect(parsed.matchId).toBe(MATCH_ID);
    expect(parsed.coverage).toEqual({
      items: false,
      skills: false,
      kills: false,
      objectives: false,
      frames: false,
    });
    expect(parsed.events).toEqual([]);
    expect(parsed.frames).toEqual([]);
    expect(matches.findTimelineEventsByMatchId).toHaveBeenCalledWith(MATCH_ID);
    expect(matches.findTimelineFramesByMatchId).toHaveBeenCalledWith(MATCH_ID);
    expect(prisma.matchTimelineEvent.groupBy).not.toHaveBeenCalled();
  });

  it('loads events and frames and does not enqueue jobs', async () => {
    const { service, matches, enqueue } = createService();
    matches.findDetailById.mockResolvedValue(detailRow());
    matches.findTimelineEventsByMatchId.mockResolvedValue([
      {
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
      },
    ]);
    matches.findTimelineFramesByMatchId.mockResolvedValue([
      { timestampMs: 0, participantId: 1, totalGold: 500, xp: 0, cs: 0, level: 1 },
      { timestampMs: 0, participantId: 6, totalGold: 400, xp: 0, cs: 0, level: 1 },
    ]);
    matches.findTimelineMetaByMatchId.mockResolvedValue({ frameIntervalMs: 60_000 });
    vi.spyOn(staticLoader, 'loadMatchStaticLookups').mockResolvedValue({
      dataDragonVersion: '14.11.1',
      items: new Map(),
      runes: new Map(),
      spells: new Map(),
      styleNames: new Map(),
    });

    const result = await service.getTimeline(MATCH_ID);
    expect(result.coverage).toEqual({
      items: true,
      skills: false,
      kills: false,
      objectives: false,
      frames: true,
    });
    expect(result.frameIntervalMs).toBe(60_000);
    expect(enqueue).not.toHaveBeenCalled();
    expect(matches.findTimelineEventsByMatchId).toHaveBeenCalledTimes(1);
    expect(matches.findTimelineFramesByMatchId).toHaveBeenCalledTimes(1);
  });
});
