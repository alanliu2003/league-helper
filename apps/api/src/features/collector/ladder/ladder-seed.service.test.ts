import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LadderCandidate, LadderEntriesPageResult } from '@league-helper/server-riot';
import { ProviderRateLimitedError } from '@league-helper/shared';
import { loadCollectorConfig, type CollectorConfig } from '../collector.config';
import type { LadderEnrollmentService } from './ladder-enrollment.service';
import {
  LadderSeedService,
  type LadderSeedProvider,
} from './ladder-seed.service';

function baseConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    ...loadCollectorConfig({}),
    ladderMaxNewPerRun: 10,
    ladderMaxCandidatesScanned: 100,
    ladderMaxPagesPerTierDivision: 3,
    platformAllowlist: ['na1'],
    ladderPlatform: null,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<LadderCandidate> & Pick<LadderCandidate, 'puuid' | 'tier'>,
): LadderCandidate {
  return {
    provider: 'RIOT',
    platformRoute: 'na1',
    leagueQueueType: 'RANKED_SOLO_5x5',
    matchQueueId: 420,
    division: null,
    riotIdGameName: null,
    riotIdTagLine: null,
    acquisitionMode: overrides.acquisitionMode ?? 'APEX',
    page: overrides.page ?? null,
    ...overrides,
  };
}

function pageResult(
  candidates: LadderCandidate[],
  page = 1,
  pageExhausted = false,
): LadderEntriesPageResult {
  return { candidates, skippedIncompleteIdentity: 0, page, pageExhausted };
}

type EnrollMock = ReturnType<typeof vi.fn>;

function createHarness(input: {
  config?: CollectorConfig;
  provider: LadderSeedProvider;
  enroll?: EnrollMock;
  existingAccounts?: Map<string, { id: string; currentGameName: string | null; currentTagLine: string | null }>;
  trackedAccountIds?: Set<string>;
  sharedCooldown?: {
    isCoolingDown: ReturnType<typeof vi.fn>;
    extendCooldown: ReturnType<typeof vi.fn>;
  };
}) {
  const enroll =
    input.enroll ??
    vi.fn(async () => ({
      outcome: 'created' as const,
      trackedPlayerId: 'tp-1',
      playerAccountId: 'pa-1',
      enrollmentSource: 'LADDER' as const,
      discoveryDepth: 0,
    }));

  const enrollment = {
    enrollLadderCandidate: enroll,
  } as unknown as LadderEnrollmentService;

  const accounts = input.existingAccounts ?? new Map();
  const tracked = input.trackedAccountIds ?? new Set<string>();

  const playerAccounts = {
    findByProviderExternalId: vi.fn(async (_provider: string, puuid: string) => {
      return accounts.get(puuid) ?? null;
    }),
  };

  const prisma = {
    trackedPlayer: {
      findUnique: vi.fn(async ({ where }: { where: { playerAccountId: string } }) => {
        if (tracked.has(where.playerAccountId)) {
          return { id: 'tp-existing', playerAccountId: where.playerAccountId };
        }
        return null;
      }),
    },
  };

  const matchQueue = {
    add: vi.fn(),
    addBulk: vi.fn(),
  };

  const sharedCooldown =
    input.sharedCooldown ??
    ({
      isCoolingDown: vi.fn().mockResolvedValue(false),
      extendCooldown: vi.fn().mockResolvedValue({
        cooldownUntil: Date.now() + 15 * 60_000,
        extended: true,
        previousCooldownUntil: null,
      }),
    } as const);

  const service = LadderSeedService.create({
    prisma: prisma as never,
    playerAccounts: playerAccounts as never,
    enrollment,
    config: input.config ?? baseConfig(),
    gameData: input.provider,
    sharedCooldown: sharedCooldown as never,
  });

  return {
    service,
    enroll,
    playerAccounts,
    prisma,
    matchQueue,
    provider: input.provider,
    sharedCooldown,
  };
}

