import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CollectorRunStatus,
  PrismaClient,
  TrackedPlayerEnrollmentSource,
  TrackedPlayerStatus,
} from '@prisma/client';
import { reserveAndCreateTrackedParticipant } from './participant-expansion.reserve.js';

const testDatabaseUrl =
  process.env.WORKER_TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_worker_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const PROVIDER = 'RIOT';
const PLATFORM = 'na1';

async function reset(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CollectorRunSourceQuota",
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
      externalAccountId: `puuid-${suffix}`,
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

async function seedSourceTracked(suffix: string): Promise<{
  trackedPlayerId: string;
  playerAccountId: string;
}> {
  const { playerAccountId } = await seedAccount(suffix);
  const tracked = await prisma.trackedPlayer.create({
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
  return { trackedPlayerId: tracked.id, playerAccountId };
}

async function seedCollectorRun(id?: string): Promise<string> {
  const run = await prisma.collectorRun.create({
    data: {
      ...(id ? { id } : {}),
      ownerToken: `owner-${Math.random().toString(16).slice(2)}`,
      status: CollectorRunStatus.COMPLETED,
      startedAt: new Date(),
      finishedAt: new Date(),
      effectivePlatforms: [PLATFORM],
      queueId: 420,
      batchLimit: 10,
      concurrency: 2,
    },
  });
  return run.id;
}

describe('participant expansion quota concurrency (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('global autonomous cap: concurrent distinct candidates never exceed N', async () => {
    const N = 3;
    const source = await seedSourceTracked('src-global');
    const accounts = await Promise.all(
      Array.from({ length: N + 3 }, (_, i) => seedAccount(`g-${i}`)),
    );

    const results = await Promise.all(
      accounts.map((account) =>
        reserveAndCreateTrackedParticipant(prisma, {
          playerAccountId: account.playerAccountId,
          provider: PROVIDER,
          platformRoute: PLATFORM,
          discoveryDepth: 1,
          sourceTrackedPlayerId: source.trackedPlayerId,
          totalCap: 10000,
          globalCap: N,
          runCap: 100,
          sourceCap: 100,
        }),
      ),
    );

    const created = results.filter((r) => r.outcome === 'created');
    const skipped = results.filter((r) => r.outcome === 'skipped_population_cap');
    expect(created.length).toBe(N);
    expect(skipped.length).toBe(accounts.length - N);

    const budget = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(budget.matchParticipantEnrolledCount).toBeLessThanOrEqual(N);
    expect(budget.matchParticipantEnrolledCount).toBe(N);

    const matchParticipantCount = await prisma.trackedPlayer.count({
      where: { enrollmentSource: TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT },
    });
    expect(matchParticipantCount).toBe(N);
    expect(matchParticipantCount).toBeLessThanOrEqual(N);
  });

  it('per-run cap: concurrent candidates attributed to one run never exceed run max', async () => {
    const runCap = 2;
    const runId = await seedCollectorRun();
    const source = await seedSourceTracked('src-run');
    const accounts = await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedAccount(`run-${i}`)),
    );

    const results = await Promise.all(
      accounts.map((account) =>
        reserveAndCreateTrackedParticipant(prisma, {
          playerAccountId: account.playerAccountId,
          provider: PROVIDER,
          platformRoute: PLATFORM,
          discoveryDepth: 1,
          sourceCollectorRunId: runId,
          sourceTrackedPlayerId: source.trackedPlayerId,
          totalCap: 10000,
          globalCap: 100,
          runCap,
          sourceCap: 100,
        }),
      ),
    );

    const created = results.filter((r) => r.outcome === 'created');
    expect(created.length).toBe(runCap);
    expect(results.filter((r) => r.outcome === 'skipped_run_cap').length).toBeGreaterThan(0);

    const run = await prisma.collectorRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.playersEnrolledFromParticipants).toBeLessThanOrEqual(runCap);
    expect(run.playersEnrolledFromParticipants).toBe(runCap);
  });

  it('per-source-per-run cap: concurrent candidates never exceed source cap', async () => {
    const sourceCap = 2;
    const runId = await seedCollectorRun();
    const source = await seedSourceTracked('src-source');
    const accounts = await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedAccount(`srcq-${i}`)),
    );

    const results = await Promise.all(
      accounts.map((account) =>
        reserveAndCreateTrackedParticipant(prisma, {
          playerAccountId: account.playerAccountId,
          provider: PROVIDER,
          platformRoute: PLATFORM,
          discoveryDepth: 1,
          sourceCollectorRunId: runId,
          sourceTrackedPlayerId: source.trackedPlayerId,
          totalCap: 10000,
          globalCap: 100,
          runCap: 100,
          sourceCap,
        }),
      ),
    );

    const created = results.filter((r) => r.outcome === 'created');
    expect(created.length).toBe(sourceCap);
    expect(results.some((r) => r.outcome === 'skipped_source_cap')).toBe(true);

    const quota = await prisma.collectorRunSourceQuota.findUniqueOrThrow({
      where: {
        collectorRunId_sourceTrackedPlayerId: {
          collectorRunId: runId,
          sourceTrackedPlayerId: source.trackedPlayerId,
        },
      },
    });
    expect(quota.newPlayersEnrolled).toBeLessThanOrEqual(sourceCap);
    expect(quota.newPlayersEnrolled).toBe(sourceCap);
  });

  it('same participant race: one TrackedPlayer and at most one quota slot', async () => {
    const runId = await seedCollectorRun();
    const source = await seedSourceTracked('src-same');
    const { playerAccountId } = await seedAccount('same-p');

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveAndCreateTrackedParticipant(prisma, {
          playerAccountId,
          provider: PROVIDER,
          platformRoute: PLATFORM,
          discoveryDepth: 1,
          sourceCollectorRunId: runId,
          sourceTrackedPlayerId: source.trackedPlayerId,
          totalCap: 10000,
          globalCap: 100,
          runCap: 100,
          sourceCap: 100,
        }),
      ),
    );

    const created = results.filter((r) => r.outcome === 'created');
    const already = results.filter((r) => r.outcome === 'already_tracked');
    expect(created.length).toBe(1);
    expect(already.length).toBe(results.length - 1);

    expect(
      await prisma.trackedPlayer.count({ where: { playerAccountId } }),
    ).toBe(1);

    const budget = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(budget.matchParticipantEnrolledCount).toBe(1);

    const run = await prisma.collectorRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.playersEnrolledFromParticipants).toBeLessThanOrEqual(1);
    expect(run.playersEnrolledFromParticipants).toBe(1);

    const quota = await prisma.collectorRunSourceQuota.findUniqueOrThrow({
      where: {
        collectorRunId_sourceTrackedPlayerId: {
          collectorRunId: runId,
          sourceTrackedPlayerId: source.trackedPlayerId,
        },
      },
    });
    expect(quota.newPlayersEnrolled).toBeLessThanOrEqual(1);
    expect(quota.newPlayersEnrolled).toBe(1);
  });

  it('unique race after reservation rolls back budget counters', async () => {
    const source = await seedSourceTracked('src-rollback');
    const { playerAccountId } = await seedAccount('rollback-p');

    // Pre-create TrackedPlayer so insert always unique-conflicts after reservation attempts.
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

    const before = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });

    const result = await reserveAndCreateTrackedParticipant(prisma, {
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      discoveryDepth: 1,
      sourceTrackedPlayerId: source.trackedPlayerId,
      totalCap: 10000,
      globalCap: 100,
      runCap: 100,
      sourceCap: 100,
    });

    expect(result.outcome).toBe('already_tracked');

    const after = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(after.matchParticipantEnrolledCount).toBe(before.matchParticipantEnrolledCount);
  });

  it('explicit ADMIN_SEED create succeeds when autonomous budget is at cap (no budget touch)', async () => {
    await prisma.collectorPopulationBudget.update({
      where: { id: 'singleton' },
      data: { matchParticipantEnrolledCount: 500 },
    });
    const before = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });

    const { playerAccountId } = await seedAccount('seed-at-cap');
    // Mirrors Nest upsertEnrollment INSERT path — must not read/increment population budget.
    await prisma.$executeRaw`
      INSERT INTO "TrackedPlayer" (
        id,
        "playerAccountId",
        provider,
        "platformRoute",
        "enrollmentSource",
        "discoveryDepth",
        status,
        priority,
        "nextEligibleAt",
        "consecutiveFailureCount",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${playerAccountId},
        ${PROVIDER},
        ${PLATFORM},
        'ADMIN_SEED'::"TrackedPlayerEnrollmentSource",
        0,
        'ACTIVE'::"TrackedPlayerStatus",
        0,
        now(),
        0,
        now(),
        now()
      )
    `;

    const after = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(after.matchParticipantEnrolledCount).toBe(before.matchParticipantEnrolledCount);
    expect(
      await prisma.trackedPlayer.count({
        where: {
          playerAccountId,
          enrollmentSource: TrackedPlayerEnrollmentSource.ADMIN_SEED,
        },
      }),
    ).toBe(1);
  });

  it('total hard cap blocks participant create even when population budget has room', async () => {
    const source = await seedSourceTracked('src-total-cap');
    const { playerAccountId } = await seedAccount('total-cap-p');

    await prisma.collectorTrackedPlayerBudget.update({
      where: { id: 'singleton' },
      data: { trackedPlayerCount: 1, ladderEnrolledCount: 0 },
    });
    await prisma.collectorPopulationBudget.update({
      where: { id: 'singleton' },
      data: { matchParticipantEnrolledCount: 0 },
    });

    const result = await reserveAndCreateTrackedParticipant(prisma, {
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      discoveryDepth: 1,
      sourceTrackedPlayerId: source.trackedPlayerId,
      totalCap: 1,
      globalCap: 100,
      runCap: 100,
      sourceCap: 100,
    });

    expect(result.outcome).toBe('skipped_total_cap');
    expect(
      await prisma.trackedPlayer.count({
        where: { enrollmentSource: TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT },
      }),
    ).toBe(0);

    const population = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(population.matchParticipantEnrolledCount).toBe(0);

    const total = await prisma.collectorTrackedPlayerBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(total.trackedPlayerCount).toBe(1);
  });

  it('missing collector run uses un-attributed path and does not throw', async () => {
    const source = await seedSourceTracked('src-missing-run');
    const { playerAccountId } = await seedAccount('missing-run-p');

    const result = await reserveAndCreateTrackedParticipant(prisma, {
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      discoveryDepth: 1,
      sourceCollectorRunId: '00000000-0000-4000-8000-000000000099',
      sourceTrackedPlayerId: source.trackedPlayerId,
      totalCap: 10000,
      globalCap: 100,
      runCap: 1,
      sourceCap: 1,
    });

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.attributed).toBe(false);

    const budget = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(budget.matchParticipantEnrolledCount).toBe(1);

    // No source quota row when un-attributed
    const quotas = await prisma.collectorRunSourceQuota.count();
    expect(quotas).toBe(0);
  });
});
