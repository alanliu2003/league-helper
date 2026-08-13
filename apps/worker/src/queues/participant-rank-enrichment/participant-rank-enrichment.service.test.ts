import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantRankObservation } from '@prisma/client';
import { enrichParticipantRank } from './participant-rank-enrichment.service.js';
import type { ParticipantRankObservationRepository } from './participant-rank-observation.repository.js';

const matchIdA = '11111111-1111-4111-8111-111111111111';
const matchIdB = '22222222-2222-4222-8222-222222222222';
const puuid = 'puuid-shared-1';

vi.mock('../champion-aggregation/enqueue.js', () => ({
  enqueueChampionAggregationAfterCommit: vi.fn().mockResolvedValue({
    published: true,
    jobId: 'agg-1',
    previousKeyCount: 1,
  }),
}));

vi.mock('../champion-aggregation/champion-aggregation.repository.js', () => ({
  createChampionAggregationRepository: vi.fn().mockReturnValue({}),
}));

import { enqueueChampionAggregationAfterCommit } from '../champion-aggregation/enqueue.js';

function observation(
  overrides: Partial<ParticipantRankObservation> = {},
): ParticipantRankObservation {
  return {
    id: 'obs-fresh',
    provider: 'RIOT',
    platformRoute: 'na1',
    externalAccountId: puuid,
    queueType: 'RANKED_SOLO_5x5',
    observedTier: 'DIAMOND',
    observedDivision: 'II',
    resolutionStatus: 'RESOLVED_RANKED',
    observedAt: new Date('2026-08-10T12:00:00.000Z'),
    providerResultCode: 'HTTP_200_RANKED',
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
    updatedAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  };
}

function participantRow(matchId: string, id: string) {
  return {
    id,
    matchId,
    participantId: 1,
    championId: 164,
    teamPosition: 'TOP',
    individualPosition: 'TOP',
    lane: 'TOP',
    role: 'SOLO',
    rankTierAtIngestion: null,
    rankResolutionStatus: 'PENDING' as const,
    match: {
      id: matchId,
      normalizedPatch: '14.16',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      mapId: 11,
      gameMode: 'CLASSIC',
      remake: false,
    },
  };
}

