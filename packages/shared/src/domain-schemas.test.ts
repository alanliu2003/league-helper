import { describe, expect, it } from 'vitest';
import { PaginatedResponseSchema, PaginationQuerySchema, createPaginatedResponse } from './api';
import { RankDivisionSchema, RankTierSchema } from './ranks';
import { TeamPositionSchema } from './positions';
import { QueueTypeSchema } from './queues';
import { PlayerAccountSchema, RankedEntrySchema } from './player';
import { MatchParticipantSchema, MatchSummarySchema } from './match';
import { ChampionMasterySchema } from './mastery';
import { z } from 'zod';

describe('rank and role schemas', () => {
  it.each(['IRON', 'EMERALD', 'CHALLENGER'] as const)('accepts tier %s', (tier) => {
    expect(RankTierSchema.parse(tier)).toBe(tier);
  });

  it('rejects unknown tiers', () => {
    expect(() => RankTierSchema.parse('WOOD')).toThrow();
  });

  it.each(['I', 'IV'] as const)('accepts division %s', (division) => {
    expect(RankDivisionSchema.parse(division)).toBe(division);
  });

  it.each(['TOP', 'JUNGLE', 'UTILITY'] as const)('accepts team position %s', (position) => {
    expect(TeamPositionSchema.parse(position)).toBe(position);
  });

  it('accepts known queue types', () => {
    expect(QueueTypeSchema.parse('RANKED_SOLO_5x5')).toBe('RANKED_SOLO_5x5');
  });
});

describe('pagination validation', () => {
  it('applies defaults and coerces query values', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(PaginationQuerySchema.parse({ page: '2', pageSize: '10' })).toEqual({
      page: 2,
      pageSize: 10,
    });
  });

  it('rejects invalid pagination', () => {
    expect(() => PaginationQuerySchema.parse({ page: 0 })).toThrow();
    expect(() => PaginationQuerySchema.parse({ pageSize: 101 })).toThrow();
  });

  it('builds a valid paginated response', () => {
    const response = createPaginatedResponse({
      items: ['a', 'b'],
      page: 1,
      pageSize: 2,
      totalItems: 5,
    });

    expect(PaginatedResponseSchema(z.string()).parse(response)).toMatchObject({
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });
});

describe('domain aggregate schemas', () => {
  const player = {
    provider: 'RIOT' as const,
    externalAccountId: 'puuid-123',
    riotId: { gameName: 'Hide on bush', tagLine: 'KR1' },
    platform: 'kr' as const,
    regionalRoute: 'asia' as const,
  };

  it('accepts a player account shaped for provider neutrality', () => {
    expect(PlayerAccountSchema.parse(player).externalAccountId).toBe('puuid-123');
  });

  it('accepts ranked entries with nullable division', () => {
    expect(
      RankedEntrySchema.parse({
        provider: 'RIOT',
        externalAccountId: 'puuid-123',
        platform: 'kr',
        queueType: 'RANKED_SOLO_5x5',
        tier: 'CHALLENGER',
        division: null,
        leaguePoints: 900,
        wins: 100,
        losses: 80,
      }),
    ).toMatchObject({ tier: 'CHALLENGER', division: null });
  });

  it('accepts match summary and mastery models', () => {
    const participant = MatchParticipantSchema.parse({
      provider: 'RIOT',
      championId: 157,
      teamId: 100,
      teamPosition: 'MIDDLE',
      win: true,
      kills: 5,
      deaths: 2,
      assists: 7,
    });

    expect(
      MatchSummarySchema.parse({
        provider: 'RIOT',
        matchId: 'KR_1',
        regionalRoute: 'asia',
        queueId: 420,
        gameCreation: '2026-01-01T00:00:00.000Z',
        gameDurationSeconds: 1800,
        gameVersion: '14.1.1.123',
        patchLabel: '14.1',
        participants: [participant],
      }).matchId,
    ).toBe('KR_1');

    expect(
      ChampionMasterySchema.parse({
        provider: 'RIOT',
        externalAccountId: 'puuid-123',
        platform: 'kr',
        championId: 157,
        championLevel: 7,
        championPoints: 200000,
      }).championId,
    ).toBe(157);
  });
});
