import { describe, expect, it } from 'vitest';
import {
  ProviderResponseInvalidError,
  ValidationFailureError,
} from '@league-helper/shared';
import { RiotApiClient } from './riot-api.client';
import { RiotGameDataProvider } from './riot-game-data.provider';
import { MockRiotGameDataProvider } from './mock-riot-game-data.provider';
import {
  RiotLeagueEntryDtoArraySchema,
  RiotLeagueListDtoSchema,
} from './riot-api.schemas';
import {
  RIOT_LEAGUE_QUEUE_RANKED_SOLO,
  buildApexLeaguePath,
  buildLeagueEntriesByTierDivisionPath,
  mapLeagueEntriesToLadderCandidates,
  mapLeagueListToLadderCandidates,
  mapRiotLeagueQueueTypeToMatchQueueId,
  type LadderCandidate,
} from './riot-league-ladder';
import {
  FAKE_PUUID,
  mockChallengerLeagueListDto,
  mockGrandmasterLeagueListDto,
  mockLeagueEntriesPageDto,
  mockMasterLeagueListDto,
} from './fixtures';
import { createMockFetch, realConfigOverrides } from './test-utils/mock-fetch';

describe('Riot league ladder DTO schemas (verified contract)', () => {
  it('parses a valid apex LeagueListDTO with puuid entries', () => {
    const parsed = RiotLeagueListDtoSchema.parse(mockChallengerLeagueListDto());
    expect(parsed.tier).toBe('CHALLENGER');
    expect(parsed.queue).toBe(RIOT_LEAGUE_QUEUE_RANKED_SOLO);
    expect(parsed.entries[0]?.puuid).toBe(FAKE_PUUID);
    expect(parsed.entries[0]).not.toHaveProperty('riotIdGameName');
    expect(parsed.entries[0]).not.toHaveProperty('summonerId');
  });

  it('parses grandmaster and master apex list fixtures', () => {
    expect(RiotLeagueListDtoSchema.parse(mockGrandmasterLeagueListDto()).tier).toBe('GRANDMASTER');
    expect(RiotLeagueListDtoSchema.parse(mockMasterLeagueListDto()).tier).toBe('MASTER');
  });

  it('parses a valid paginated LeagueEntryDTO page with puuid', () => {
    const parsed = RiotLeagueEntryDtoArraySchema.parse(mockLeagueEntriesPageDto());
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.puuid).toBeTruthy();
    expect(parsed[0]?.tier).toBe('DIAMOND');
    expect(parsed[0]?.rank).toBe('I');
    expect(parsed[0]?.queueType).toBe(RIOT_LEAGUE_QUEUE_RANKED_SOLO);
  });

  it('strips unknown extra Riot fields without failing (passthrough/strip convention)', () => {
    const apex = RiotLeagueListDtoSchema.parse({
      ...mockChallengerLeagueListDto(),
      undocumentedField: 'ok',
      entries: [
        {
          ...mockChallengerLeagueListDto().entries[0],
          futureField: 123,
        },
      ],
    });
    expect(apex.entries[0]?.puuid).toBe(FAKE_PUUID);

    const page = RiotLeagueEntryDtoArraySchema.parse([
      {
        ...mockLeagueEntriesPageDto()[0],
        undocumented: true,
      },
    ]);
    expect(page[0]?.puuid).toBeTruthy();
  });

  it('rejects apex list missing required entries array', () => {
    expect(() =>
      RiotLeagueListDtoSchema.parse({
        tier: 'CHALLENGER',
        queue: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      }),
    ).toThrow();
  });
});

