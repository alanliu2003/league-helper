import { Injectable } from '@nestjs/common';
import {
  type ChampionMastery,
  type GameDataProvider,
  type PlayerAccount,
  type PlatformRoute,
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
  RiotMatchDtoSchema,
  RiotMatchIdListSchema,
  RiotMatchTimelineDtoSchema,
  RiotSummonerDtoSchema,
  type RiotAccountDto,
  type RiotChampionMasteryDto,
  type RiotLeagueEntryDto,
  type RiotMatchDto,
  type RiotMatchTimelineDto,
  type RiotSummonerDto,
} from './riot-api.schemas';

const MATCH_IDS_MAX_COUNT = 100;
const MATCH_IDS_DEFAULT_COUNT = 20;

@Injectable()
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
