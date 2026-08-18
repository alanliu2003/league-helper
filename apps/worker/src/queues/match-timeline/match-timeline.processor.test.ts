import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { TimelineFetchStatus, TimelineProductCoverage } from '@prisma/client';
import {
  MATCH_TIMELINE_JOB_NAME,
  ProviderRateLimitedError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  type MatchTimelineJobPayload,
} from '@league-helper/shared';
import { persistTimelineAndMetrics } from '../match-ingestion/match-persistence.js';
import { buildRichTimelineDto } from '../match-ingestion/test-utils/ranked-match-fixture.js';
import type { MatchTimelineWorkerConfig } from '../../config.js';
import { processMatchTimelineJob } from './match-timeline.processor.js';

vi.mock('../match-ingestion/match-persistence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../match-ingestion/match-persistence.js')>();
  return {
    ...actual,
    persistTimelineAndMetrics: vi.fn().mockResolvedValue(undefined),
  };
});

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const EXTERNAL_MATCH_ID = 'NA1_FAKE_MATCH_RANKED_10';

function baseConfig(
  overrides: Partial<MatchTimelineWorkerConfig> = {},
): MatchTimelineWorkerConfig {
  return {
    queueName: 'match-timeline',
    concurrency: 1,
    jobAttempts: 5,
    backoffBaseMs: 2000,
    backoffMaxMs: 60_000,
    riotShared429CooldownMinMs: 15 * 60_000,
    storeRawPayloads: false,
    ...overrides,
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
    extendCooldown: vi.fn().mockImplementation(
      async (input: { now: number; configuredFloorMs: number; retryAfterMs?: number | null }) => {
        const until = input.now + Math.max(input.configuredFloorMs, input.retryAfterMs ?? 0);
        return { cooldownUntil: until, extended: true, previousCooldownUntil: null };
      },
    ),
    getCooldownState: vi.fn().mockResolvedValue({
      cooldownUntil: remainingMs > 0 ? Date.now() + remainingMs : null,
    }),
  };
}

function makeParticipants(input: { eligible: boolean }) {
  return Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    teamPosition: (['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const)[index % 5]!,
    kills: index,
    assists: 1,
    playerAccountId: input.eligible && index === 0 ? 'acct-1' : null,
  }));
}

function makeMatchRow(
  overrides: {
    timeline?: { productCoverage: string; fetchStatus: string } | null;
    eligible?: boolean;
  } = {},
) {
  return {
    id: MATCH_ID,
    externalMatchId: EXTERNAL_MATCH_ID,
    regionalRoute: 'americas' as const,
    ingestionStatus: 'COMPLETED',
    timeline:
      overrides.timeline === undefined
        ? { productCoverage: TimelineProductCoverage.NONE, fetchStatus: TimelineFetchStatus.FETCHED }
        : overrides.timeline,
    participants: makeParticipants({ eligible: overrides.eligible ?? true }),
  };
}

function makePrisma(match: ReturnType<typeof makeMatchRow> | null) {
  return {
    match: {
      findUnique: vi.fn().mockResolvedValue(match),
    },
  };
}

function makeJob(
  data: unknown,
  opts: { id?: string; name?: string; attemptsMade?: number; attempts?: number } = {},
): Job<MatchTimelineJobPayload> {
  return {
    id: opts.id ?? `tl_${MATCH_ID}`,
    name: opts.name ?? MATCH_TIMELINE_JOB_NAME,
    data: data as MatchTimelineJobPayload,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 5 },
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<MatchTimelineJobPayload>;
}

function validPayload(overrides: Partial<MatchTimelineJobPayload> = {}): MatchTimelineJobPayload {
  return {
    matchId: MATCH_ID,
    correlationId: 'corr-tl-1',
    ...overrides,
  };
}