describe('ladder candidate normalization', () => {
  it('normalizes apex entries with valid PUUID into LadderCandidate', () => {
    const list = mockChallengerLeagueListDto();
    const result = mapLeagueListToLadderCandidates({
      list,
      platformRoute: 'na1',
      acquisitionMode: 'APEX',
    });

    expect(result.skippedIncompleteIdentity).toBe(0);
    expect(result.candidates).toHaveLength(list.entries.length);
    const first = result.candidates[0]!;
    expect(first).toMatchObject({
      provider: 'RIOT',
      platformRoute: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      matchQueueId: 420,
      tier: 'CHALLENGER',
      division: 'I',
      puuid: FAKE_PUUID,
      riotIdGameName: null,
      riotIdTagLine: null,
      acquisitionMode: 'APEX',
    } satisfies Partial<LadderCandidate>);
  });

  it('treats optional Riot ID fields as null under current Riot league contract', () => {
    const result = mapLeagueEntriesToLadderCandidates({
      entries: mockLeagueEntriesPageDto(),
      platformRoute: 'na1',
      acquisitionMode: 'REPRESENTATIVE',
      page: 1,
    });
    expect(result.candidates.every((c) => c.riotIdGameName === null)).toBe(true);
    expect(result.candidates.every((c) => c.riotIdTagLine === null)).toBe(true);
    expect(result.candidates.every((c) => c.acquisitionMode === 'REPRESENTATIVE')).toBe(true);
  });

  it('marks missing/empty PUUID as non-enrollable (skipped), not as a candidate', () => {
    const result = mapLeagueEntriesToLadderCandidates({
      entries: [
        {
          queueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
          tier: 'GOLD',
          rank: 'II',
          leaguePoints: 10,
          wins: 1,
          losses: 1,
        },
        {
          queueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
          tier: 'GOLD',
          rank: 'II',
          puuid: '   ',
          leaguePoints: 10,
          wins: 1,
          losses: 1,
        },
        {
          queueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
          tier: 'GOLD',
          rank: 'III',
          puuid: `${FAKE_PUUID}-gold`,
          leaguePoints: 20,
          wins: 2,
          losses: 2,
        },
      ],
      platformRoute: 'na1',
      acquisitionMode: 'REPRESENTATIVE',
      page: 1,
    });

    expect(result.skippedIncompleteIdentity).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.puuid).toBe(`${FAKE_PUUID}-gold`);
    expect(result.candidates[0]?.tier).toBe('GOLD');
    expect(result.candidates[0]?.division).toBe('III');
  });

  it('normalizes tier/division from apex list tier + entry rank and from page entries', () => {
    const apex = mapLeagueListToLadderCandidates({
      list: mockMasterLeagueListDto(),
      platformRoute: 'na1',
      acquisitionMode: 'APEX',
    });
    expect(apex.candidates[0]?.tier).toBe('MASTER');
    // Apex LeagueItemDTO still carries rank (division) for LP ordering context.
    expect(apex.candidates[0]?.division).toBe('I');

    const page = mapLeagueEntriesToLadderCandidates({
      entries: mockLeagueEntriesPageDto({ tier: 'EMERALD', rank: 'II' }),
      platformRoute: 'na1',
      acquisitionMode: 'REPRESENTATIVE',
      page: 3,
    });
    expect(page.candidates[0]?.tier).toBe('EMERALD');
    expect(page.candidates[0]?.division).toBe('II');
    expect(page.candidates[0]?.page).toBe(3);
  });

  it('preserves distinct Challenger / Grandmaster / Master tiers (no Challenger collapse)', () => {
    const challenger = mapLeagueListToLadderCandidates({
      list: mockChallengerLeagueListDto(),
      platformRoute: 'na1',
      acquisitionMode: 'APEX',
    });
    const grandmaster = mapLeagueListToLadderCandidates({
      list: mockGrandmasterLeagueListDto(),
      platformRoute: 'na1',
      acquisitionMode: 'APEX',
    });
    const master = mapLeagueListToLadderCandidates({
      list: mockMasterLeagueListDto(),
      platformRoute: 'na1',
      acquisitionMode: 'APEX',
    });

    expect(new Set(challenger.candidates.map((c) => c.tier))).toEqual(new Set(['CHALLENGER']));
    expect(new Set(grandmaster.candidates.map((c) => c.tier))).toEqual(new Set(['GRANDMASTER']));
    expect(new Set(master.candidates.map((c) => c.tier))).toEqual(new Set(['MASTER']));
    expect(challenger.candidates.every((c) => c.platformRoute === 'na1' && c.puuid.length > 0)).toBe(
      true,
    );
  });

  it('maps league queue string to match queueId only via explicit constant mapping', () => {
    expect(mapRiotLeagueQueueTypeToMatchQueueId(RIOT_LEAGUE_QUEUE_RANKED_SOLO)).toBe(420);
    expect(mapRiotLeagueQueueTypeToMatchQueueId('RANKED_FLEX_SR')).toBe(440);
    expect(() => mapRiotLeagueQueueTypeToMatchQueueId('NOT_A_QUEUE')).toThrow(
      ValidationFailureError,
    );

    const result = mapLeagueListToLadderCandidates({
      list: mockChallengerLeagueListDto(),
      platformRoute: 'na1',
      acquisitionMode: 'APEX',
    });
    // Ensure we did not invent 420 from an undocumented assumption buried in mapping:
    // candidate.matchQueueId must equal the explicit mapper output for the list queue.
    expect(result.candidates[0]?.matchQueueId).toBe(
      mapRiotLeagueQueueTypeToMatchQueueId(result.candidates[0]!.leagueQueueType),
    );
  });
});

