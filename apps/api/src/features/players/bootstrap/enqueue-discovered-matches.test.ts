import { describe, expect, it, vi } from 'vitest';
import { IngestionJobStatus, type PlayerAccount } from '@prisma/client';
import {
  MATCH_INGESTION_NORMALIZATION_VERSION,
  buildMatchIngestionBullMqJobId,
} from '@league-helper/shared';
import { enqueueDiscoveredMatches } from './enqueue-discovered-matches';

function makeAccount(overrides: Partial<PlayerAccount> = {}): PlayerAccount {
  return {
    id: 'acct-1',
    playerId: 'player-1',
    provider: 'RIOT',
    externalAccountId: 'puuid-1',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    gameName: 'A',
    tagLine: 'NA1',
    summonerId: null,
    accountId: null,
    profileIconId: null,
    summonerLevel: null,
    lastResolvedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function bullJobId(externalMatchId: string): string {
  return buildMatchIngestionBullMqJobId({
    provider: 'RIOT',
    regionalRoute: 'americas',
    externalMatchId,
    normalizationVersion: MATCH_INGESTION_NORMALIZATION_VERSION,
  });
}

describe('enqueueDiscoveredMatches', () => {
  it('skips linked COMPLETED matches', async () => {
    const producer = {
      enqueueMatch: vi.fn(),
      getJobStates: vi.fn(async () => new Map([[bullJobId('m1'), null]])),
    };
    const ingestionJobs = {
      findByExternalResourceIds: vi.fn(async () => []),
      createIdempotent: vi.fn(),
      updateStatus: vi.fn(),
    };
    const matches = {
      linkParticipantsByExternalAccountId: vi.fn(async () => 0),
      findExistingByExternalIds: vi.fn(async () => [
        { externalMatchId: 'm1' },
      ]),
      findLinkedCompletedExternalIds: vi.fn(async () => ['m1']),
      findExistingExternalIdsMissingLink: vi.fn(async () => []),
    };

    const result = await enqueueDiscoveredMatches(
      {
        matches: matches as never,
        ingestionJobs: ingestionJobs as never,
        producer: producer as never,
        matchIngestionJobAttempts: 5,
        logger: { log: vi.fn() },
        invalidatePlayerCache: vi.fn(),
      },
      {
        account: makeAccount(),
        discoveredMatchIds: ['m1'],
        correlationId: 'c1',
      },
    );

    expect(result.warnings).toEqual([]);
    expect(result.enqueuedCount).toBe(0);
    expect(result.skippedAlreadyCompleteCount).toBe(1);
    expect(producer.enqueueMatch).not.toHaveBeenCalled();
    expect(ingestionJobs.createIdempotent).not.toHaveBeenCalled();
  });

  it('skips live BullMQ waiting/active/delayed jobs', async () => {
    const producer = {
      enqueueMatch: vi.fn(),
      getJobStates: vi.fn(async () => new Map([[bullJobId('m2'), 'waiting']])),
    };
    const ingestionJobs = {
      findByExternalResourceIds: vi.fn(async () => []),
      createIdempotent: vi.fn(),
      updateStatus: vi.fn(),
    };
    const matches = {
      linkParticipantsByExternalAccountId: vi.fn(async () => 0),
      findExistingByExternalIds: vi.fn(async () => []),
      findLinkedCompletedExternalIds: vi.fn(async () => []),
      findExistingExternalIdsMissingLink: vi.fn(async () => []),
    };

    await enqueueDiscoveredMatches(
      {
        matches: matches as never,
        ingestionJobs: ingestionJobs as never,
        producer: producer as never,
        matchIngestionJobAttempts: 5,
        logger: { log: vi.fn() },
        invalidatePlayerCache: vi.fn(),
      },
      {
        account: makeAccount(),
        discoveredMatchIds: ['m2'],
        correlationId: 'c1',
      },
    );

    expect(producer.enqueueMatch).not.toHaveBeenCalled();
    expect(ingestionJobs.createIdempotent).not.toHaveBeenCalled();
  });

  it('creates durable job and calls producer.enqueueMatch for new IDs', async () => {
    const durableJob = {
      id: 'job-1',
      status: IngestionJobStatus.PENDING,
      externalResourceId: 'm3',
    };
    const producer = {
      enqueueMatch: vi.fn(async () => ({
        externalMatchId: 'm3',
        jobId: bullJobId('m3'),
        published: true,
        alreadyExists: false,
      })),
      getJobStates: vi.fn(async () => new Map([[bullJobId('m3'), null]])),
    };
    const ingestionJobs = {
      findByExternalResourceIds: vi.fn(async () => []),
      createIdempotent: vi.fn(async () => ({ job: durableJob, created: true })),
      updateStatus: vi.fn(async () => durableJob),
    };
    const matches = {
      linkParticipantsByExternalAccountId: vi.fn(async () => 0),
      findExistingByExternalIds: vi.fn(async () => []),
      findLinkedCompletedExternalIds: vi.fn(async () => []),
      findExistingExternalIdsMissingLink: vi.fn(async () => []),
    };

    const result = await enqueueDiscoveredMatches(
      {
        matches: matches as never,
        ingestionJobs: ingestionJobs as never,
        producer: producer as never,
        matchIngestionJobAttempts: 5,
        logger: { log: vi.fn() },
        invalidatePlayerCache: vi.fn(),
      },
      {
        account: makeAccount(),
        discoveredMatchIds: ['m3'],
        correlationId: 'c1',
      },
    );

    expect(result.warnings).toEqual([]);
    expect(result.enqueuedCount).toBe(1);
    expect(result.skippedAlreadyCompleteCount).toBe(0);
    expect(ingestionJobs.createIdempotent).toHaveBeenCalledTimes(1);
    expect(producer.enqueueMatch).toHaveBeenCalledTimes(1);
    expect(producer.enqueueMatch.mock.calls[0]?.[0]).toMatchObject({
      provider: 'RIOT',
      externalMatchId: 'm3',
      regionalRoute: 'americas',
      requestedByPlayerAccountId: 'acct-1',
      correlationId: 'c1',
    });
    expect(ingestionJobs.updateStatus).toHaveBeenCalledWith(
      'job-1',
      IngestionJobStatus.QUEUED,
      expect.objectContaining({ scheduledAt: expect.any(Date) }),
    );
  });
});