describe('processMatchTimelineJob', () => {
  const persistMock = vi.mocked(persistTimelineAndMetrics);

  beforeEach(() => {
    persistMock.mockReset();
    persistMock.mockResolvedValue(undefined);
  });

  it('throws UnrecoverableError for unknown matchId without calling getTimeline', async () => {
    const provider = { getTimeline: vi.fn(), getMatch: vi.fn() };
    const prisma = makePrisma(null);

    await expect(
      processMatchTimelineJob(makeJob(validPayload()), 'token', {
        prisma: prisma as never,
        provider: provider as never,
        config: baseConfig(),
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(provider.getTimeline).not.toHaveBeenCalled();
    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError for invalid payload that is not a uuid', async () => {
    const provider = { getTimeline: vi.fn(), getMatch: vi.fn() };

    await expect(
      processMatchTimelineJob(makeJob({ matchId: 'NA1_123456789' }), 'token', {
        prisma: makePrisma(makeMatchRow()) as never,
        provider: provider as never,
        config: baseConfig(),
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(provider.getTimeline).not.toHaveBeenCalled();
    expect(provider.getMatch).not.toHaveBeenCalled();
  });

  it('skips getTimeline when productCoverage is STORED', async () => {
    const provider = { getTimeline: vi.fn(), getMatch: vi.fn() };

    const result = await processMatchTimelineJob(makeJob(validPayload()), 'token', {
      prisma: makePrisma(
        makeMatchRow({
          timeline: {
            productCoverage: TimelineProductCoverage.STORED,
            fetchStatus: TimelineFetchStatus.FETCHED,
          },
        }),
      ) as never,
      provider: provider as never,
      config: baseConfig(),
    });

    expect(result.status).toBe('skipped');
    expect(provider.getTimeline).not.toHaveBeenCalled();
    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('fetches timeline once and persists STORED product rows for FETCHED + NONE + eligible', async () => {
    const provider = {
      getTimeline: vi.fn().mockResolvedValue(buildRichTimelineDto()),
      getMatch: vi.fn(),
    };

    const result = await processMatchTimelineJob(makeJob(validPayload()), 'token', {
      prisma: makePrisma(makeMatchRow()) as never,
      provider: provider as never,
      config: baseConfig(),
    });

    expect(result.status).toBe('completed');
    expect(provider.getTimeline).toHaveBeenCalledTimes(1);
    expect(provider.getTimeline).toHaveBeenCalledWith(EXTERNAL_MATCH_ID, 'americas');
    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(persistMock).toHaveBeenCalledTimes(1);

    const persistArg = persistMock.mock.calls[0]![0];
    expect(persistArg.matchId).toBe(MATCH_ID);
    expect(persistArg.fetchStatus).toBe(TimelineFetchStatus.FETCHED);
    expect(persistArg.productCoverage).toBe(TimelineProductCoverage.STORED);
    expect(persistArg.markMatchCompleted).toBe(false);
    expect(persistArg.frames?.length).toBeGreaterThan(0);
    expect(persistArg.buildEvents?.some((event) => event.type === 'CHAMPION_KILL')).toBe(true);
    expect(persistArg.buildEvents?.some((event) => event.type === 'ELITE_MONSTER_KILL')).toBe(
      true,
    );
    expect(persistArg.metrics.length).toBeGreaterThan(0);
  });

  it('skips persist and Riot when ineligible and includeIneligible is omitted', async () => {
    const provider = { getTimeline: vi.fn(), getMatch: vi.fn() };

    const result = await processMatchTimelineJob(makeJob(validPayload()), 'token', {
      prisma: makePrisma(makeMatchRow({ eligible: false })) as never,
      provider: provider as never,
      config: baseConfig(),
    });

    expect(result.status).toBe('skipped');
    expect(provider.getTimeline).not.toHaveBeenCalled();
    expect(provider.getMatch).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('skips persist and Riot when ineligible and includeIneligible is false', async () => {
    const provider = { getTimeline: vi.fn(), getMatch: vi.fn() };

    const result = await processMatchTimelineJob(
      makeJob(validPayload({ includeIneligible: false })),
      'token',
      {
        prisma: makePrisma(makeMatchRow({ eligible: false })) as never,
        provider: provider as never,
        config: baseConfig(),
      },
    );

    expect(result.status).toBe('skipped');
    expect(provider.getTimeline).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('fetches and persists STORED product rows when ineligible and includeIneligible is true', async () => {
    const provider = {
      getTimeline: vi.fn().mockResolvedValue(buildRichTimelineDto()),
      getMatch: vi.fn(),
    };

    const result = await processMatchTimelineJob(
      makeJob(validPayload({ includeIneligible: true })),
      'token',
      {
        prisma: makePrisma(makeMatchRow({ eligible: false })) as never,
        provider: provider as never,
        config: baseConfig(),
      },
    );

    expect(result.status).toBe('completed');
    expect(provider.getTimeline).toHaveBeenCalledTimes(1);
    expect(provider.getMatch).not.toHaveBeenCalled();

    const persistArg = persistMock.mock.calls[0]![0];
    expect(persistArg.productCoverage).toBe(TimelineProductCoverage.STORED);
    expect(persistArg.markMatchCompleted).toBe(false);
    expect(persistArg.frames?.length).toBeGreaterThan(0);
    expect(persistArg.buildEvents?.some((event) => event.type === 'CHAMPION_KILL')).toBe(true);
  });

  it('persists FAILED + NONE and throws UnrecoverableError on timeline 404', async () => {
    const provider = {
      getTimeline: vi.fn().mockRejectedValue(new ResourceNotFoundError('timeline missing')),
      getMatch: vi.fn(),
    };

    await expect(
      processMatchTimelineJob(makeJob(validPayload()), 'token', {
        prisma: makePrisma(makeMatchRow()) as never,
        provider: provider as never,
        config: baseConfig(),
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(provider.getTimeline).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: MATCH_ID,
        fetchStatus: TimelineFetchStatus.FAILED,
        productCoverage: TimelineProductCoverage.NONE,
        markMatchCompleted: false,
      }),
    );
  });

  it('publishes shared cooldown and delays on 429', async () => {
    const provider = {
      getTimeline: vi
        .fn()
        .mockRejectedValue(new ProviderRateLimitedError('slow down', { retryAfterSeconds: 5 })),
      getMatch: vi.fn(),
    };
    const sharedCooldown = mockSharedCooldown();
    const job = makeJob(validPayload());

    await expect(
      processMatchTimelineJob(job, 'token-1', {
        prisma: makePrisma(makeMatchRow()) as never,
        provider: provider as never,
        config: baseConfig(),
        sharedCooldown: sharedCooldown as never,
      }),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalled();
    expect(sharedCooldown.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredFloorMs: 15 * 60_000,
        retryAfterMs: 5_000,
        source: 'worker',
      }),
    );
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('rethrows 5xx as retryable without UnrecoverableError', async () => {
    const provider = {
      getTimeline: vi.fn().mockRejectedValue(new ProviderUnavailableError('gateway 503')),
      getMatch: vi.fn(),
    };

    await expect(
      processMatchTimelineJob(makeJob(validPayload()), 'token', {
        prisma: makePrisma(makeMatchRow()) as never,
        provider: provider as never,
        config: baseConfig(),
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    await expect(
      processMatchTimelineJob(makeJob(validPayload()), 'token', {
        prisma: makePrisma(makeMatchRow()) as never,
        provider: provider as never,
        config: baseConfig(),
      }),
    ).rejects.not.toBeInstanceOf(UnrecoverableError);

    expect(persistMock).not.toHaveBeenCalled();
  });
});
