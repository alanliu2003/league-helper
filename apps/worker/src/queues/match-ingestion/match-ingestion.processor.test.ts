import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { IngestionJobStatus, MatchIngestionStatus, TimelineFetchStatus } from '@prisma/client';
import {
  ProviderRateLimitedError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  MATCH_INGESTION_JOB_NAME,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import { FAKE_PUUID, mockMatchDto, mockTimelineDto } from '@league-helper/server-riot';
import type {
  ChampionAggregationWorkerConfig,
  MatchIngestionWorkerConfig,
} from '../../config.js';
import { expandMatchParticipantsSafe } from '../../collector/expand-match-participants-safe.js';
import { processMatchIngestionJob } from './match-ingestion.processor.js';
import {
  buildPuuid,
  buildRankedMatchDto,
  buildRichTimelineDto,
} from './test-utils/ranked-match-fixture.js';

vi.mock('../../collector/expand-match-participants-safe.js', () => ({
  expandMatchParticipantsSafe: vi.fn().mockResolvedValue({ skipped: true, reason: 'disabled' }),
}));

const expandMatchParticipantsSafeMock = vi.mocked(expandMatchParticipantsSafe);

function baseConfig(
  overrides: Partial<MatchIngestionWorkerConfig> = {},
): MatchIngestionWorkerConfig {
  return {
    queueName: 'match-ingestion',
    concurrency: 2,
    jobAttempts: 5,
    backoffBaseMs: 2000,
    backoffMaxMs: 60_000,
    riotShared429CooldownMinMs: 15 * 60_000,
    timelineFetchEnabled: true,
    storeRawPayloads: false,
    timelineRequiredForComplete: false,
    normalizationVersion: 1,
    ...overrides,
  };
}

function aggregationConfig(
  overrides: Partial<ChampionAggregationWorkerConfig> = {},
): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation',
    concurrency: 2,
    jobAttempts: 5,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    matchupAggregationVersion: '1',
    confidenceLevel: 0.95,
    ...overrides,
  };
}

function createChampionAggregationQueueMock() {
  return {
    getJob: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue({ id: 'agg-job-1' }),
  };
}

function makeDeps(input: {
  prisma: unknown;
  provider: unknown;
  redis: unknown;
  config?: MatchIngestionWorkerConfig;
  championAggregationQueue?: ReturnType<typeof createChampionAggregationQueueMock>;
  sharedCooldown?: {
    isCoolingDown: ReturnType<typeof vi.fn>;
    remainingMs: ReturnType<typeof vi.fn>;
    extendCooldown: ReturnType<typeof vi.fn>;
    getCooldownState?: ReturnType<typeof vi.fn>;
  } | null;
}) {
  return {
    prisma: input.prisma as never,
    provider: input.provider as never,
    redis: input.redis as never,
    config: input.config ?? baseConfig(),
    championAggregationQueue: (input.championAggregationQueue ??
      createChampionAggregationQueueMock()) as never,
    championAggregationConfig: aggregationConfig(),
    sharedCooldown: input.sharedCooldown as never,
  };
}

function mockSharedCooldown(
  overrides: {
    remainingMs?: number;
    coolingDown?: boolean;
  } = {},
) {
  const remainingMs = overrides.remainingMs ?? 0;
  return {
    isCoolingDown: vi.fn().mockResolvedValue(overrides.coolingDown ?? remainingMs > 0),
    remainingMs: vi.fn().mockResolvedValue(remainingMs),
    extendCooldown: vi.fn().mockImplementation(async (input: { now: number; configuredFloorMs: number; retryAfterMs?: number | null }) => {
      const until =
        input.now + Math.max(input.configuredFloorMs, input.retryAfterMs ?? 0);
      return { cooldownUntil: until, extended: true, previousCooldownUntil: null };
    }),
    getCooldownState: vi.fn().mockResolvedValue({
      cooldownUntil: remainingMs > 0 ? Date.now() + remainingMs : null,
    }),
  };
}