describe('LadderSeedService', () => {
  let getChallengerLeague: ReturnType<typeof vi.fn>;
  let getGrandmasterLeague: ReturnType<typeof vi.fn>;
  let getMasterLeague: ReturnType<typeof vi.fn>;
  let getLeagueEntriesByTierDivision: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getChallengerLeague = vi.fn(async () => ({
      candidates: [
        candidate({ puuid: 'chall-1', tier: 'CHALLENGER' }),
        candidate({ puuid: 'chall-2', tier: 'CHALLENGER' }),
      ],
      skippedIncompleteIdentity: 0,
    }));
    getGrandmasterLeague = vi.fn(async () => ({
      candidates: [candidate({ puuid: 'gm-1', tier: 'GRANDMASTER' })],
      skippedIncompleteIdentity: 0,
    }));
    getMasterLeague = vi.fn(async () => ({
      candidates: [candidate({ puuid: 'master-1', tier: 'MASTER' })],
      skippedIncompleteIdentity: 0,
    }));
    getLeagueEntriesByTierDivision = vi.fn(
      async (args: { tier: string; page: number }): Promise<LadderEntriesPageResult> => {
        if (args.page > 1) {
          return pageResult([], args.page, true);
        }
        return pageResult(
          [
            candidate({
              puuid: `rep-${args.tier}-1`,
              tier: args.tier as LadderCandidate['tier'],
              acquisitionMode: 'REPRESENTATIVE',
              page: args.page,
              division: 'I',
            }),
          ],
          args.page,
          false,
        );
      },
    );
  });

  function provider(): LadderSeedProvider {
    return {
      getChallengerLeague,
      getGrandmasterLeague,
      getMasterLeague,
      getLeagueEntriesByTierDivision,
    };
  }

  it('A: enrolls Challenger candidates', async () => {
    const { service, enroll } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(getChallengerLeague).toHaveBeenCalledTimes(1);
    expect(getGrandmasterLeague).not.toHaveBeenCalled();
    expect(enroll).toHaveBeenCalledTimes(2);
    expect(result.counters.created).toBe(2);
    expect(result.counters.apexCandidates).toBe(2);
    expect(result.counters.byTier.CHALLENGER).toBe(2);
  });

  it('B: enrolls Grandmaster candidates', async () => {
    const { service, enroll } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['GRANDMASTER'],
      dryRun: false,
    });

    expect(getGrandmasterLeague).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(result.counters.created).toBe(1);
    expect(result.counters.byTier.GRANDMASTER).toBe(1);
  });

  it('B2: enrolls Master candidates with preserved MASTER tier counter', async () => {
    const { service, enroll } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['MASTER'],
      dryRun: false,
    });

    expect(getMasterLeague).toHaveBeenCalledTimes(1);
    expect(getChallengerLeague).not.toHaveBeenCalled();
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(result.counters.created).toBe(1);
    expect(result.counters.byTier.MASTER).toBe(1);
    expect(result.counters.byTier.CHALLENGER).toBeUndefined();
  });

  it('C: enrolls representative page candidates', async () => {
    const { service, enroll } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'representative',
      tiers: ['DIAMOND'],
      division: 'I',
      page: 1,
      dryRun: false,
    });

    expect(getLeagueEntriesByTierDivision).toHaveBeenCalledTimes(1);
    expect(getLeagueEntriesByTierDivision).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'DIAMOND', division: 'I', page: 1 }),
    );
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(result.counters.created).toBe(1);
    expect(result.counters.representativeCandidates).toBe(1);
  });

  it('D: duplicate candidate does not consume capacity', async () => {
    getChallengerLeague.mockResolvedValue({
      candidates: [
        candidate({ puuid: 'dup-1', tier: 'CHALLENGER' }),
        candidate({ puuid: 'dup-1', tier: 'CHALLENGER' }),
        candidate({ puuid: 'dup-2', tier: 'CHALLENGER' }),
      ],
      skippedIncompleteIdentity: 0,
    });
    const { service, enroll } = createHarness({
      config: baseConfig({ ladderMaxNewPerRun: 2 }),
      provider: provider(),
    });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(enroll).toHaveBeenCalledTimes(2);
    expect(result.counters.created).toBe(2);
    expect(result.counters.fetched).toBe(3);
    expect(result.counters.eligible).toBe(2);
  });

  it('E: per-run create cap stops new creates', async () => {
    getChallengerLeague.mockResolvedValue({
      candidates: [
        candidate({ puuid: 'c1', tier: 'CHALLENGER' }),
        candidate({ puuid: 'c2', tier: 'CHALLENGER' }),
        candidate({ puuid: 'c3', tier: 'CHALLENGER' }),
      ],
      skippedIncompleteIdentity: 0,
    });
    const { service, enroll } = createHarness({
      config: baseConfig({ ladderMaxNewPerRun: 2 }),
      provider: provider(),
    });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(enroll).toHaveBeenCalledTimes(2);
    expect(result.counters.created).toBe(2);
    expect(result.stoppedReason).toBe('create_cap');
  });

  it('F: ladder total cap stops new creates', async () => {
    getChallengerLeague.mockResolvedValue({
      candidates: [
        candidate({ puuid: 'c1', tier: 'CHALLENGER' }),
        candidate({ puuid: 'c2', tier: 'CHALLENGER' }),
      ],
      skippedIncompleteIdentity: 0,
    });
    const enroll = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'created', trackedPlayerId: 'tp-1' })
      .mockResolvedValueOnce({ outcome: 'skippedLadderCap' });
    const { service } = createHarness({ provider: provider(), enroll });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(result.counters.created).toBe(1);
    expect(result.counters.skippedLadderCap).toBe(1);
    expect(result.stoppedReason).toBe('ladder_cap');
    expect(enroll).toHaveBeenCalledTimes(2);
  });

  it('G: total global cap stops new creates', async () => {
    getChallengerLeague.mockResolvedValue({
      candidates: [
        candidate({ puuid: 'c1', tier: 'CHALLENGER' }),
        candidate({ puuid: 'c2', tier: 'CHALLENGER' }),
      ],
      skippedIncompleteIdentity: 0,
    });
    const enroll = vi.fn().mockResolvedValue({ outcome: 'skippedTotalCap' });
    const { service } = createHarness({ provider: provider(), enroll });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(result.counters.skippedTotalCap).toBe(1);
    expect(result.stoppedReason).toBe('total_cap');
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it('H: missing identity / resolve failure handled', async () => {
    const enroll = vi.fn().mockResolvedValue({
      outcome: 'skippedIdentity',
      message: 'Account-v1 did not return usable Riot ID names.',
    });
    const { service } = createHarness({ provider: provider(), enroll });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(result.counters.skippedIdentity).toBe(2);
    expect(result.counters.identityResolveFailed).toBe(2);
    expect(result.counters.created).toBe(0);
  });

  it('I: Account-v1 failure increments error/skip', async () => {
    const enroll = vi.fn().mockResolvedValue({
      outcome: 'error',
      message: 'Account-v1 resolve failed.',
    });
    const { service } = createHarness({ provider: provider(), enroll });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(result.counters.errors).toBe(2);
    expect(result.counters.identityResolveFailed).toBe(2);
  });

  it('J: dry-run creates nothing', async () => {
    const { service, enroll, playerAccounts } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER', 'GRANDMASTER'],
      dryRun: true,
    });

    expect(enroll).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.counters.created).toBe(0);
    expect(result.counters.identityResolved).toBe(0);
    expect(result.counters.wouldNeedIdentityResolve).toBeGreaterThan(0);
    expect(result.counters.fetched).toBe(3);
    // Read-only lookups are allowed.
    expect(playerAccounts.findByProviderExternalId).toHaveBeenCalled();
  });

  it('J2: dry-run fetches Challenger + Grandmaster + Master without enrollment', async () => {
    const { service, enroll } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
      dryRun: true,
    });

    expect(getChallengerLeague).toHaveBeenCalledTimes(1);
    expect(getGrandmasterLeague).toHaveBeenCalledTimes(1);
    expect(getMasterLeague).toHaveBeenCalledTimes(1);
    expect(enroll).not.toHaveBeenCalled();
    expect(result.counters.created).toBe(0);
    expect(result.counters.providerCalls).toBe(3);
    expect(result.counters.byTier).toEqual({
      CHALLENGER: 2,
      GRANDMASTER: 1,
      MASTER: 1,
    });
    expect(result.counters.apexCandidates).toBe(4);
  });

  it('K: seeder does not enqueue match jobs', async () => {
    const { service, matchQueue, enroll } = createHarness({ provider: provider() });
    await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(enroll).toHaveBeenCalled();
    expect(matchQueue.add).not.toHaveBeenCalled();
    expect(matchQueue.addBulk).not.toHaveBeenCalled();
    // Service source must not wire ingest enqueue APIs.
    const source = readFileSync(resolve(__dirname, 'ladder-seed.service.ts'), 'utf8');
    expect(source).not.toMatch(/enqueueMatch|MatchIngestion|addBulk\(|Queue</);
    expect(source).not.toMatch(/PopulationCollectorService/);
    expect(source).not.toMatch(/\.runOnce\(/);
  });

  it('L: no unbounded pagination (spy call counts)', async () => {
    getLeagueEntriesByTierDivision.mockImplementation(
      async (args: { page: number }): Promise<LadderEntriesPageResult> => {
        return pageResult(
          [
            candidate({
              puuid: `p-${args.page}`,
              tier: 'DIAMOND',
              acquisitionMode: 'REPRESENTATIVE',
              page: args.page,
              division: 'I',
            }),
          ],
          args.page,
          false,
        );
      },
    );
    const { service } = createHarness({
      config: baseConfig({ ladderMaxPagesPerTierDivision: 2, ladderMaxNewPerRun: 100 }),
      provider: provider(),
    });
    const result = await service.seed({
      platform: 'na1',
      mode: 'representative',
      tiers: ['DIAMOND', 'EMERALD'],
      division: 'I',
      maxPagesPerDivision: 2,
      dryRun: false,
    });

    // 2 tiers × 2 pages = 4 calls max; never loops until create cap.
    expect(getLeagueEntriesByTierDivision).toHaveBeenCalledTimes(4);
    expect(result.counters.providerCalls).toBe(4);
    expect(result.pagesRequested).toEqual([1, 2]);
  });

  it('stops safely on provider 429 without retry-storm', async () => {
    getChallengerLeague.mockRejectedValue(new ProviderRateLimitedError('Riot rate limit exceeded.'));
    const { service, enroll } = createHarness({ provider: provider() });
    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER', 'GRANDMASTER'],
      dryRun: false,
    });

    expect(result.ok).toBe(false);
    expect(result.stoppedReason).toBe('rate_limited');
    expect(getChallengerLeague).toHaveBeenCalledTimes(1);
    expect(getGrandmasterLeague).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
  });

  // A–D: shared Riot cooldown coordination
  it('A: shared cooldown precheck skips dry-run and apply with zero Riot/DB work', async () => {
    const sharedCooldown = {
      isCoolingDown: vi.fn().mockResolvedValue(true),
      extendCooldown: vi.fn(),
    };
    const { service, enroll } = createHarness({ provider: provider(), sharedCooldown });

    for (const dryRun of [true, false] as const) {
      const result = await service.seed({
        platform: 'na1',
        mode: 'apex',
        tiers: ['CHALLENGER'],
        dryRun,
      });
      expect(result.ok).toBe(true);
      expect(result.stoppedReason).toBe('skipped_cooldown');
      expect(result.counters.providerCalls).toBe(0);
    }

    expect(getChallengerLeague).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
    expect(sharedCooldown.extendCooldown).not.toHaveBeenCalled();
  });

  it('B: ladder 429 publishes shared cooldown then stops rate_limited', async () => {
    getChallengerLeague.mockRejectedValue(
      new ProviderRateLimitedError('slow', { retryAfterSeconds: 30 }),
    );
    const sharedCooldown = {
      isCoolingDown: vi.fn().mockResolvedValue(false),
      extendCooldown: vi.fn().mockResolvedValue({
        cooldownUntil: Date.now() + 15 * 60_000,
        extended: true,
        previousCooldownUntil: null,
      }),
    };
    const { service } = createHarness({
      provider: provider(),
      sharedCooldown,
      config: baseConfig({ riotShared429CooldownMinMs: 15 * 60_000 }),
    });

    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: true,
    });

    expect(result.stoppedReason).toBe('rate_limited');
    expect(sharedCooldown.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredFloorMs: 15 * 60_000,
        retryAfterMs: 30_000,
        source: 'ladder',
      }),
    );
  });

  it('C: Retry-After longer than floor wins when publishing cooldown', async () => {
    getChallengerLeague.mockRejectedValue(
      new ProviderRateLimitedError('slow', { retryAfterSeconds: 1800 }),
    );
    const sharedCooldown = {
      isCoolingDown: vi.fn().mockResolvedValue(false),
      extendCooldown: vi.fn().mockResolvedValue({
        cooldownUntil: Date.now() + 1_800_000,
        extended: true,
        previousCooldownUntil: null,
      }),
    };
    const { service } = createHarness({
      provider: provider(),
      sharedCooldown,
      config: baseConfig({ riotShared429CooldownMinMs: 15 * 60_000 }),
    });

    await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(sharedCooldown.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredFloorMs: 15 * 60_000,
        retryAfterMs: 1_800_000,
        source: 'ladder',
      }),
    );
  });

  it('D: Account-v1 ProviderRateLimitedError during enroll publishes cooldown', async () => {
    getChallengerLeague.mockResolvedValue({
      candidates: [
        candidate({
          puuid: 'need-resolve',
          tier: 'CHALLENGER',
          riotIdGameName: null,
          riotIdTagLine: null,
        }),
      ],
      skippedIncompleteIdentity: 0,
    });
    const enroll = vi.fn(async () => {
      throw new ProviderRateLimitedError('account limited', { retryAfterSeconds: 90 });
    });
    const sharedCooldown = {
      isCoolingDown: vi.fn().mockResolvedValue(false),
      extendCooldown: vi.fn().mockResolvedValue({
        cooldownUntil: Date.now() + 15 * 60_000,
        extended: true,
        previousCooldownUntil: null,
      }),
    };
    const { service } = createHarness({
      provider: provider(),
      enroll,
      sharedCooldown,
      config: baseConfig({ riotShared429CooldownMinMs: 15 * 60_000 }),
    });

    const result = await service.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: false,
    });

    expect(result.stoppedReason).toBe('rate_limited');
    expect(result.ok).toBe(false);
    expect(sharedCooldown.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        retryAfterMs: 90_000,
        source: 'ladder',
      }),
    );
  });

  it('stops paging a tier/division when pageExhausted', async () => {
    getLeagueEntriesByTierDivision.mockImplementation(
      async (args: { page: number }): Promise<LadderEntriesPageResult> => {
        if (args.page === 1) {
          return pageResult(
            [candidate({ puuid: 'only', tier: 'GOLD', acquisitionMode: 'REPRESENTATIVE', page: 1 })],
            1,
            false,
          );
        }
        return pageResult([], args.page, true);
      },
    );
    const { service } = createHarness({
      config: baseConfig({ ladderMaxPagesPerTierDivision: 5 }),
      provider: provider(),
    });
    await service.seed({
      platform: 'na1',
      mode: 'representative',
      tiers: ['GOLD'],
      division: 'I',
      maxPagesPerDivision: 5,
      dryRun: true,
    });

    // page 1 + exhausted page 2; does not continue to 3..5
    expect(getLeagueEntriesByTierDivision).toHaveBeenCalledTimes(2);
  });

  it('AppModule / worker main do not import or call ladder-seed on boot', () => {
    const appModule = readFileSync(resolve(__dirname, '../../../app.module.ts'), 'utf8');
    const apiMain = readFileSync(resolve(__dirname, '../../../main.ts'), 'utf8');
    const workerMain = readFileSync(
      resolve(__dirname, '../../../../../worker/src/main.ts'),
      'utf8',
    );
    const collectorModule = readFileSync(resolve(__dirname, '../collector.module.ts'), 'utf8');

    for (const source of [appModule, apiMain, workerMain]) {
      expect(source).not.toMatch(/ladder-seed|LadderSeedService/);
    }
    // CollectorModule may register the service for DI, but must not invoke seed on import.
    expect(collectorModule).not.toMatch(/\.seed\(/);
    expect(collectorModule).not.toMatch(/ladder-seed\.ts/);
  });
});
