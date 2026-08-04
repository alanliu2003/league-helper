import { Injectable } from '@nestjs/common';
import {
  type ChampionMastery,
  type GameDataProvider,
  type PlayerAccount,
  type PlatformRoute,
  type RankedEntry,
  type RegionalRoute,
  ResourceNotFoundError,
  ValidationFailureError,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
  parseRiotId,
} from '@league-helper/shared';
import {
  mockAccountDto,
  mockChampionMasteryList,
  mockMatchDto,
  mockMatchIdList,
  mockRankedEntries,
  mockSummonerDto,
  mockTimelineDto,
} from './fixtures';

/**
 * Deterministic GameDataProvider for local development and automated tests.
 * Requires no network access and no Riot API key.
 */
@Injectable()
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
}