function validPayload(overrides: Partial<MatchIngestionJobPayload> = {}): MatchIngestionJobPayload {
  return {
    provider: 'RIOT',
    externalMatchId: 'NA1_FAKE_MATCH_RANKED_10',
    regionalRoute: 'americas',
    requestedByPlayerAccountId: '11111111-1111-1111-1111-111111111111',
    correlationId: 'corr-test-1',
    normalizationVersion: 1,
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeJob(
  data: unknown,
  opts: { attemptsMade?: number; attempts?: number; id?: string; name?: string } = {},
): Job<MatchIngestionJobPayload> {
  return {
    id: opts.id ?? 'ingest_test_1',
    name: opts.name ?? MATCH_INGESTION_JOB_NAME,
    data: data as MatchIngestionJobPayload,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 5 },
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<MatchIngestionJobPayload>;
}

type Store = {
  jobs: Map<string, Record<string, unknown>>;
  matches: Map<string, Record<string, unknown>>;
  participants: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  timelines: Map<string, Record<string, unknown>>;
  timelineEvents: Array<Record<string, unknown>>;
  timelineFrames: Array<Record<string, unknown>>;
  accounts: Array<{ id: string; playerId: string; provider: string; externalAccountId: string }>;
  snapshots: Array<{
    id: string;
    playerAccountId: string;
    tier: string;
    queueType: string;
    capturedAt: Date;
  }>;
};

function createPrismaMock(store: Store) {
  const matchKey = (provider: string, externalMatchId: string) => `${provider}:${externalMatchId}`;

  const rankSnapshotFindMany = vi.fn(
    async ({
      where,
    }: {
      where: {
        playerAccountId: { in: string[] };
        queueType: string;
        capturedAt: { lte: Date };
      };
    }) => {
      return store.snapshots
        .filter(
          (row) =>
            where.playerAccountId.in.includes(row.playerAccountId) &&
            row.queueType === where.queueType &&
            row.capturedAt.getTime() <= where.capturedAt.lte.getTime(),
        )
        .sort((a, b) => {
          const byCaptured = b.capturedAt.getTime() - a.capturedAt.getTime();
          if (byCaptured !== 0) {
            return byCaptured;
          }
          return b.id.localeCompare(a.id);
        });
    },
  );

  return {
    ingestionJobRecord: {
      findUnique: vi.fn(
        async ({ where }: { where: { jobType_idempotencyKey: { idempotencyKey: string } } }) => {
          return store.jobs.get(where.jobType_idempotencyKey.idempotencyKey) ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `job-${store.jobs.size + 1}`, ...data };
        store.jobs.set(String(data.idempotencyKey), row);
        return { id: row.id };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [key, row] of store.jobs.entries()) {
            if (row.id === where.id) {
              const next = { ...row, ...data };
              store.jobs.set(key, next);
              return { id: where.id, ...next };
            }
          }
          return { id: where.id };
        },
      ),
    },
    match: {
      findUnique: vi.fn(
        async ({
          where,
          include,
        }: {
          where: { provider_externalMatchId: { provider: string; externalMatchId: string } };
          include?: unknown;
        }) => {
          const key = matchKey(
            where.provider_externalMatchId.provider,
            where.provider_externalMatchId.externalMatchId,
          );
          const match = store.matches.get(key);
          if (!match) {
            return null;
          }
          if (include) {
            return {
              ...match,
              participants: store.participants.filter(
                (participant) => participant.matchId === match.id,
              ),
            };
          }
          return match;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [key, match] of store.matches.entries()) {
            if (match.id === where.id) {
              const next = { ...match, ...data };
              store.matches.set(key, next);
              return next;
            }
          }
          return data;
        },
      ),
    },
    matchParticipant: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { matchId: string; externalAccountId: string };
          select?: { id?: boolean };
        }) => {
          const participant = store.participants.find(
            (row) =>
              row.matchId === where.matchId && row.externalAccountId === where.externalAccountId,
          );
          return participant ? { id: participant.id } : null;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: string;
            matchId_participantId?: { matchId: string; participantId: number };
          };
          data: Record<string, unknown>;
        }) => {
          const participant = store.participants.find((row) =>
            where.id
              ? row.id === where.id
              : row.matchId === where.matchId_participantId?.matchId &&
                row.participantId === where.matchId_participantId?.participantId,
          );
          if (participant) {
            Object.assign(participant, data);
          }
          return participant;
        },
      ),
    },
    playerAccount: {
      findUnique: vi.fn(async ({ where }: { where: { id: string }; select?: unknown }) => {
        return store.accounts.find((account) => account.id === where.id) ?? null;
      }),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { provider?: string; externalAccountId?: { in: string[] }; id?: { in: string[] } };
        }) => {
          if (where.id?.in) {
            return store.accounts.filter((account) => where.id!.in.includes(account.id));
          }
          return store.accounts.filter(
            (account) =>
              account.provider === where.provider &&
              (where.externalAccountId?.in ?? []).includes(account.externalAccountId),
          );
        },
      ),
    },
    rankSnapshot: {
      findMany: rankSnapshotFindMany,
    },
    championAggregationProcessing: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    championAggregationRecalcScope: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Recalc-scope upsert uses an interactive transaction (findUnique + upsert).
      const championAggregationRecalcScope = {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      };
      const tx = {
        championAggregationRecalcScope,
        match: {
          findUnique: vi.fn(
            async ({
              where,
              select,
            }: {
              where: { id: string };
              select?: { ingestedAt?: boolean };
            }) => {
              for (const match of store.matches.values()) {
                if (match.id === where.id) {
                  if (select?.ingestedAt) {
                    return { ingestedAt: match.ingestedAt ?? null };
                  }
                  return match;
                }
              }
              return null;
            },
          ),
          upsert: vi.fn(
            async ({
              where,
              create,
              update,
            }: {
              where: { provider_externalMatchId: { provider: string; externalMatchId: string } };
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }) => {
              const key = matchKey(
                where.provider_externalMatchId.provider,
                where.provider_externalMatchId.externalMatchId,
              );
              const existing = store.matches.get(key);
              if (existing) {
                const next = { ...existing, ...update };
                store.matches.set(key, next);
                return next;
              }
              const created = {
                // UUID required by champion-aggregation job payload schema.
                id: `11111111-1111-4111-8111-${String(store.matches.size + 1).padStart(12, '0')}`,
                createdAt: create.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
                ...create,
              };
              store.matches.set(key, created);
              return created;
            },
          ),
          update: vi.fn(
            async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              for (const [key, match] of store.matches.entries()) {
                if (match.id === where.id) {
                  const next = { ...match, ...data };
                  store.matches.set(key, next);
                  return next;
                }
              }
              return data;
            },
          ),
        },
        matchTeam: {
          upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
            store.teams.push(create);
            return create;
          }),
        },
        matchParticipant: {
          upsert: vi.fn(
            async ({
              create,
              update,
              where,
            }: {
              create: Record<string, unknown>;
              update: Record<string, unknown>;
              where: { matchId_participantId: { matchId: string; participantId: number } };
            }) => {
              const existing = store.participants.find(
                (row) =>
                  row.matchId === where.matchId_participantId.matchId &&
                  row.participantId === where.matchId_participantId.participantId,
              );
              if (existing) {
                Object.assign(existing, update);
                return existing;
              }
              const row = { id: `part-${store.participants.length + 1}`, ...create };
              store.participants.push(row);
              return row;
            },
          ),
          update: vi.fn(
            async ({
              where,
              data,
            }: {
              where: { matchId_participantId: { matchId: string; participantId: number } };
              data: Record<string, unknown>;
            }) => {
              const existing = store.participants.find(
                (row) =>
                  row.matchId === where.matchId_participantId.matchId &&
                  row.participantId === where.matchId_participantId.participantId,
              );
              if (existing) {
                Object.assign(existing, data);
              }
              return existing;
            },
          ),
        },
        matchTimeline: {
          upsert: vi.fn(
            async ({
              create,
              update,
              where,
            }: {
              create: Record<string, unknown>;
              update: Record<string, unknown>;
              where: { matchId: string };
            }) => {
              const existing = store.timelines.get(where.matchId);
              if (existing) {
                const next = { ...existing, ...update };
                store.timelines.set(where.matchId, next);
                return next;
              }
              store.timelines.set(where.matchId, create);
              return create;
            },
          ),
        },
        matchTimelineEvent: {
          deleteMany: vi.fn(async ({ where }: { where: { matchId: string } }) => {
            const before = store.timelineEvents.length;
            store.timelineEvents = store.timelineEvents.filter(
              (row) => row.matchId !== where.matchId,
            );
            return { count: before - store.timelineEvents.length };
          }),
          createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
            store.timelineEvents.push(...data);
            return { count: data.length };
          }),
        },
        matchTimelineFrame: {
          deleteMany: vi.fn(async ({ where }: { where: { matchId: string } }) => {
            const before = store.timelineFrames.length;
            store.timelineFrames = store.timelineFrames.filter(
              (row) => row.matchId !== where.matchId,
            );
            return { count: before - store.timelineFrames.length };
          }),
          createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
            store.timelineFrames.push(...data);
            return { count: data.length };
          }),
        },
        rankSnapshot: {
          findMany: rankSnapshotFindMany,
        },
      };
      return fn(tx);
    }),
  };
}

