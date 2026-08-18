import { describe, expect, it, vi } from 'vitest';
import { MatchIngestionStatus, TimelineFetchStatus, TimelineProductCoverage } from '@prisma/client';
import { ResourceNotFoundError } from '@league-helper/shared';
import type { MatchDetailRow } from '../../persistence/match.repository';
import { MatchDetailService } from './match-detail.service';
import * as staticLoader from './match-detail-static';

const MATCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function participant(overrides: Partial<MatchDetailRow['participants'][number]> = {}): MatchDetailRow['participants'][number] {
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
      participant({ participantId: 6, teamId: 200, win: false, championId: 64, riotIdGameName: 'Bob' }),
    ],
    timeline: {
      fetchStatus: TimelineFetchStatus.SKIPPED,
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
  const service = new MatchDetailService(
    matches as never,
    prisma as never,
    staticRepo as never,
    dataDragon as never,
  );
  return { service, matches, dataDragon, prisma };
}

describe('MatchDetailService', () => {
  it('throws ResourceNotFoundError when the match is missing', async () => {
    const { service, matches } = createService();
    matches.findDetailById.mockResolvedValue(null);
    await expect(service.getMatch(MATCH_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('maps a found match and loads unique champion ids including bans', async () => {
    const { service, matches, dataDragon } = createService();
    matches.findDetailById.mockResolvedValue(detailRow());
    vi.spyOn(staticLoader, 'loadMatchStaticLookups').mockResolvedValue({
      dataDragonVersion: '14.11.1',
      items: new Map(),
      runes: new Map(),
      spells: new Map(),
      styleNames: new Map(),
    });

    const result = await service.getMatch(MATCH_ID);

    expect(result.match.id).toBe(MATCH_ID);
    expect(result.teams).toHaveLength(2);
    expect(result.timeline).toEqual({
      status: 'UNAVAILABLE',
      metricsAvailable: false,
      productCoverage: 'NONE',
      productAvailable: false,
    });
    expect(result.timeline).not.toHaveProperty('coverage');
    const requested = dataDragon.getChampionByNumericId.mock.calls.map((call) => call[0]).sort((a, b) => a - b);
    expect(requested).toEqual([23, 64, 103]);
  });

  it('does not query timeline events or frames for overview', async () => {
    const { service, matches, prisma } = createService();
    matches.findDetailById.mockResolvedValue(detailRow());
    vi.spyOn(staticLoader, 'loadMatchStaticLookups').mockResolvedValue({
      dataDragonVersion: '14.11.1',
      items: new Map(),
      runes: new Map(),
      spells: new Map(),
      styleNames: new Map(),
    });

    await service.getMatch(MATCH_ID);

    expect(matches.findTimelineEventsByMatchId).not.toHaveBeenCalled();
    expect(matches.findTimelineFramesByMatchId).not.toHaveBeenCalled();
    expect(matches.findTimelineMetaByMatchId).not.toHaveBeenCalled();
    expect(prisma.matchTimelineEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.matchTimelineEvent.groupBy).not.toHaveBeenCalled();
    expect(prisma.matchTimelineFrame.findMany).not.toHaveBeenCalled();
    expect(prisma.matchTimelineFrame.findFirst).not.toHaveBeenCalled();
  });
});
