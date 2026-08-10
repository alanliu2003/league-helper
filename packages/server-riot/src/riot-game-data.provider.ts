import {
  type ChampionMastery,
  type GameDataProvider,
  type PlayerAccount,
  type PlatformRoute,
  type RankDivision,
  type RankedEntry,
  type RegionalRoute,
  RankDivisionSchema,
  RankTierSchema,
  QueueTypeSchema,
  ValidationFailureError,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
  parseRegionalRoute,
  parseRiotId,
} from '@league-helper/shared';
import { RiotApiClient } from './riot-api.client';
import {
  RiotAccountDtoSchema,
  RiotChampionMasteryDtoArraySchema,
  RiotLeagueEntryDtoArraySchema,
  RiotLeagueListDtoSchema,
  RiotMatchDtoSchema,
  RiotMatchIdListSchema,
  RiotMatchTimelineDtoSchema,
  RiotSummonerDtoSchema,
  type RiotAccountDto,
  type RiotChampionMasteryDto,
  type RiotLeagueEntryDto,
  type RiotLeagueListDto,
  type RiotMatchDto,
  type RiotMatchTimelineDto,
  type RiotSummonerDto,
} from './riot-api.schemas';
import {
  RiotPaginatedLeagueTierSchema,
  buildApexLeaguePath,
  buildLeagueEntriesByTierDivisionPath,
  mapLeagueEntriesToLadderCandidates,
  mapLeagueListToLadderCandidates,
  parseRiotLeagueQueueType,
  type LadderCandidatesResult,
  type LadderEntriesPageResult,
  type RiotLeagueQueueType,
  type RiotPaginatedLeagueTier,
} from './riot-league-ladder';

const MATCH_IDS_MAX_COUNT = 100;
const MATCH_IDS_DEFAULT_COUNT = 20;

export class RiotGameDataProvider implements GameDataProvider {
  constructor(private readonly client: RiotApiClient) {}

  async resolvePlayer(input: {
    gameName: string;
    tagLine: string;
    platform: PlatformRoute;
  }): Promise<PlayerAccount> {
    const riotId = parseRiotId({ gameName: input.gameName, tagLine: input.tagLine });
    const platform = parsePlatformRoute(input.platform);
    const regionalRoute = getRegionalRouteForPlatform(platform);

    const accountResult = await this.client.requestJson<RiotAccountDto>(
      {
        category: 'account-v1',
        route: { kind: 'regional', regionalRoute },
        path: `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId.gameName)}/${encodeURIComponent(riotId.tagLine)}`,
        resourceHint: 'account',
      },
      RiotAccountDtoSchema,
    );

    const account = accountResult.data;
    const summonerResult = await this.client.requestJson<RiotSummonerDto>(
      {
        category: 'summoner-v4',
        route: { kind: 'platform', platform },
        path: `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`,
        resourceHint: 'summoner',
      },
      RiotSummonerDtoSchema,
    );

    const summoner = summonerResult.data;
    const canonicalGameName = account.gameName ?? riotId.gameName;
    const canonicalTagLine = account.tagLine ?? riotId.tagLine;

    return {
      provider: 'RIOT',
      externalAccountId: account.puuid,
      riotId: parseRiotId({ gameName: canonicalGameName, tagLine: canonicalTagLine }),
      platform,
      regionalRoute,
      summonerId: summoner.id ?? null,
      accountId: summoner.accountId ?? null,
      profileIconId: summoner.profileIconId ?? null,
      summonerLevel: summoner.summonerLevel ?? null,
    };
  }