describe('ladder URL construction', () => {
  it('builds apex Ranked Solo paths with encoded queue', () => {
    expect(buildApexLeaguePath('challenger', RIOT_LEAGUE_QUEUE_RANKED_SOLO)).toBe(
      `/lol/league/v4/challengerleagues/by-queue/${encodeURIComponent(RIOT_LEAGUE_QUEUE_RANKED_SOLO)}`,
    );
    expect(buildApexLeaguePath('grandmaster', RIOT_LEAGUE_QUEUE_RANKED_SOLO)).toBe(
      `/lol/league/v4/grandmasterleagues/by-queue/${encodeURIComponent(RIOT_LEAGUE_QUEUE_RANKED_SOLO)}`,
    );
    expect(buildApexLeaguePath('master', RIOT_LEAGUE_QUEUE_RANKED_SOLO)).toBe(
      `/lol/league/v4/masterleagues/by-queue/${encodeURIComponent(RIOT_LEAGUE_QUEUE_RANKED_SOLO)}`,
    );
  });

  it('builds paginated tier/division paths with page query handled by client', () => {
    expect(
      buildLeagueEntriesByTierDivisionPath({
        queue: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
        tier: 'DIAMOND',
        division: 'I',
      }),
    ).toBe(
      `/lol/league/v4/entries/${encodeURIComponent(RIOT_LEAGUE_QUEUE_RANKED_SOLO)}/${encodeURIComponent('DIAMOND')}/${encodeURIComponent('I')}`,
    );

    expect(
      buildLeagueEntriesByTierDivisionPath({
        queue: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
        tier: 'EMERALD',
        division: 'II',
      }),
    ).toContain('/EMERALD/II');

    expect(
      buildLeagueEntriesByTierDivisionPath({
        queue: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
        tier: 'PLATINUM',
        division: 'III',
      }),
    ).toContain('/PLATINUM/III');

    expect(
      buildLeagueEntriesByTierDivisionPath({
        queue: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
        tier: 'GOLD',
        division: 'IV',
      }),
    ).toContain('/GOLD/IV');
  });
});

