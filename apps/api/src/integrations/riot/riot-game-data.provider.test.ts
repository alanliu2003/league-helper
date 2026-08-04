import { describe, expect, it } from 'vitest';
import { ProviderResponseInvalidError, ValidationFailureError } from '@league-helper/shared';
import { RiotApiClient } from './riot-api.client';
import { RiotGameDataProvider } from './riot-game-data.provider';
import { MockRiotGameDataProvider } from './mock-riot-game-data.provider';
import {
  FAKE_MATCH_IDS,
  FAKE_PUUID,
  mockAccountDto,
  mockChampionMasteryDtoList,
  mockEmptyLeagueEntriesDto,
  mockLeagueEntriesDto,
  mockMatchDto,
  mockMatchIdList,
  mockSummonerDto,
  mockSummonerDtoWithoutIds,
  mockTimelineDto,
} from './fixtures';
import { createMockFetch, realConfigOverrides } from './test-utils/mock-fetch';

describe('RiotGameDataProvider', () => {
  it('resolves Riot ID via account-v1 + summoner-v4 and maps PlayerAccount', async () => {
    const account = mockAccountDto({ gameName: 'CanonicalName', tagLine: 'NA1' });
    const summoner = mockSummonerDto({
      puuid: account.puuid,
      profileIconId: 42,
      summonerLevel: 55,
    });
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: account },
      { status: 200, body: summoner },
    ]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    const player = await provider.resolvePlayer({
      gameName: 'canonicalname',
      tagLine: 'na1',
      platform: 'na1',
    });

    expect(player).toMatchObject({
      provider: 'RIOT',
      externalAccountId: account.puuid,
      riotId: { gameName: 'CanonicalName', tagLine: 'NA1' },
      platform: 'na1',
      regionalRoute: 'americas',
      summonerId: summoner.id,
      accountId: summoner.accountId,
      profileIconId: 42,
      summonerLevel: 55,
    });
    expect(calls[0]?.url).toContain('americas.api.riotgames.com/riot/account/v1/');
    expect(calls[1]?.url).toContain('na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/');
  });

  it('handles summoner payloads that omit id/accountId', async () => {
    const account = mockAccountDto();
    const { fetchFn } = createMockFetch([
      { status: 200, body: account },
      { status: 200, body: mockSummonerDtoWithoutIds({ puuid: account.puuid }) },
    ]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    const player = await provider.resolvePlayer({
      gameName: 'ExamplePlayer',
      tagLine: 'NA1',
      platform: 'na1',
    });
    expect(player.summonerId).toBeNull();
    expect(player.accountId).toBeNull();
  });

  it('maps ranked entries and preserves empty arrays', async () => {
    const player = {
      provider: 'RIOT' as const,
      externalAccountId: FAKE_PUUID,
      riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
      platform: 'na1' as const,
      regionalRoute: 'americas' as const,
    };

    const withEntries = createMockFetch([{ status: 200, body: mockLeagueEntriesDto() }]);
    const ranked = await new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn: withEntries.fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    ).getRankedEntries(player);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      division: 'II',
      leaguePoints: 54,
    });
    expect(withEntries.calls[0]?.url).toContain('/lol/league/v4/entries/by-puuid/');
    expect(withEntries.calls[0]?.url).toContain('na1.api.riotgames.com');

    const empty = createMockFetch([{ status: 200, body: mockEmptyLeagueEntriesDto() }]);
    await expect(
      new RiotGameDataProvider(
        RiotApiClient.create(realConfigOverrides(), {
          fetchFn: empty.fetchFn,
          sleepFn: async () => undefined,
          randomFn: () => 0,
        }),
      ).getRankedEntries(player),
    ).resolves.toEqual([]);
  });

  it('maps unknown future queue values to UNKNOWN', async () => {
    const player = {
      provider: 'RIOT' as const,
      externalAccountId: FAKE_PUUID,
      riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
      platform: 'na1' as const,
      regionalRoute: 'americas' as const,
    };
    const { fetchFn } = createMockFetch([
      {
        status: 200,
        body: [
          {
            queueType: 'RANKED_SOMETHING_NEW',
            tier: 'GOLD',
            rank: 'I',
            leaguePoints: 1,
            wins: 1,
            losses: 1,
          },
        ],
      },
    ]);
    const ranked = await new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    ).getRankedEntries(player);
    expect(ranked[0]?.queueType).toBe('UNKNOWN');
  });

  it('retrieves match IDs with validated pagination and preserved order', async () => {
    const player = {
      provider: 'RIOT' as const,
      externalAccountId: FAKE_PUUID,
      riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
      platform: 'na1' as const,
      regionalRoute: 'americas' as const,
    };
    const ids = mockMatchIdList();
    const { fetchFn, calls } = createMockFetch([{ status: 200, body: ids }]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    await expect(
      provider.getRecentMatchIds(player, { count: 5, start: 0, queue: 420 }),
    ).resolves.toEqual(ids);
    expect(calls[0]?.url).toContain('americas.api.riotgames.com/lol/match/v5/matches/by-puuid/');
    expect(calls[0]?.url).toContain('count=5');
    expect(calls[0]?.url).toContain('queue=420');

    await expect(provider.getRecentMatchIds(player, { count: 101 })).rejects.toBeInstanceOf(
      ValidationFailureError,
    );
    await expect(provider.getRecentMatchIds(player, { start: -1 })).rejects.toBeInstanceOf(
      ValidationFailureError,
    );
  });

  it('validates match and timeline responses', async () => {
    const { fetchFn } = createMockFetch([
      { status: 200, body: mockMatchDto() },
      { status: 200, body: mockTimelineDto() },
      { status: 200, body: { not: 'valid' } },
    ]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    const match = await provider.getMatch(FAKE_MATCH_IDS[0], 'americas');
    expect((match as { metadata: { matchId: string } }).metadata.matchId).toBe(FAKE_MATCH_IDS[0]);

    const timeline = await provider.getTimeline(FAKE_MATCH_IDS[0], 'americas');
    expect((timeline as { metadata: { matchId: string } }).metadata.matchId).toBe(
      FAKE_MATCH_IDS[0],
    );

    await expect(provider.getMatch(FAKE_MATCH_IDS[1], 'americas')).rejects.toBeInstanceOf(
      ProviderResponseInvalidError,
    );
  });

  it('maps champion mastery and uses platform routing', async () => {
    const player = {
      provider: 'RIOT' as const,
      externalAccountId: FAKE_PUUID,
      riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
      platform: 'na1' as const,
      regionalRoute: 'americas' as const,
    };
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: mockChampionMasteryDtoList() },
    ]);
    const mastery = await new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    ).getChampionMastery(player);

    expect(mastery[0]).toMatchObject({
      championId: 157,
      championLevel: 7,
      championPoints: 250_000,
      externalAccountId: FAKE_PUUID,
    });
    expect(calls[0]?.url).toContain(
      'na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/',
    );
  });
});

describe('MockRiotGameDataProvider', () => {
  it('works without a Riot API key or network', async () => {
    const provider = new MockRiotGameDataProvider();
    const player = await provider.resolvePlayer({
      gameName: 'ExamplePlayer',
      tagLine: 'NA1',
      platform: 'euw1',
    });
    expect(player.regionalRoute).toBe('europe');
    expect(await provider.getRankedEntries(player)).toHaveLength(2);
    expect(await provider.getRecentMatchIds(player, { count: 2 })).toEqual([
      FAKE_MATCH_IDS[0],
      FAKE_MATCH_IDS[1],
    ]);
  });
});