  /**
   * Account-v1 by PUUID — resolves Riot ID for ladder enrollment without summoner-v4.
   * Not part of GameDataProvider (collector ladder enrollment only).
   */
  async getAccountByPuuid(input: {
    puuid: string;
    platform: PlatformRoute;
  }): Promise<PlayerAccount> {
    const puuid = input.puuid.trim();
    if (!puuid) {
      throw new ValidationFailureError('puuid is required.');
    }

    const platform = parsePlatformRoute(input.platform);
    const regionalRoute = getRegionalRouteForPlatform(platform);

    const accountResult = await this.client.requestJson<RiotAccountDto>(
      {
        category: 'account-v1',
        route: { kind: 'regional', regionalRoute },
        path: `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
        resourceHint: 'account',
      },
      RiotAccountDtoSchema,
    );

    const account = accountResult.data;
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
      regionalRoute,
      summonerId: null,
      accountId: null,
      profileIconId: null,
      summonerLevel: null,
    };
  }

  async getRankedEntries(player: PlayerAccount): Promise<RankedEntry[]> {
    const platform = parsePlatformRoute(player.platform);
    const result = await this.client.requestJson<RiotLeagueEntryDto[]>(
      {
        category: 'league-v4',
        route: { kind: 'platform', platform },
        // Current documented path uses PUUID; summoner IDs were removed from many payloads in 2025.
        path: `/lol/league/v4/entries/by-puuid/${encodeURIComponent(player.externalAccountId)}`,
        resourceHint: 'ranked',
      },
      RiotLeagueEntryDtoArraySchema,
    );

    return result.data
      .map((entry) => mapLeagueEntry(entry, player))
      .filter((entry): entry is RankedEntry => entry !== null);
  }

  async getRecentMatchIds(
    player: PlayerAccount,
    options: { queue?: number; start?: number; count?: number },
  ): Promise<string[]> {
    const regionalRoute = parseRegionalRoute(player.regionalRoute);
    const start = options.start ?? 0;
    const count = options.count ?? MATCH_IDS_DEFAULT_COUNT;

    if (!Number.isInteger(start) || start < 0) {
      throw new ValidationFailureError('Match ID start must be a non-negative integer.', {
        start: options.start,
      });
    }

    if (!Number.isInteger(count) || count < 1 || count > MATCH_IDS_MAX_COUNT) {
      throw new ValidationFailureError(
        `Match ID count must be an integer between 1 and ${MATCH_IDS_MAX_COUNT}.`,
        { count: options.count },
      );
    }

    if (options.queue !== undefined) {
      if (!Number.isInteger(options.queue) || options.queue < 0) {
        throw new ValidationFailureError('Match queue filter must be a non-negative integer.', {
          queue: options.queue,
        });
      }
    }

    const result = await this.client.requestJson<string[]>(
      {
        category: 'match-v5',
        route: { kind: 'regional', regionalRoute },
        path: `/lol/match/v5/matches/by-puuid/${encodeURIComponent(player.externalAccountId)}/ids`,
        query: {
          start,
          count,
          queue: options.queue,
        },
        resourceHint: 'match-ids',
      },
      RiotMatchIdListSchema,
    );

    // Preserve Riot order; do not dedupe.
    return result.data;
  }

  async getMatch(matchId: string, regionalRoute: RegionalRoute): Promise<unknown> {
    const region = parseRegionalRoute(regionalRoute);
    if (!matchId.trim()) {
      throw new ValidationFailureError('matchId is required.');
    }

    const result = await this.client.requestJson<RiotMatchDto>(
      {
        category: 'match-v5',
        route: { kind: 'regional', regionalRoute: region },
        path: `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
        resourceHint: 'match',
      },
      RiotMatchDtoSchema,
    );

    return result.data;
  }

  async getTimeline(matchId: string, regionalRoute: RegionalRoute): Promise<unknown> {
    const region = parseRegionalRoute(regionalRoute);
    if (!matchId.trim()) {
      throw new ValidationFailureError('matchId is required.');
    }

    const result = await this.client.requestJson<RiotMatchTimelineDto>(
      {
        category: 'match-v5',
        route: { kind: 'regional', regionalRoute: region },
        path: `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`,
        resourceHint: 'timeline',
      },
      RiotMatchTimelineDtoSchema,
    );

    return result.data;
  }

  async getChampionMastery(player: PlayerAccount): Promise<ChampionMastery[]> {
    const platform = parsePlatformRoute(player.platform);
    const result = await this.client.requestJson<RiotChampionMasteryDto[]>(
      {
        category: 'champion-mastery-v4',
        route: { kind: 'platform', platform },
        path: `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(player.externalAccountId)}`,
        resourceHint: 'mastery',
      },
      RiotChampionMasteryDtoArraySchema,
    );

    return result.data.map((entry) => mapChampionMastery(entry, player));
  }

  /**
   * Apex ladder list — Challenger. One bounded Riot request; no page iteration.
   * Not part of GameDataProvider (collector ladder acquisition only).
   */
  async getChallengerLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult> {
    return this.fetchApexLeague('challenger', input);
  }