describe('RiotGameDataProvider ladder methods', () => {
  it('fetches challenger Ranked Solo via platform routing and normalizes candidates', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: mockChallengerLeagueListDto() },
    ]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    const result = await provider.getChallengerLeague({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
    });

    expect(calls[0]?.url).toBe(
      `https://na1.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/${encodeURIComponent(RIOT_LEAGUE_QUEUE_RANKED_SOLO)}`,
    );
    expect(result.candidates[0]?.acquisitionMode).toBe('APEX');
    expect(result.candidates[0]?.puuid).toBe(FAKE_PUUID);
  });

  it('fetches grandmaster and master Ranked Solo lists', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: mockGrandmasterLeagueListDto() },
      { status: 200, body: mockMasterLeagueListDto() },
    ]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    await provider.getGrandmasterLeague({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
    });
    await provider.getMasterLeague({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
    });

    expect(calls[0]?.url).toContain('/lol/league/v4/grandmasterleagues/by-queue/');
    expect(calls[1]?.url).toContain('/lol/league/v4/masterleagues/by-queue/');
  });

  it('fetches one bounded Diamond I page and Emerald II page N without looping', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: mockLeagueEntriesPageDto({ tier: 'DIAMOND', rank: 'I' }) },
      { status: 200, body: mockLeagueEntriesPageDto({ tier: 'EMERALD', rank: 'II' }) },
      { status: 200, body: [] },
    ]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    const diamond = await provider.getLeagueEntriesByTierDivision({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      tier: 'DIAMOND',
      division: 'I',
      page: 1,
    });
    expect(calls[0]?.url).toContain(
      `/lol/league/v4/entries/${encodeURIComponent(RIOT_LEAGUE_QUEUE_RANKED_SOLO)}/DIAMOND/I`,
    );
    expect(calls[0]?.url).toContain('page=1');
    expect(diamond.candidates[0]?.tier).toBe('DIAMOND');
    expect(diamond.pageExhausted).toBe(false);

    const emerald = await provider.getLeagueEntriesByTierDivision({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      tier: 'EMERALD',
      division: 'II',
      page: 7,
    });
    expect(calls[1]?.url).toContain('/EMERALD/II');
    expect(calls[1]?.url).toContain('page=7');
    expect(emerald.candidates[0]?.page).toBe(7);

    const empty = await provider.getLeagueEntriesByTierDivision({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      tier: 'GOLD',
      division: 'IV',
      page: 99,
    });
    expect(empty.candidates).toEqual([]);
    expect(empty.pageExhausted).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('rejects invalid page / unsupported paginated tier values', async () => {
    const { fetchFn } = createMockFetch([]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    await expect(
      provider.getLeagueEntriesByTierDivision({
        platform: 'na1',
        leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
        tier: 'DIAMOND',
        division: 'I',
        page: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationFailureError);

    await expect(
      provider.getLeagueEntriesByTierDivision({
        platform: 'na1',
        leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
        tier: 'CHALLENGER',
        division: 'I',
        page: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationFailureError);
  });

  it('surfaces invalid ladder response bodies as ProviderResponseInvalidError', async () => {
    const { fetchFn } = createMockFetch([{ status: 200, body: { not: 'a-league-list' } }]);
    const provider = new RiotGameDataProvider(
      RiotApiClient.create(realConfigOverrides(), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    );

    await expect(
      provider.getChallengerLeague({
        platform: 'na1',
        leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      }),
    ).rejects.toBeInstanceOf(ProviderResponseInvalidError);
  });
});

describe('MockRiotGameDataProvider ladder support', () => {
  it('returns deterministic apex and representative candidates', async () => {
    const provider = new MockRiotGameDataProvider();
    const challenger = await provider.getChallengerLeague({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
    });
    expect(challenger.candidates.length).toBeGreaterThan(0);
    expect(challenger.candidates[0]?.acquisitionMode).toBe('APEX');

    const gold = await provider.getLeagueEntriesByTierDivision({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      tier: 'GOLD',
      division: 'II',
      page: 1,
    });
    expect(gold.candidates[0]?.tier).toBe('GOLD');
    expect(gold.candidates[0]?.acquisitionMode).toBe('REPRESENTATIVE');

    const exhausted = await provider.getLeagueEntriesByTierDivision({
      platform: 'na1',
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
      tier: 'GOLD',
      division: 'II',
      page: 2,
    });
    expect(exhausted.pageExhausted).toBe(true);
  });
});
