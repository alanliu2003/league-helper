import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PrismaClient,
  TrackedPlayerEnrollmentSource,
  TrackedPlayerStatus,
} from '@prisma/client';
import {
  AlreadyTrackedRollbackError,
  ensureTrackedPlayerBudgetSingleton,
  getTrackedPlayerBudgetUsage,
  reconcileTrackedPlayerBudgetFromRows,
  reserveLadderTrackedCreate,
  reserveTotalTrackedCreate,
} from './ladder-enrollment.budget';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const PROVIDER = 'RIOT';
const PLATFORM = 'na1';

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

async function seedAccount(suffix: string): Promise<{ playerAccountId: string }> {
  const player = await prisma.player.create({ data: {} });
  const account = await prisma.playerAccount.create({
    data: {
      playerId: player.id,
      provider: PROVIDER,
      externalAccountId: `puuid-${suffix}-${randomUUID().slice(0, 8)}`,
      platformRoute: PLATFORM,
      regionalRoute: 'americas',
      currentGameName: `Player${suffix}`,
      currentTagLine: 'NA1',
      normalizedGameName: `player${suffix}`,
      normalizedTagLine: 'na1',
    },
  });
  return { playerAccountId: account.id };
}

async function seedTracked(
  suffix: string,
  enrollmentSource: TrackedPlayerEnrollmentSource,
): Promise<void> {
  const { playerAccountId } = await seedAccount(suffix);
  await prisma.trackedPlayer.create({
    data: {
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      enrollmentSource,
      discoveryDepth: 0,
      status: TrackedPlayerStatus.ACTIVE,
      priority: 0,
      nextEligibleAt: new Date(),
    },
  });
}

describe('ladder-enrollment.budget (integration)', () => {
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

  it('reserveTotalTrackedCreate succeeds under cap and fails at cap', async () => {
    const first = await prisma.$transaction((tx) =>
      reserveTotalTrackedCreate(tx, { totalCap: 1 }),
    );
    expect(first).toEqual({ outcome: 'reserved' });

    const usage = await getTrackedPlayerBudgetUsage(prisma);
    expect(usage.trackedPlayerCount).toBe(1);
    expect(usage.ladderEnrolledCount).toBe(0);

    const second = await prisma.$transaction((tx) =>
      reserveTotalTrackedCreate(tx, { totalCap: 1 }),
    );
    expect(second).toEqual({ outcome: 'skipped_total_cap' });
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 0,
    });
  });

  it('reserveLadderTrackedCreate increments both counters and respects each cap', async () => {
    const reserved = await prisma.$transaction((tx) =>
      reserveLadderTrackedCreate(tx, { totalCap: 10, ladderCap: 1 }),
    );
    expect(reserved).toEqual({ outcome: 'reserved' });
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 1,
    });

    const ladderBlocked = await prisma.$transaction((tx) =>
      reserveLadderTrackedCreate(tx, { totalCap: 10, ladderCap: 1 }),
    );
    expect(ladderBlocked).toEqual({ outcome: 'skipped_ladder_cap' });

    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 10, ladderEnrolledCount: 0 },
    });
    const totalBlocked = await prisma.$transaction((tx) =>
      reserveLadderTrackedCreate(tx, { totalCap: 10, ladderCap: 5 }),
    );
    expect(totalBlocked).toEqual({ outcome: 'skipped_total_cap' });
  });

  it('concurrent race for last total slot yields exactly one reserved', async () => {
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 4, ladderEnrolledCount: 0 },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.$transaction((tx) => reserveTotalTrackedCreate(tx, { totalCap: 5 })),
      ),
    );

    expect(results.filter((r) => r.outcome === 'reserved')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'skipped_total_cap')).toHaveLength(7);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 5,
      ladderEnrolledCount: 0,
    });
  });

  it('concurrent race for last ladder slot yields exactly one reserved', async () => {
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 2, ladderEnrolledCount: 2 },
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        prisma.$transaction((tx) =>
          reserveLadderTrackedCreate(tx, { totalCap: 100, ladderCap: 3 }),
        ),
      ),
    );

    expect(results.filter((r) => r.outcome === 'reserved')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'skipped_ladder_cap')).toHaveLength(5);
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 3,
      ladderEnrolledCount: 3,
    });
  });

  it('unique conflict after reservation rolls back both counters', async () => {
    const { playerAccountId } = await seedAccount('already');
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
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 0,
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const reserved = await reserveLadderTrackedCreate(tx, {
          totalCap: 10,
          ladderCap: 10,
        });
        expect(reserved.outcome).toBe('reserved');

        try {
          await tx.trackedPlayer.create({
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
        } catch {
          throw new AlreadyTrackedRollbackError();
        }
      }),
    ).rejects.toBeInstanceOf(AlreadyTrackedRollbackError);

    // Reservation rolled back; pre-existing TrackedPlayer remains.
    expect(await getTrackedPlayerBudgetUsage(prisma)).toEqual({
      trackedPlayerCount: 1,
      ladderEnrolledCount: 0,
    });
    expect(await prisma.trackedPlayer.count()).toBe(1);
  });

  it('bootstrap/reconcile counts existing TrackedPlayer rows (never force both to 0)', async () => {
    await seedTracked('admin-1', TrackedPlayerEnrollmentSource.ADMIN_SEED);
    await seedTracked('ladder-1', TrackedPlayerEnrollmentSource.LADDER);
    await seedTracked('ladder-2', TrackedPlayerEnrollmentSource.LADDER);

    await prisma.collectorTrackedPlayerBudget.delete({ where: { id: 'singleton' } });

    const ensured = await ensureTrackedPlayerBudgetSingleton(prisma);
    expect(ensured).toEqual({
      trackedPlayerCount: 3,
      ladderEnrolledCount: 2,
    });

    // Stale counters + reconcile restores live counts.
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 0, ladderEnrolledCount: 0 },
    });
    const reconciled = await reconcileTrackedPlayerBudgetFromRows(prisma);
    expect(reconciled).toEqual({
      trackedPlayerCount: 3,
      ladderEnrolledCount: 2,
    });

    // ensure is idempotent and does not overwrite existing singleton.
    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 99, ladderEnrolledCount: 77 },
    });
    const afterEnsure = await ensureTrackedPlayerBudgetSingleton(prisma);
    expect(afterEnsure).toEqual({
      trackedPlayerCount: 99,
      ladderEnrolledCount: 77,
    });
  });
});