describe('processMatchIngestionJob', () => {
  let store: Store;
  let prisma: ReturnType<typeof createPrismaMock>;
  let redis: { del: ReturnType<typeof vi.fn> };
  let provider: {
    getMatch: ReturnType<typeof vi.fn>;
    getTimeline: ReturnType<typeof vi.fn>;
  };
  let championAggregationQueue: ReturnType<typeof createChampionAggregationQueueMock>;

  beforeEach(() => {
    expandMatchParticipantsSafeMock.mockReset();
    expandMatchParticipantsSafeMock.mockResolvedValue({
      skipped: true,
      reason: 'disabled',
    } as never);
    store = {
      jobs: new Map(),
      matches: new Map(),
      participants: [],
      teams: [],
      timelines: new Map(),
      timelineEvents: [],
      timelineFrames: [],
      snapshots: [],
      accounts: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          playerId: 'player-root',
          provider: 'RIOT',
          externalAccountId: FAKE_PUUID,
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          playerId: 'player-2',
          provider: 'RIOT',
          externalAccountId: buildPuuid(1),
        },
      ],
    };
    prisma = createPrismaMock(store);
    redis = { del: vi.fn().mockResolvedValue(1) };
    provider = {
      getMatch: vi.fn().mockResolvedValue(buildRankedMatchDto()),
      getTimeline: vi.fn().mockResolvedValue(buildRichTimelineDto()),
    };
    championAggregationQueue = createChampionAggregationQueueMock();
  });

  it('rejects invalid payload before provider call', async () => {
    const job = makeJob({ bad: true });
    await expect(
      processMatchIngestionJob(
        job,
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(championAggregationQueue.add).not.toHaveBeenCalled();
  });

  it('consumes a valid job through running → completed', async () => {
    const payload = validPayload();
    const job = makeJob(payload);

    const result = await processMatchIngestionJob(
      job,
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('completed');
    expect(provider.getMatch).toHaveBeenCalledWith(payload.externalMatchId, 'americas');
    expect(provider.getTimeline).toHaveBeenCalled();
    expect(store.participants).toHaveLength(10);
    expect(store.teams).toHaveLength(2);
    expect(championAggregationQueue.add).toHaveBeenCalledTimes(1);
    // Scope upsert runs inside $transaction (merge-on-upsert).
    expect(prisma.$transaction).toHaveBeenCalled();

    const durable = [...store.jobs.values()][0];
    expect(durable?.status).toBe(IngestionJobStatus.COMPLETED);

    const match = [...store.matches.values()][0];
    expect(match?.ingestionStatus).toBe(MatchIngestionStatus.COMPLETED);

    // Known accounts linked; unknown remain null.
    const linked = store.participants.filter((participant) => participant.playerAccountId);
    expect(linked.length).toBe(2);
    const unknown = store.participants.filter(
      (participant) =>
        participant.externalAccountId === buildPuuid(2) && participant.playerAccountId == null,
    );
    expect(unknown).toHaveLength(1);
  });

  it('does not fail ingestion when champion aggregation enqueue fails', async () => {
    championAggregationQueue.add.mockRejectedValue(new Error('redis down'));
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload()),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('invokes participant expansion after newly completed match', async () => {
    const payload = validPayload({
      sourceCollectorRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const result = await processMatchIngestionJob(
      makeJob(payload),
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('completed');
    expect(expandMatchParticipantsSafeMock).toHaveBeenCalledTimes(1);
    expect(expandMatchParticipantsSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: expect.any(String),
        requestedByPlayerAccountId: payload.requestedByPlayerAccountId,
        sourceCollectorRunId: payload.sourceCollectorRunId,
      }),
    );
  });

  it('invokes participant expansion on already_complete path', async () => {
    const payload = validPayload({
      sourceCollectorRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const existingMatchId = '22222222-2222-4222-8222-222222222222';
    store.matches.set(`RIOT:${payload.externalMatchId}`, {
      id: existingMatchId,
      provider: 'RIOT',
      externalMatchId: payload.externalMatchId,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
    });
    store.participants.push({
      id: 'part-existing',
      matchId: existingMatchId,
      participantId: 1,
      playerAccountId: null,
      externalAccountId: FAKE_PUUID,
    });

    const result = await processMatchIngestionJob(
      makeJob(payload),
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('already_complete');
    expect(expandMatchParticipantsSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: existingMatchId,
        sourceCollectorRunId: payload.sourceCollectorRunId,
      }),
    );
  });

  it('does not fail ingestion when participant expansion reports error', async () => {
    expandMatchParticipantsSafeMock.mockResolvedValue({
      skipped: true,
      reason: 'error',
    } as never);
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload()),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).resolves.toMatchObject({ status: 'completed' });

    const durable = [...store.jobs.values()][0];
    expect(durable?.status).toBe(IngestionJobStatus.COMPLETED);
    const match = [...store.matches.values()][0];
    expect(match?.ingestionStatus).toBe(MatchIngestionStatus.COMPLETED);
    expect(championAggregationQueue.add).toHaveBeenCalled();
  });

  it('does not refetch when match already completed at same normalization version', async () => {
    const payload = validPayload();
    const existingMatchId = '22222222-2222-4222-8222-222222222222';
    store.matches.set(`RIOT:${payload.externalMatchId}`, {
      id: existingMatchId,
      provider: 'RIOT',
      externalMatchId: payload.externalMatchId,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
    });
    store.participants.push({
      id: 'part-existing',
      matchId: existingMatchId,
      participantId: 1,
      playerAccountId: null,
      externalAccountId: FAKE_PUUID,
    });

    const result = await processMatchIngestionJob(
      makeJob(payload),
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('already_complete');
    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(store.participants[0]?.playerAccountId).toBe('11111111-1111-1111-1111-111111111111');
    // Marker absent → enqueue aggregation for lost-enqueue repair.
    expect(championAggregationQueue.add).toHaveBeenCalledTimes(1);
  });

  it('refetches completed match when requesting player PUUID is absent from participants', async () => {
    const payload = validPayload();
    const existingMatchId = '33333333-3333-4333-8333-333333333333';
    store.matches.set(`RIOT:${payload.externalMatchId}`, {
      id: existingMatchId,
      provider: 'RIOT',
      externalMatchId: payload.externalMatchId,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
    });
    store.participants.push({
      id: 'part-wrong-puuid',
      matchId: existingMatchId,
      participantId: 1,
      playerAccountId: null,
      externalAccountId: 'a'.repeat(78),
    });

    const result = await processMatchIngestionJob(
      makeJob(payload),
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('completed');
    expect(provider.getMatch).toHaveBeenCalledTimes(1);
    // forceOverwrite must replace stale PUUIDs so progress can link the account.
    expect(store.participants.some((row) => row.externalAccountId === FAKE_PUUID)).toBe(true);
    expect(store.participants.some((row) => row.externalAccountId === 'a'.repeat(78))).toBe(
      false,
    );
  });

  it('dedupes participants on duplicate retry', async () => {
    const payload = validPayload();
    const deps = makeDeps({ prisma, provider, redis, championAggregationQueue });

    await processMatchIngestionJob(makeJob(payload), 'token', deps);
    await processMatchIngestionJob(makeJob(payload, { attemptsMade: 1 }), 'token', deps);

    // Second call hits already-complete path; still only 10 participants.
    expect(store.participants).toHaveLength(10);
    expect(provider.getMatch).toHaveBeenCalledTimes(1);
  });

  it('does not fail ingestion when cache invalidation fails', async () => {
    redis.del.mockRejectedValue(new Error('redis unavailable'));
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload()),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('delays on 429 without sleeping in-process', async () => {
    provider.getMatch.mockRejectedValue(
      new ProviderRateLimitedError('slow down', { retryAfterSeconds: 5 }),
    );
    const job = makeJob(validPayload());
    const sharedCooldown = mockSharedCooldown();

    await expect(
      processMatchIngestionJob(
        job,
        'token-1',
        makeDeps({ prisma, provider, redis, championAggregationQueue, sharedCooldown }),
      ),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalled();
    expect(sharedCooldown.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredFloorMs: 15 * 60_000,
        retryAfterMs: 5_000,
        source: 'worker',
      }),
    );
    expect(championAggregationQueue.add).not.toHaveBeenCalled();
  });

  it('shared cooldown precheck delays before getMatch', async () => {
    const sharedCooldown = mockSharedCooldown({ remainingMs: 40_000 });
    const job = makeJob(validPayload());

    await expect(
      processMatchIngestionJob(
        job,
        'token-1',
        makeDeps({ prisma, provider, redis, championAggregationQueue, sharedCooldown }),
      ),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(sharedCooldown.extendCooldown).not.toHaveBeenCalled();
    const delayedAt = (job.moveToDelayed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number;
    expect(delayedAt - Date.now()).toBeGreaterThanOrEqual(35_000);
  });

  it('timeline 429 soft-fail still publishes shared cooldown', async () => {
    provider.getMatch.mockResolvedValue(mockMatchDto({ matchId: 'NA1_FAKE_MATCH_1001' }));
    provider.getTimeline.mockRejectedValue(
      new ProviderRateLimitedError('timeline limited', { retryAfterSeconds: 12 }),
    );
    const sharedCooldown = mockSharedCooldown();

    const result = await processMatchIngestionJob(
      makeJob(validPayload({ externalMatchId: 'NA1_FAKE_MATCH_1001' })),
      'token',
      makeDeps({
        prisma,
        provider,
        redis,
        championAggregationQueue,
        sharedCooldown,
        config: baseConfig({ timelineRequiredForComplete: false }),
      }),
    );

    expect(result.status).toBe('completed');
    expect(sharedCooldown.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        retryAfterMs: 12_000,
        source: 'worker',
      }),
    );
    const match = [...store.matches.values()][0];
    expect(match?.ingestionStatus).toBe(MatchIngestionStatus.COMPLETED);
    const timeline = store.timelines.get(String(match?.id));
    expect(timeline?.fetchStatus).toBe(TimelineFetchStatus.FAILED);
    expect(timeline?.productCoverage).toBe('NONE');
    expect(store.timelineFrames).toHaveLength(0);
  });

  it('non-429 errors do not publish shared cooldown', async () => {
    provider.getMatch.mockRejectedValue(new ProviderUnavailableError());
    const sharedCooldown = mockSharedCooldown();
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload()),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue, sharedCooldown }),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(sharedCooldown.extendCooldown).not.toHaveBeenCalled();
  });

  it('retries on provider unavailable', async () => {
    provider.getMatch.mockRejectedValue(new ProviderUnavailableError());
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload()),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    const durable = [...store.jobs.values()][0];
    expect(durable?.status).toBe(IngestionJobStatus.FAILED);
    expect(championAggregationQueue.add).not.toHaveBeenCalled();
  });

  it('marks 404 as permanent / dead-lettered', async () => {
    provider.getMatch.mockRejectedValue(new ResourceNotFoundError('missing match'));
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload()),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const durable = [...store.jobs.values()][0];
    expect(durable?.status).toBe(IngestionJobStatus.DEAD_LETTERED);
  });

  it('dead-letters after exhausted retryable attempts', async () => {
    provider.getMatch.mockRejectedValue(new ProviderUnavailableError());
    await expect(
      processMatchIngestionJob(
        makeJob(validPayload(), { attemptsMade: 4, attempts: 5 }),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const durable = [...store.jobs.values()][0];
    expect(durable?.status).toBe(IngestionJobStatus.DEAD_LETTERED);
  });

  it('keeps match data when timeline fails and timeline is not required', async () => {
    provider.getMatch.mockResolvedValue(mockMatchDto({ matchId: 'NA1_FAKE_MATCH_1001' }));
    provider.getTimeline.mockRejectedValue(new ResourceNotFoundError('no timeline'));

    const result = await processMatchIngestionJob(
      makeJob(validPayload({ externalMatchId: 'NA1_FAKE_MATCH_1001' })),
      'token',
      makeDeps({
        prisma,
        provider,
        redis,
        championAggregationQueue,
        config: baseConfig({ timelineRequiredForComplete: false }),
      }),
    );

    expect(result.status).toBe('completed');
    const match = [...store.matches.values()][0];
    expect(match?.ingestionStatus).toBe(MatchIngestionStatus.COMPLETED);
    const timeline = store.timelines.get(String(match?.id));
    expect(timeline?.fetchStatus).toBe(TimelineFetchStatus.FAILED);
    expect(timeline?.productCoverage).toBe('NONE');
    expect(store.timelineFrames).toHaveLength(0);
  });

  it('persists product frames and kill events once for an eligible ranked match', async () => {
    const result = await processMatchIngestionJob(
      makeJob(validPayload()),
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('completed');
    expect(provider.getTimeline).toHaveBeenCalledTimes(1);
    expect(championAggregationQueue.add).toHaveBeenCalledTimes(1);

    const match = [...store.matches.values()][0];
    const timeline = store.timelines.get(String(match?.id));
    expect(timeline?.productCoverage).toBe('STORED');
    expect(timeline?.frameIntervalMs).toBe(60_000);
    expect(timeline?.productNormalizedAt).toBeInstanceOf(Date);
    expect(store.timelineFrames).toHaveLength(30);
    expect(store.timelineEvents.some((row) => row.type === 'CHAMPION_KILL')).toBe(true);
    expect(store.timelineEvents.some((row) => row.type === 'ITEM_PURCHASED')).toBe(true);
  });

  it('omits product frames and kill events when no participants are linked', async () => {
    store.accounts = [];

    const result = await processMatchIngestionJob(
      makeJob(validPayload()),
      'token',
      makeDeps({ prisma, provider, redis, championAggregationQueue }),
    );

    expect(result.status).toBe('completed');
    expect(provider.getTimeline).toHaveBeenCalledTimes(1);
    expect(championAggregationQueue.add).toHaveBeenCalledTimes(1);

    const match = [...store.matches.values()][0];
    const timeline = store.timelines.get(String(match?.id));
    expect(timeline?.productCoverage).toBe('INELIGIBLE');
    expect(store.timelineFrames).toHaveLength(0);
    expect(store.timelineEvents.some((row) => row.type === 'CHAMPION_KILL')).toBe(false);
    expect(store.timelineEvents.some((row) => row.type === 'ELITE_MONSTER_KILL')).toBe(false);
    expect(store.timelineEvents.some((row) => row.type === 'BUILDING_KILL')).toBe(false);
    expect(store.timelineEvents.some((row) => row.type === 'ITEM_PURCHASED')).toBe(true);
    expect(store.timelineEvents.some((row) => row.type === 'SKILL_LEVEL_UP')).toBe(true);
  });

  it('uses mockTimelineDto from server-riot when provided', async () => {
    provider.getMatch.mockResolvedValue(mockMatchDto({ matchId: 'NA1_FAKE_MATCH_1001' }));
    provider.getTimeline.mockResolvedValue(mockTimelineDto({ matchId: 'NA1_FAKE_MATCH_1001' }));

    await expect(
      processMatchIngestionJob(
        makeJob(validPayload({ externalMatchId: 'NA1_FAKE_MATCH_1001' })),
        'token',
        makeDeps({ prisma, provider, redis, championAggregationQueue }),
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });
});
