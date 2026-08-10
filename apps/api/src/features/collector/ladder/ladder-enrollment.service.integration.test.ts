import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PrismaClient,
  TrackedPlayerEnrollmentSource,
  TrackedPlayerStatus,
} from '@prisma/client';
import { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import { loadCollectorConfig, type CollectorConfig } from '../collector.config';
import {
  ensureTrackedPlayerBudgetSingleton,
  getTrackedPlayerBudgetUsage,
  reconcileTrackedPlayerBudgetFromRows,
  reserveTotalTrackedCreate,
} from './ladder-enrollment.budget';
import {
  LadderEnrollmentService,
  reserveAndCreateLadderTrackedPlayer,
} from './ladder-enrollment.service';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const PROVIDER = 'RIOT';
const PLATFORM = 'na1';

function baseConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  const totalCap = overrides.totalTrackedPlayersHardCap ?? 100;
  const ladderMaxTotal = Math.min(overrides.ladderMaxTotal ?? 50, totalCap);
  return {
    ...loadCollectorConfig({
      COLLECTOR_PLATFORM_ALLOWLIST: PLATFORM,
      COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP: String(totalCap),
      COLLECTOR_LADDER_MAX_TOTAL: String(ladderMaxTotal),
      COLLECTOR_LADDER_MAX_NEW_PER_RUN: String(Math.min(ladderMaxTotal, 50)),
    }),
    ...overrides,
    // Keep overrides consistent with validated env load above.
    totalTrackedPlayersHardCap: totalCap,
    ladderMaxTotal,
  };
}

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CollectorRun",
      "TrackedPlayer",
      "PlayerAccountAlias",
      "PlayerAccount",
      "Player"
    RESTART IDENTITY CASCADE;
  `);
  await prisma.collectorPopulationBudget.update({
    where: { id: 'singleton' },
    data: { matchParticipantEnrolledCount: 0 },
  });
  await prisma.collectorTrackedPlayerBudget.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      trackedPlayerCount: 0,
      ladderEnrolledCount: 0,
    },
    update: {
      trackedPlayerCount: 0,
      ladderEnrolledCount: 0,
    },
  });
}

async function seedAccount(suffix: string): Promise<{
  playerAccountId: string;
  puuid: string;
}> {
  const player = await prisma.player.create({ data: {} });
  const puuid = `puuid-${suffix}-${randomUUID().slice(0, 8)}`;
  const account = await prisma.playerAccount.create({
    data: {
      playerId: player.id,
      provider: PROVIDER,
      externalAccountId: puuid,
      platformRoute: PLATFORM,
      regionalRoute: 'americas',
      currentGameName: `Player${suffix}`,
      currentTagLine: 'NA1',
      normalizedGameName: `player${suffix}`.toLowerCase(),
      normalizedTagLine: 'na1',
    },
  });
  return { playerAccountId: account.id, puuid };
}

function createService(config: CollectorConfig = baseConfig()): LadderEnrollmentService {
  const playerAccounts = new PlayerAccountRepository(prisma as never);
  return LadderEnrollmentService.create({
    prisma,
    playerAccounts,
    config,
  });
}

describe('ladder enrollment service (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    await ensureTrackedPlayerBudgetSingleton(prisma);
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('A: two different candidates, one remaining GLOBAL slot → exactly one new TrackedPlayer', async () => {
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 4, ladderEnrolledCount: 0 },
    });
    const service = createService(
      baseConfig({ totalTrackedPlayersHardCap: 5, ladderMaxTotal: 50 }),
    );
    const a = await seedAccount('a-global');
    const b = await seedAccount('b-global');

    const results = await Promise.all([
      service.enrollLadderCandidate({ platformRoute: PLATFORM, puuid: a.puuid }),
      service.enrollLadderCandidate({ platformRoute: PLATFORM, puuid: b.puuid }),
    ]);

    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'skippedTotalCap')).toHaveLength(1);
    expect(await prisma.trackedPlayer.count()).toBe(1);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 5,
      ladderEnrolledCount: 1,
    });
  });

  it('B: two different candidates, one remaining LADDER slot → exactly one', async () => {
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 0, ladderEnrolledCount: 2 },
    });
    const service = createService(
      baseConfig({ totalTrackedPlayersHardCap: 100, ladderMaxTotal: 3 }),
    );
    const a = await seedAccount('a-ladder');
    const b = await seedAccount('b-ladder');

    const results = await Promise.all([
      service.enrollLadderCandidate({ platformRoute: PLATFORM, puuid: a.puuid }),
      service.enrollLadderCandidate({ platformRoute: PLATFORM, puuid: b.puuid }),
    ]);

    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'skippedLadderCap')).toHaveLength(1);
    expect(await prisma.trackedPlayer.count()).toBe(1);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 3,
    });
  });

  it('C: same PUUID concurrently enrolled twice → one TrackedPlayer, one capacity consumption', async () => {
    const service = createService(
      baseConfig({ totalTrackedPlayersHardCap: 100, ladderMaxTotal: 50 }),
    );
    const { puuid } = await seedAccount('same-puuid');

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.enrollLadderCandidate({ platformRoute: PLATFORM, puuid }),
      ),
    );

    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'alreadyTracked')).toHaveLength(5);
    expect(await prisma.trackedPlayer.count()).toBe(1);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 1,
    });
  });

  it('D: existing LADDER rediscovered → no additional capacity consumption', async () => {
    const service = createService();
    const { playerAccountId, puuid } = await seedAccount('existing-ladder');
    await prisma.trackedPlayer.create({
      data: {
        playerAccountId,
        provider: PROVIDER,
        platformRoute: PLATFORM,
        enrollmentSource: TrackedPlayerEnrollmentSource.LADDER,
        discoveryDepth: 0,
        status: TrackedPlayerStatus.ACTIVE,
        priority: 0,
        nextEligibleAt: new Date(),
      },
    });
    await reconcileTrackedPlayerBudgetFromRows(prisma);
    const before = await getTrackedPlayerBudgetUsage(prisma);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.enrollLadderCandidate({ platformRoute: PLATFORM, puuid }),
      ),
    );

    expect(results.every((r) => r.outcome === 'alreadyTracked')).toBe(true);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual(before);
    expect(await prisma.trackedPlayer.count()).toBe(1);
  });

  it('E: unique race after reservation → reservation rolled back (counter unchanged)', async () => {
    const { playerAccountId } = await seedAccount('rollback');
    await prisma.trackedPlayer.create({
      data: {
        playerAccountId,
        provider: PROVIDER,
        platformRoute: PLATFORM,
        enrollmentSource: TrackedPlayerEnrollmentSource.ADMIN_SEED,
        discoveryDepth: 0,
        status: TrackedPlayerStatus.ACTIVE,
        priority: 0,
        nextEligibleAt: new Date(),
      },
    });
    await reconcileTrackedPlayerBudgetFromRows(prisma);
    const before = await getTrackedPlayerBudgetUsage(prisma);

    // Bypass cheap pre-check: reserve+insert against existing row → unique → rollback.
    const result = await reserveAndCreateLadderTrackedPlayer(prisma, {
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      totalCap: 100,
      ladderCap: 50,
    });

    expect(result.outcome).toBe('alreadyTracked');
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual(before);
    expect(await prisma.trackedPlayer.count()).toBe(1);
  });

  it('F: MATCH_PARTICIPANT depth=1 rediscovered as LADDER → source unchanged, depth 0, no LADDER capacity', async () => {
    const service = createService();
    const { playerAccountId, puuid } = await seedAccount('participant');
    await prisma.trackedPlayer.create({
      data: {
        playerAccountId,
        provider: PROVIDER,
        platformRoute: PLATFORM,
        enrollmentSource: TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT,
        discoveryDepth: 1,
        status: TrackedPlayerStatus.ACTIVE,
        priority: 0,
        nextEligibleAt: new Date(),
      },
    });
    await reconcileTrackedPlayerBudgetFromRows(prisma);
    const before = await getTrackedPlayerBudgetUsage(prisma);
    expect(before).toEqual({ trackedPlayerCount: 1, ladderEnrolledCount: 0 });

    const result = await service.enrollLadderCandidate({
      platformRoute: PLATFORM,
      puuid,
    });

    expect(result.outcome).toBe('alreadyTracked');
    expect(result.enrollmentSource).toBe('MATCH_PARTICIPANT');
    expect(result.discoveryDepth).toBe(0);

    const tracked = await prisma.trackedPlayer.findUniqueOrThrow({
      where: { playerAccountId },
    });
    expect(tracked.enrollmentSource).toBe('MATCH_PARTICIPANT');
    expect(tracked.discoveryDepth).toBe(0);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual(before);
  });

  it('new LADDER create increments both counters once', async () => {
    const service = createService();
    const { puuid } = await seedAccount('new-ladder');

    const result = await service.enrollLadderCandidate({
      platformRoute: PLATFORM,
      puuid,
    });

    expect(result.outcome).toBe('created');
    expect(result.enrollmentSource).toBe('LADDER');
    expect(result.discoveryDepth).toBe(0);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 1,
    });
  });

  it('PRODUCT_SEARCH-style total reserve still works when LADDER cap is full', async () => {
    // Ladder at cap; global still has room — Nest enroll path uses total-only reserve.
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 2, ladderEnrolledCount: 2 },
    });

    const { playerAccountId } = await seedAccount('prodsearch');
    const reserved = await prisma.$transaction((tx) =>
      reserveTotalTrackedCreate(tx, { totalCap: 10 }),
    );
    expect(reserved.outcome).toBe('reserved');

    await prisma.trackedPlayer.create({
      data: {
        playerAccountId,
        provider: PROVIDER,
        platformRoute: PLATFORM,
        enrollmentSource: TrackedPlayerEnrollmentSource.PRODUCT_SEARCH,
        discoveryDepth: 0,
        status: TrackedPlayerStatus.ACTIVE,
        priority: 0,
        nextEligibleAt: new Date(),
      },
    });

    // Ladder enroll should still be blocked by ladder cap while total room remains.
    const service = createService(
      baseConfig({ totalTrackedPlayersHardCap: 10, ladderMaxTotal: 2 }),
    );
    const other = await seedAccount('ladderfull');
    const ladderResult = await service.enrollLadderCandidate({
      platformRoute: PLATFORM,
      puuid: other.puuid,
    });
    expect(ladderResult).toEqual(
      expect.objectContaining({ outcome: 'skippedLadderCap' }),
    );
    expect(ladderResult.message).toBeUndefined();
  });

  it('skips Account-v1 when PlayerAccount already has usable names', async () => {
    let resolveCalls = 0;
    const playerAccounts = new PlayerAccountRepository(prisma as never);
    const service = LadderEnrollmentService.create({
      prisma,
      playerAccounts,
      config: baseConfig(),
      resolveAccount: async () => {
        resolveCalls += 1;
        return { gameName: 'ShouldNot', tagLine: 'Call' };
      },
    });
    const { puuid } = await seedAccount('named');

    const result = await service.enrollLadderCandidate({
      platformRoute: PLATFORM,
      puuid,
    });

    expect(result.outcome).toBe('created');
    expect(resolveCalls).toBe(0);
  });

  it('returns skippedIdentity when names missing and resolver returns null', async () => {
    const player = await prisma.player.create({ data: {} });
    const puuid = `puuid-noid-${randomUUID().slice(0, 8)}`;
    await prisma.playerAccount.create({
      data: {
        playerId: player.id,
        provider: PROVIDER,
        externalAccountId: puuid,
        platformRoute: PLATFORM,
        regionalRoute: 'americas',
        currentGameName: '',
        currentTagLine: '',
        normalizedGameName: '',
        normalizedTagLine: '',
      },
    });

    const playerAccounts = new PlayerAccountRepository(prisma as never);
    const service = LadderEnrollmentService.create({
      prisma,
      playerAccounts,
      config: baseConfig(),
      resolveAccount: async () => null,
    });

    const result = await service.enrollLadderCandidate({
      platformRoute: PLATFORM,
      puuid,
    });
    expect(result.outcome).toBe('skippedIdentity');
    expect(await prisma.trackedPlayer.count()).toBe(0);
  });
});
