import { describe, expect, it, vi } from 'vitest';
import { IngestionJobStatus } from '@prisma/client';
import { PlayerRefreshStatusService } from './player-refresh-status.service';

function createService(overrides: {
  linkedCompletedIds?: string[];
  existingExternalIds?: string[];
  durableStatuses?: Array<{ status: IngestionJobStatus; count: number }>;
  durableJobs?: Array<{
    status: IngestionJobStatus;
    externalResourceId: string | null;
  }>;
  bullStates?: Map<string, string | null>;
}) {
  const matchRepository = {
    findExistingByExternalIds: vi.fn(async () =>
      (overrides.existingExternalIds ?? []).map((externalMatchId) => ({ externalMatchId })),
    ),
    findLinkedCompletedExternalIds: vi.fn(async () => overrides.linkedCompletedIds ?? []),
    countCompletedForPlayerAccount: vi.fn(async () => overrides.linkedCompletedIds?.length ?? 0),
  };
  const ingestionJobs = {
    countByStatuses: vi.fn(async () => overrides.durableStatuses ?? []),
    findByExternalResourceIds: vi.fn(async () => overrides.durableJobs ?? []),
  };
  const producer = {
    getJobStates: vi.fn(async () => overrides.bullStates ?? new Map()),
  };
  const redis = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
  };

  return new PlayerRefreshStatusService(
    matchRepository as never,
    ingestionJobs as never,
    producer as never,
    {
      profileCacheTtlSeconds: 60,
      defaultMatchCount: 20,
    } as never,
    redis as never,
  );
}

const account = {
  id: '11111111-1111-1111-1111-111111111111',
  provider: 'RIOT',
  regionalRoute: 'americas',
  lastResolvedAt: new Date(),
} as never;

describe('PlayerRefreshStatusService', () => {
  it('does not report COMPLETE when IDs are discovered but none are linked', async () => {
    const discovered = Array.from({ length: 20 }, (_, i) => `NA1_MATCH_${i}`);
    const service = createService({
      existingExternalIds: discovered,
      linkedCompletedIds: [],
      bullStates: new Map(discovered.map((id) => [`ingest_RIOT_americas_${id}_1`, null])),
    });

    const status = await service.compute({
      account,
      discoveredMatchIds: discovered,
      requestedMatchCount: 20,
    });

    expect(status.state).not.toBe('COMPLETE');
    expect(status.completedMatchCount).toBe(0);
    expect(['PROCESSING', 'PARTIAL', 'FAILED', 'IDLE']).toContain(status.state);
  });

  it('reports PROCESSING when jobs are waiting', async () => {
    const discovered = ['NA1_A', 'NA1_B'];
    const service = createService({
      linkedCompletedIds: [],
      bullStates: new Map([
        ['ingest_RIOT_americas_NA1_A_1', 'waiting'],
        ['ingest_RIOT_americas_NA1_B_1', 'waiting'],
      ]),
    });

    const status = await service.compute({
      account,
      discoveredMatchIds: discovered,
      requestedMatchCount: 2,
    });

    expect(status.state).toBe('PROCESSING');
    expect(status.queuedMatchCount).toBeGreaterThan(0);
  });

  it('reports PARTIAL when some matches are linked and others are waiting', async () => {
    const discovered = ['NA1_A', 'NA1_B'];
    const service = createService({
      linkedCompletedIds: ['NA1_A'],
      existingExternalIds: ['NA1_A'],
      bullStates: new Map([
        ['ingest_RIOT_americas_NA1_A_1', 'completed'],
        ['ingest_RIOT_americas_NA1_B_1', 'waiting'],
      ]),
    });

    const status = await service.compute({
      account,
      discoveredMatchIds: discovered,
      requestedMatchCount: 2,
    });

    expect(status.state).toBe('PARTIAL');
    expect(status.completedMatchCount).toBe(1);
  });

  it('reports RATE_LIMITED when only delayed jobs remain', async () => {
    const discovered = ['NA1_A'];
    const service = createService({
      linkedCompletedIds: [],
      bullStates: new Map([['ingest_RIOT_americas_NA1_A_1', 'delayed']]),
    });

    const status = await service.compute({
      account,
      discoveredMatchIds: discovered,
      requestedMatchCount: 1,
      warnings: [{ code: 'PROVIDER_RATE_LIMITED', message: 'slow down', retryAfterSeconds: 10 }],
    });

    expect(status.state).toBe('RATE_LIMITED');
    expect(status.delayedMatchCount).toBe(1);
  });

  it('reports COMPLETE only when all discovered matches are linked and idle', async () => {
    const discovered = ['NA1_A', 'NA1_B'];
    const service = createService({
      linkedCompletedIds: discovered,
      existingExternalIds: discovered,
      bullStates: new Map([
        ['ingest_RIOT_americas_NA1_A_1', 'completed'],
        ['ingest_RIOT_americas_NA1_B_1', 'completed'],
      ]),
    });

    const status = await service.compute({
      account,
      discoveredMatchIds: discovered,
      requestedMatchCount: 2,
    });

    expect(status.state).toBe('COMPLETE');
    expect(status.completedMatchCount).toBe(2);
  });

  it('detects durable QUEUED jobs missing Redis entries', async () => {
    const discovered = ['NA1_A'];
    const service = createService({
      linkedCompletedIds: [],
      durableJobs: [{ status: IngestionJobStatus.QUEUED, externalResourceId: 'NA1_A' }],
      durableStatuses: [{ status: IngestionJobStatus.QUEUED, count: 1 }],
      bullStates: new Map([['ingest_RIOT_americas_NA1_A_1', null]]),
    });

    const status = await service.compute({
      account,
      discoveredMatchIds: discovered,
      requestedMatchCount: 1,
    });

    expect(status.warnings.some((w) => w.code === 'INGESTION_STATE_INCONSISTENT')).toBe(true);
    expect(status.state).not.toBe('COMPLETE');
  });
});