describe('enrichParticipantRank', () => {
  const enqueueAgg = vi.mocked(enqueueChampionAggregationAfterCommit);
  let updateMany: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let prisma: {
    matchParticipant: { findMany: typeof findMany; updateMany: typeof updateMany };
  };
  let observationRepository: ParticipantRankObservationRepository;
  let getRankedEntries: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enqueueAgg.mockClear();
    updateMany = vi.fn().mockResolvedValue({ count: 2 });
    findMany = vi
      .fn()
      .mockResolvedValue([
        participantRow(matchIdA, 'p1'),
        participantRow(matchIdB, 'p2'),
      ]);
    prisma = {
      matchParticipant: { findMany, updateMany },
    };
    getRankedEntries = vi.fn().mockResolvedValue([
      {
        provider: 'RIOT',
        externalAccountId: puuid,
        platform: 'na1',
        queueType: 'RANKED_SOLO_5x5',
        tier: 'DIAMOND',
        division: 'II',
        leaguePoints: 40,
        wins: 1,
        losses: 1,
      },
    ]);
    observationRepository = {
      findLatestObservation: vi.fn(),
      findFreshReusableObservation: vi.fn().mockResolvedValue({
        observation: null,
        reusable: false,
        reason: 'NONE',
      }),
      appendObservation: vi.fn().mockResolvedValue(observation()),
    };
  });

  const baseDeps = () => ({
    prisma: prisma as never,
    provider: { getRankedEntries },
    sharedCooldown: null,
    config: {
      queueName: 'participant-rank-enrichment',
      concurrency: 1,
      jobAttempts: 5,
      backoffBaseMs: 2000,
      backoffMaxMs: 60_000,
      observationFreshnessMs: 6 * 60 * 60 * 1000,
      riotShared429CooldownMinMs: 900_000,
    },
    championAggregationQueue: {} as never,
    championAggregationConfig: {
      queueName: 'champion-aggregation',
      concurrency: 2,
      jobAttempts: 5,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      matchupAggregationVersion: '1',
      confidenceLevel: 0.95,
    },
    observationRepository,
    now: () => new Date('2026-08-10T12:00:00.000Z'),
  });

  const payload = {
    platformRoute: 'na1' as const,
    externalAccountId: puuid,
    queueType: 'RANKED_SOLO_5x5' as const,
    reason: 'MATCH_INGESTION' as const,
    matchId: matchIdA,
  };

  it('writes observation, updates participants, triggers aggregation without TrackedPlayer', async () => {
    const result = await enrichParticipantRank(baseDeps(), payload);

    expect(result.status).toBe('resolved_from_provider');
    expect(result.resolutionStatus).toBe('RESOLVED_RANKED');
    expect(result.riotCalled).toBe(true);
    expect(observationRepository.appendObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        externalAccountId: puuid,
        resolutionStatus: 'RESOLVED_RANKED',
        observedTier: 'DIAMOND',
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] } },
        data: expect.objectContaining({
          rankResolutionStatus: 'RESOLVED_RANKED',
          rankTierAtIngestion: 'DIAMOND',
        }),
      }),
    );
    expect(enqueueAgg).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          externalAccountId: puuid,
          // No TrackedPlayer / playerAccountId filter.
        }),
      }),
    );
    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where).not.toHaveProperty('playerAccountId');
    expect(where).not.toHaveProperty('trackedPlayer');
  });

  it('reuses fresh observation cache and skips Riot for same PUUID across matches', async () => {
    vi.mocked(observationRepository.findFreshReusableObservation).mockResolvedValue({
      observation: observation(),
      reusable: true,
      reason: 'RESOLVED_RANKED',
    });

    const result = await enrichParticipantRank(baseDeps(), payload);

    expect(result.status).toBe('resolved_from_cache');
    expect(result.cacheHit).toBe(true);
    expect(result.riotCalled).toBe(false);
    expect(getRankedEntries).not.toHaveBeenCalled();
    expect(observationRepository.appendObservation).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledOnce();
    expect(result.updatedParticipantCount).toBe(2);
    expect(result.affectedMatchIds.sort()).toEqual([matchIdA, matchIdB].sort());
  });

  it('active cooldown: zero Riot calls, participants remain unresolved, job deferred', async () => {
    const remainingMs = vi.fn().mockResolvedValue(45_000);
    const result = await enrichParticipantRank(
      {
        ...baseDeps(),
        sharedCooldown: {
          remainingMs,
          extendCooldown: vi.fn(),
        },
      },
      payload,
    );

    expect(result.status).toBe('retryable');
    expect(result.riotCalled).toBe(false);
    expect(result.providerResultCode).toBe('SHARED_COOLDOWN_ACTIVE');
    expect(result.updatedParticipantCount).toBe(0);
    expect(getRankedEntries).not.toHaveBeenCalled();
    expect(observationRepository.appendObservation).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('RESOLVED_UNRANKED updates participants and triggers aggregation', async () => {
    getRankedEntries.mockResolvedValue([]);
    vi.mocked(observationRepository.appendObservation).mockResolvedValue(
      observation({
        resolutionStatus: 'RESOLVED_UNRANKED',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'HTTP_200_NO_APPLICABLE_ENTRY',
      }),
    );

    const result = await enrichParticipantRank(baseDeps(), payload);
    expect(result.resolutionStatus).toBe('RESOLVED_UNRANKED');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rankResolutionStatus: 'RESOLVED_UNRANKED',
        }),
      }),
    );
    expect(enqueueAgg).toHaveBeenCalled();
  });
});