  /** Apex ladder list — Grandmaster. One bounded Riot request; no page iteration. */
  async getGrandmasterLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult> {
    return this.fetchApexLeague('grandmaster', input);
  }

  /** Apex ladder list — Master. One bounded Riot request; no page iteration. */
  async getMasterLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult> {
    return this.fetchApexLeague('master', input);
  }

  /**
   * One page of paginated league entries for a tier/division.
   * Phase 2 decides how many pages to request; this method never loops.
   */
  async getLeagueEntriesByTierDivision(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
    tier: RiotPaginatedLeagueTier | string;
    division: RankDivision | string;
    page: number;
  }): Promise<LadderEntriesPageResult> {
    const platform = parsePlatformRoute(input.platform);
    const leagueQueueType = parseRiotLeagueQueueType(input.leagueQueueType);
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

    const result = await this.client.requestJson<RiotLeagueEntryDto[]>(
      {
        category: 'league-v4',
        route: { kind: 'platform', platform },
        path: buildLeagueEntriesByTierDivisionPath({
          queue: leagueQueueType,
          tier: tierParsed.data,
          division: divisionParsed.data,
        }),
        query: { page: input.page },
        resourceHint: 'ranked',
      },
      RiotLeagueEntryDtoArraySchema,
    );

    const mapped = mapLeagueEntriesToLadderCandidates({
      entries: result.data,
      platformRoute: platform,
      acquisitionMode: 'REPRESENTATIVE',
      page: input.page,
    });

    return {
      ...mapped,
      page: input.page,
      pageExhausted: result.data.length === 0,
    };
  }

  private async fetchApexLeague(
    kind: 'challenger' | 'grandmaster' | 'master',
    input: { platform: PlatformRoute; leagueQueueType: RiotLeagueQueueType | string },
  ): Promise<LadderCandidatesResult> {
    const platform = parsePlatformRoute(input.platform);
    const leagueQueueType = parseRiotLeagueQueueType(input.leagueQueueType);

    const result = await this.client.requestJson<RiotLeagueListDto>(
      {
        category: 'league-v4',
        route: { kind: 'platform', platform },
        path: buildApexLeaguePath(kind, leagueQueueType),
        resourceHint: 'ranked',
      },
      RiotLeagueListDtoSchema,
    );

    return mapLeagueListToLadderCandidates({
      list: result.data,
      platformRoute: platform,
      acquisitionMode: 'APEX',
    });
  }
}

function mapLeagueEntry(entry: RiotLeagueEntryDto, player: PlayerAccount): RankedEntry | null {
  const queueParsed = QueueTypeSchema.safeParse(entry.queueType);
  const queueType = queueParsed.success ? queueParsed.data : 'UNKNOWN';

  const tierParsed = RankTierSchema.safeParse(entry.tier?.toUpperCase());
  if (!tierParsed.success) {
    // Do not invent ranked tiers when Riot omits/returns unexpected values.
    return null;
  }

  const tier = tierParsed.data;
  const divisionParsed = RankDivisionSchema.safeParse(entry.rank);
  const isApex = tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER';

  return {
    provider: 'RIOT',
    externalAccountId: player.externalAccountId,
    platform: player.platform,
    queueType,
    tier,
    division: isApex ? null : divisionParsed.success ? divisionParsed.data : null,
    leaguePoints: entry.leaguePoints ?? 0,
    wins: entry.wins ?? 0,
    losses: entry.losses ?? 0,
    veteran: entry.veteran,
    inactive: entry.inactive,
    freshBlood: entry.freshBlood,
    hotStreak: entry.hotStreak,
  };
}

function mapChampionMastery(entry: RiotChampionMasteryDto, player: PlayerAccount): ChampionMastery {
  return {
    provider: 'RIOT',
    externalAccountId: player.externalAccountId,
    platform: player.platform,
    championId: entry.championId,
    championLevel: entry.championLevel,
    championPoints: entry.championPoints,
    lastPlayTime:
      entry.lastPlayTime !== undefined ? new Date(entry.lastPlayTime).toISOString() : undefined,
    chestGranted: entry.chestGranted,
    tokensEarned: entry.tokensEarned,
  };
}
