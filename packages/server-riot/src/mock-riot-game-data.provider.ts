import {
  type ChampionMastery,
  type GameDataProvider,
  type PlayerAccount,
  type PlatformRoute,
  type RankDivision,
  type RankedEntry,
  type RegionalRoute,
  RankDivisionSchema,
  ResourceNotFoundError,
  ValidationFailureError,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
  parseRiotId,
} from '@league-helper/shared';
import {
  mockAccountDto,
  mockChallengerLeagueListDto,
  mockChampionMasteryList,
  mockGrandmasterLeagueListDto,
  mockLeagueEntriesPageDto,
  mockMasterLeagueListDto,
  mockMatchDto,
  mockMatchIdList,
  mockRankedEntries,
  mockSummonerDto,
  mockTimelineDto,
} from './fixtures';
import {
  RiotPaginatedLeagueTierSchema,
  mapLeagueEntriesToLadderCandidates,
  mapLeagueListToLadderCandidates,
  parseRiotLeagueQueueType,
  type LadderCandidatesResult,
  type LadderEntriesPageResult,
  type RiotLeagueQueueType,
  type RiotPaginatedLeagueTier,
} from './riot-league-ladder';

/**
 * Deterministic GameDataProvider for local development and automated tests.
 * Requires no network access and no Riot API key.
 */
export class MockRiotGameDataProvider implements GameDataProvider {
  async resolvePlayer(input: {
    gameName: string;
    tagLine: string;
    platform: PlatformRoute;
  }): Promise<PlayerAccount> {
    const riotId = parseRiotId({ gameName: input.gameName, tagLine: input.tagLine });
    const platform = parsePlatformRoute(input.platform);

    if (riotId.gameName.toLowerCase() === 'missingplayer') {
      throw new ResourceNotFoundError('Riot account not found.', { resource: 'account' });
    }

    const account = mockAccountDto({
      gameName: riotId.gameName,
      tagLine: riotId.tagLine,
    });
    const summoner = mockSummonerDto({ puuid: account.puuid });

    return {
      provider: 'RIOT',
      externalAccountId: account.puuid,
      riotId: {
        gameName: account.gameName ?? riotId.gameName,
        tagLine: account.tagLine ?? riotId.tagLine,
      },
      platform,
      regionalRoute: getRegionalRouteForPlatform(platform),
      summonerId: summoner.id ?? null,
      accountId: summoner.accountId ?? null,
      profileIconId: summoner.profileIconId ?? null,
      summonerLevel: summoner.summonerLevel ?? null,
    };
  }

  async getAccountByPuuid(input: {
    puuid: string;
    platform: PlatformRoute;
  }): Promise<PlayerAccount> {
    const puuid = input.puuid.trim();
    if (!puuid) {
      throw new ValidationFailureError('puuid is required.');
    }

    const platform = parsePlatformRoute(input.platform);
    const account = mockAccountDto({ puuid });

    if (!account.gameName || !account.tagLine) {
      throw new ValidationFailureError(
        'Account-v1 response is missing gameName or tagLine required for enrollment.',
        {
          hasGameName: Boolean(account.gameName),
          hasTagLine: Boolean(account.tagLine),
        },
      );
    }

    return {
      provider: 'RIOT',
      externalAccountId: account.puuid,
      riotId: parseRiotId({ gameName: account.gameName, tagLine: account.tagLine }),
      platform,
      regionalRoute: getRegionalRouteForPlatform(platform),
      summonerId: null,
      accountId: null,
      profileIconId: null,
      summonerLevel: null,
    };
  }

  async getRankedEntries(player: PlayerAccount): Promise<RankedEntry[]> {
    if (player.riotId.gameName.toLowerCase() === 'unranked') {
      return [];
    }

    return mockRankedEntries(player);
  }

  async getRecentMatchIds(
    player: PlayerAccount,
    options: { queue?: number; start?: number; count?: number },
  ): Promise<string[]> {
    const start = options.start ?? 0;
    const count = options.count ?? 20;
    if (!Number.isInteger(start) || start < 0) {
      throw new ValidationFailureError('Match ID start must be a non-negative integer.');
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new ValidationFailureError('Match ID count must be an integer between 1 and 100.');
    }

    return mockMatchIdList().slice(start, start + count);
  }

  async getMatch(matchId: string, _regionalRoute: RegionalRoute): Promise<unknown> {
    if (matchId === 'FAKE_MISSING') {
      throw new ResourceNotFoundError('Match not found.', { resource: 'match' });
    }
    return mockMatchDto({ matchId });
  }

  async getTimeline(matchId: string, _regionalRoute: RegionalRoute): Promise<unknown> {
    if (matchId === 'FAKE_MISSING') {
      throw new ResourceNotFoundError('Match timeline not found.', { resource: 'timeline' });
    }
    return mockTimelineDto({ matchId });
  }

  async getChampionMastery(player: PlayerAccount): Promise<ChampionMastery[]> {
    return mockChampionMasteryList(player);
  }

  async getChallengerLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult> {
    parseRiotLeagueQueueType(input.leagueQueueType);
    return mapLeagueListToLadderCandidates({
      list: mockChallengerLeagueListDto(),
      platformRoute: parsePlatformRoute(input.platform),
      acquisitionMode: 'APEX',
    });
  }

  async getGrandmasterLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult> {
    parseRiotLeagueQueueType(input.leagueQueueType);
    return mapLeagueListToLadderCandidates({
      list: mockGrandmasterLeagueListDto(),
      platformRoute: parsePlatformRoute(input.platform),
      acquisitionMode: 'APEX',
    });
  }

  async getMasterLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult> {
    parseRiotLeagueQueueType(input.leagueQueueType);
    return mapLeagueListToLadderCandidates({
      list: mockMasterLeagueListDto(),
      platformRoute: parsePlatformRoute(input.platform),
      acquisitionMode: 'APEX',
    });
  }

  async getLeagueEntriesByTierDivision(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
    tier: RiotPaginatedLeagueTier | string;
    division: RankDivision | string;
    page: number;
  }): Promise<LadderEntriesPageResult> {
    parseRiotLeagueQueueType(input.leagueQueueType);
    const tierParsed = RiotPaginatedLeagueTierSchema.safeParse(input.tier);
    if (!tierParsed.success) {
      throw new ValidationFailureError(
        'Paginated league entries require a documented non-apex tier (DIAMOND–IRON).',
        { tier: input.tier },
      );
    }
    const divisionParsed = RankDivisionSchema.safeParse(input.division);
    if (!divisionParsed.success) {
      throw new ValidationFailureError('Invalid league division.', { division: input.division });
    }
    if (!Number.isInteger(input.page) || input.page < 1) {
      throw new ValidationFailureError('League entries page must be an integer >= 1.', {
        page: input.page,
      });
    }

    // Deterministic: only page 1 has candidates; higher pages are exhausted.
    if (input.page > 1) {
      return {
        candidates: [],
        skippedIncompleteIdentity: 0,
        page: input.page,
        pageExhausted: true,
      };
    }

    const mapped = mapLeagueEntriesToLadderCandidates({
      entries: mockLeagueEntriesPageDto({
        tier: tierParsed.data,
        rank: divisionParsed.data,
      }),
      platformRoute: parsePlatformRoute(input.platform),
      acquisitionMode: 'REPRESENTATIVE',
      page: input.page,
    });

    return {
      ...mapped,
      page: input.page,
      pageExhausted: false,
    };
  }
}
