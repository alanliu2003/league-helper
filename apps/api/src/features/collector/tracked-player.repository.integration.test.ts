import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PrismaClient,
  TrackedPlayerEnrollmentSource,
  TrackedPlayerStatus,
  type TrackedPlayer,
} from '@prisma/client';
import { TrackedPlayerRepository } from './tracked-player.repository';
import { CollectorRunRepository } from './collector-run.repository';
import { CollectorRunStatus } from '@prisma/client';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const trackedPlayers = new TrackedPlayerRepository(prisma as never);
const collectorRuns = new CollectorRunRepository(prisma as never);

const PROVIDER = 'RIOT';
const PLATFORM = 'na1';
const LEASE_MS = 15 * 60_000;
const MIN_REFRESH_MS = 6 * 60 * 60_000;
const BASE_BACKOFF_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;
const MAX_BACKOFF_EXPONENT = 8;

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

async function seedTrackedPlayer(input: {
  suffix: string;
  priority?: number;
  nextEligibleAt?: Date;
  lastSuccessfulRefreshAt?: Date | null;
  status?: TrackedPlayerStatus;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  consecutiveFailureCount?: number;
  lastFailureCode?: string | null;
  id?: string;
}): Promise<TrackedPlayer> {
  const { playerAccountId } = await seedAccount(input.suffix);
  return prisma.trackedPlayer.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      enrollmentSource: TrackedPlayerEnrollmentSource.ADMIN_SEED,
      status: input.status ?? TrackedPlayerStatus.ACTIVE,
      priority: input.priority ?? 0,
      nextEligibleAt: input.nextEligibleAt ?? new Date(Date.now() - 60_000),
      lastSuccessfulRefreshAt: input.lastSuccessfulRefreshAt === undefined ? null : input.lastSuccessfulRefreshAt,
      leaseOwner: input.leaseOwner ?? null,
      leaseExpiresAt: input.leaseExpiresAt ?? null,
      consecutiveFailureCount: input.consecutiveFailureCount ?? 0,
      lastFailureCode: input.lastFailureCode ?? null,
    },
  });
}

function claimDefaults(overrides: Partial<Parameters<TrackedPlayerRepository['claimEligibleWave']>[0]> = {}) {
  return {
    platformRoutes: [PLATFORM],
    provider: PROVIDER,
    limit: 10,
    ownerToken: 'owner-a',
    leaseDurationMs: LEASE_MS,
    ...overrides,
  };
}

describe('TrackedPlayerRepository + CollectorRunRepository (integration)', () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two overlapping claim transactions return disjoint players (SKIP LOCKED)', async () => {
    await seedTrackedPlayer({ suffix: 'c1', priority: 10 });
    await seedTrackedPlayer({ suffix: 'c2', priority: 9 });

    let releaseAHold!: () => void;
    const holdAOpen = new Promise<void>((resolve) => {
      releaseAHold = resolve;
    });
    let signalAClaimed!: () => void;
    const aHasClaimed = new Promise<void>((resolve) => {
      signalAClaimed = resolve;
    });

    let waveA: TrackedPlayer[] = [];
    let waveB: TrackedPlayer[] = [];

    const txA = prisma.$transaction(
      async (tx) => {
        waveA = await trackedPlayers.claimEligibleWave(
          claimDefaults({ ownerToken: 'owner-a', limit: 1 }),
          tx,
        );
        signalAClaimed();
        // Keep row locks until B has claimed under SKIP LOCKED.
        await holdAOpen;
        return waveA;
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    await aHasClaimed;

    // Without SKIP LOCKED, B blocks on A's FOR UPDATE until A commits → race times out.
    const txB = prisma.$transaction(
      async (tx) => {
        waveB = await trackedPlayers.claimEligibleWave(
          claimDefaults({ ownerToken: 'owner-b', limit: 1 }),
          tx,
        );
        return waveB;
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    const blockedFailure = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            'TX B did not finish while TX A still held locks — claim likely missing SKIP LOCKED',
          ),
        );
      }, 3_000);
    });

    await Promise.race([txB, blockedFailure]);
    releaseAHold();
    await txA;
    await txB;

    expect(waveA).toHaveLength(1);
    expect(waveB).toHaveLength(1);
    expect(waveA[0]!.id).not.toBe(waveB[0]!.id);
    expect(new Set([waveA[0]!.leaseOwner, waveB[0]!.leaseOwner])).toEqual(
      new Set(['owner-a', 'owner-b']),
    );
  });

  it('skips players with an active unexpired lease', async () => {
    const held = await seedTrackedPlayer({
      suffix: 'held',
      leaseOwner: 'other-owner',
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const free = await seedTrackedPlayer({ suffix: 'free', priority: 1 });

    const claimed = await trackedPlayers.claimEligibleWave(claimDefaults({ limit: 10 }));
    expect(claimed.map((row) => row.id)).toEqual([free.id]);
    expect(claimed.map((row) => row.id)).not.toContain(held.id);
  });

  it('reclaims players whose lease has expired', async () => {
    const expired = await seedTrackedPlayer({
      suffix: 'expired',
      leaseOwner: 'stale-owner',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    const claimed = await trackedPlayers.claimEligibleWave(
      claimDefaults({ ownerToken: 'new-owner', limit: 1 }),
    );

    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(expired.id);
    expect(claimed[0]!.leaseOwner).toBe('new-owner');
  });

  it('stale owner cannot finalize after reclaim', async () => {
    const row = await seedTrackedPlayer({
      suffix: 'reclaim-finalize',
      leaseOwner: 'stale-owner',
      leaseExpiresAt: new Date(Date.now() - 1_000),
      consecutiveFailureCount: 3,
      lastFailureCode: 'RATE_LIMITED',
    });

    const claimed = await trackedPlayers.claimEligibleWave(
      claimDefaults({ ownerToken: 'new-owner', limit: 1 }),
    );
    expect(claimed[0]!.id).toBe(row.id);

    const staleSuccess = await trackedPlayers.finalizeSuccess({
      trackedPlayerId: row.id,
      ownerToken: 'stale-owner',
      minRefreshIntervalMs: MIN_REFRESH_MS,
    });
    expect(staleSuccess.updated).toBe(false);

    const staleFailure = await trackedPlayers.finalizeFailure({
      trackedPlayerId: row.id,
      ownerToken: 'stale-owner',
      failureCode: 'ENQUEUE_TRANSIENT',
      baseBackoffMs: BASE_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      maxBackoffExponent: MAX_BACKOFF_EXPONENT,
    });
    expect(staleFailure.updated).toBe(false);

    const ok = await trackedPlayers.finalizeSuccess({
      trackedPlayerId: row.id,
      ownerToken: 'new-owner',
      minRefreshIntervalMs: MIN_REFRESH_MS,
    });
    expect(ok.updated).toBe(true);
  });

  it('claims in deterministic priority / eligibility / nulls-first / id order', async () => {
    const dueOlder = new Date('2020-01-01T00:00:00.000Z');
    const dueMid = new Date('2020-06-01T00:00:00.000Z');
    const dueNewer = new Date('2020-12-01T00:00:00.000Z');
    const low = await seedTrackedPlayer({
      suffix: 'ord-low',
      priority: 1,
      id: '00000000-0000-4000-8000-000000000001',
      nextEligibleAt: dueOlder,
      lastSuccessfulRefreshAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const midNullRefresh = await seedTrackedPlayer({
      suffix: 'ord-mid-null',
      priority: 5,
      id: '00000000-0000-4000-8000-000000000002',
      nextEligibleAt: dueMid,
      lastSuccessfulRefreshAt: null,
    });
    const midOldRefresh = await seedTrackedPlayer({
      suffix: 'ord-mid-old',
      priority: 5,
      id: '00000000-0000-4000-8000-000000000003',
      nextEligibleAt: dueMid,
      lastSuccessfulRefreshAt: new Date('2021-01-01T00:00:00.000Z'),
    });
    const high = await seedTrackedPlayer({
      suffix: 'ord-high',
      priority: 10,
      id: '00000000-0000-4000-8000-000000000004',
      nextEligibleAt: dueNewer,
      lastSuccessfulRefreshAt: new Date('2022-01-01T00:00:00.000Z'),
    });

    const claimed = await trackedPlayers.claimEligibleWave(claimDefaults({ limit: 4 }));
    expect(claimed.map((row) => row.id)).toEqual([
      high.id,
      midNullRefresh.id,
      midOldRefresh.id,
      low.id,
    ]);
  });

  it('ACTIVE success finalize resets failure fields', async () => {
    const row = await seedTrackedPlayer({
      suffix: 'success-active',
      consecutiveFailureCount: 4,
      lastFailureCode: 'RATE_LIMITED',
    });
    await trackedPlayers.claimEligibleWave(claimDefaults({ ownerToken: 'owner-a', limit: 1 }));

    const before = Date.now();
    const result = await trackedPlayers.finalizeSuccess({
      trackedPlayerId: row.id,
      ownerToken: 'owner-a',
      minRefreshIntervalMs: MIN_REFRESH_MS,
    });
    expect(result.updated).toBe(true);
    expect(result.status).toBe(TrackedPlayerStatus.ACTIVE);

    const updated = await prisma.trackedPlayer.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.consecutiveFailureCount).toBe(0);
    expect(updated.lastFailureCode).toBeNull();
    expect(updated.leaseOwner).toBeNull();
    expect(updated.leaseExpiresAt).toBeNull();
    expect(updated.lastSuccessfulRefreshAt).not.toBeNull();
    expect(updated.nextEligibleAt.getTime()).toBeGreaterThanOrEqual(before + MIN_REFRESH_MS - 2_000);
  });

  it('PAUSED/SUSPENDED success finalize preserves status and failure context', async () => {
    for (const status of [TrackedPlayerStatus.PAUSED, TrackedPlayerStatus.SUSPENDED] as const) {
      await resetTestData();
      const row = await seedTrackedPlayer({
        suffix: `success-${status.toLowerCase()}`,
        status: TrackedPlayerStatus.ACTIVE,
        consecutiveFailureCount: 2,
        lastFailureCode: 'ENQUEUE_TRANSIENT',
      });
      await trackedPlayers.claimEligibleWave(claimDefaults({ ownerToken: 'owner-a', limit: 1 }));
      await prisma.trackedPlayer.update({
        where: { id: row.id },
        data: { status },
      });

      const result = await trackedPlayers.finalizeSuccess({
        trackedPlayerId: row.id,
        ownerToken: 'owner-a',
        minRefreshIntervalMs: MIN_REFRESH_MS,
      });
      expect(result.updated).toBe(true);
      expect(result.status).toBe(status);

      const updated = await prisma.trackedPlayer.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.status).toBe(status);
      expect(updated.consecutiveFailureCount).toBe(2);
      expect(updated.lastFailureCode).toBe('ENQUEUE_TRANSIENT');
      expect(updated.leaseOwner).toBeNull();
      expect(updated.lastSuccessfulRefreshAt).not.toBeNull();
    }
  });

  it('failure finalize increments count and sets backoff atomically; first failure uses base backoff', async () => {
    const row = await seedTrackedPlayer({ suffix: 'fail-first', consecutiveFailureCount: 0 });
    await trackedPlayers.claimEligibleWave(claimDefaults({ ownerToken: 'owner-a', limit: 1 }));

    const before = Date.now();
    const result = await trackedPlayers.finalizeFailure({
      trackedPlayerId: row.id,
      ownerToken: 'owner-a',
      failureCode: 'ENQUEUE_TRANSIENT',
      baseBackoffMs: BASE_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      maxBackoffExponent: MAX_BACKOFF_EXPONENT,
    });
    expect(result.updated).toBe(true);

    const updated = await prisma.trackedPlayer.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.consecutiveFailureCount).toBe(1);
    expect(updated.lastFailureCode).toBe('ENQUEUE_TRANSIENT');
    expect(updated.leaseOwner).toBeNull();
    expect(updated.nextEligibleAt.getTime()).toBeGreaterThanOrEqual(before + BASE_BACKOFF_MS - 2_000);
    expect(updated.nextEligibleAt.getTime()).toBeLessThanOrEqual(before + BASE_BACKOFF_MS + 5_000);
  });

  it('repeated failures cap backoff at maxBackoff and exponent bound', async () => {
    const row = await seedTrackedPlayer({
      suffix: 'fail-cap',
      consecutiveFailureCount: 20,
    });
    await trackedPlayers.claimEligibleWave(claimDefaults({ ownerToken: 'owner-a', limit: 1 }));

    const before = Date.now();
    await trackedPlayers.finalizeFailure({
      trackedPlayerId: row.id,
      ownerToken: 'owner-a',
      failureCode: 'INTERNAL_TRANSIENT',
      baseBackoffMs: BASE_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      maxBackoffExponent: MAX_BACKOFF_EXPONENT,
    });

    const updated = await prisma.trackedPlayer.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.consecutiveFailureCount).toBe(21);
    // effectiveExponent = min(20, 8) = 8 → base * 2^8 = 15m * 256 = 64h → capped to 24h
    expect(updated.nextEligibleAt.getTime()).toBeGreaterThanOrEqual(before + MAX_BACKOFF_MS - 2_000);
    expect(updated.nextEligibleAt.getTime()).toBeLessThanOrEqual(before + MAX_BACKOFF_MS + 5_000);
  });

  it('RATE_LIMITED failure uses max(exponential, retryAfter) within maxBackoff', async () => {
    const row = await seedTrackedPlayer({ suffix: 'rate-limit', consecutiveFailureCount: 0 });
    await trackedPlayers.claimEligibleWave(claimDefaults({ ownerToken: 'owner-a', limit: 1 }));

    const retryAfterMs = 45 * 60_000;
    const before = Date.now();
    await trackedPlayers.finalizeFailure({
      trackedPlayerId: row.id,
      ownerToken: 'owner-a',
      failureCode: 'RATE_LIMITED',
      baseBackoffMs: BASE_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      maxBackoffExponent: MAX_BACKOFF_EXPONENT,
      retryAfterMs,
    });

    const updated = await prisma.trackedPlayer.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.nextEligibleAt.getTime()).toBeGreaterThanOrEqual(before + retryAfterMs - 2_000);
    expect(updated.nextEligibleAt.getTime()).toBeLessThanOrEqual(before + retryAfterMs + 5_000);
  });

  it('permanent failure code suspends; owner-protected update returns ownership lost when wrong owner', async () => {
    const row = await seedTrackedPlayer({ suffix: 'permanent' });
    await trackedPlayers.claimEligibleWave(claimDefaults({ ownerToken: 'owner-a', limit: 1 }));

    const lost = await trackedPlayers.finalizeFailure({
      trackedPlayerId: row.id,
      ownerToken: 'not-the-owner',
      failureCode: 'ACCOUNT_NOT_FOUND',
      baseBackoffMs: BASE_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      maxBackoffExponent: MAX_BACKOFF_EXPONENT,
    });
    expect(lost.updated).toBe(false);

    const ok = await trackedPlayers.finalizeFailure({
      trackedPlayerId: row.id,
      ownerToken: 'owner-a',
      failureCode: 'ACCOUNT_NOT_FOUND',
      baseBackoffMs: BASE_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      maxBackoffExponent: MAX_BACKOFF_EXPONENT,
    });
    expect(ok.updated).toBe(true);
    expect(ok.status).toBe(TrackedPlayerStatus.SUSPENDED);

    const updated = await prisma.trackedPlayer.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe(TrackedPlayerStatus.SUSPENDED);
    expect(updated.consecutiveFailureCount).toBe(1);
  });

  it('CollectorRun double finalization is rejected', async () => {
    const run = await collectorRuns.createRunning({
      ownerToken: 'run-owner-1',
      effectivePlatforms: [PLATFORM],
      queueId: 420,
      batchLimit: 10,
      concurrency: 2,
    });

    const first = await collectorRuns.finalizeIfRunning({
      id: run.id,
      ownerToken: 'run-owner-1',
      status: CollectorRunStatus.COMPLETED,
      counters: {
        playersClaimed: 1,
        playersAttempted: 1,
        playersSucceeded: 1,
        playersFailed: 0,
        ownershipLost: 0,
        matchIdsDiscovered: 2,
        matchesEnqueued: 2,
        matchesSkippedComplete: 0,
        rateLimitStops: 0,
        budgetExhausted: false,
      },
    });
    expect(first).not.toBeNull();
    expect(first!.status).toBe(CollectorRunStatus.COMPLETED);

    const second = await collectorRuns.finalizeIfRunning({
      id: run.id,
      ownerToken: 'run-owner-1',
      status: CollectorRunStatus.PARTIAL,
      counters: {
        playersClaimed: 9,
        playersAttempted: 9,
        playersSucceeded: 0,
        playersFailed: 9,
        ownershipLost: 0,
        matchIdsDiscovered: 0,
        matchesEnqueued: 0,
        matchesSkippedComplete: 0,
        rateLimitStops: 0,
        budgetExhausted: true,
      },
    });
    expect(second).toBeNull();

    const persisted = await collectorRuns.findById(run.id);
    expect(persisted!.status).toBe(CollectorRunStatus.COMPLETED);
    expect(persisted!.playersClaimed).toBe(1);
  });

  it('stale-run threshold is separate from lease duration', async () => {
    const leaseDurationMs = 15 * 60_000;
    const staleRunAfterMs = 2 * 60 * 60_000;

    const recent = await collectorRuns.createRunning({
      ownerToken: 'stale-recent',
      effectivePlatforms: [PLATFORM],
      queueId: 420,
      batchLimit: 10,
      concurrency: 2,
      startedAt: new Date(Date.now() - 30 * 60_000),
    });
    const old = await collectorRuns.createRunning({
      ownerToken: 'stale-old',
      effectivePlatforms: [PLATFORM],
      queueId: 420,
      batchLimit: 10,
      concurrency: 2,
      startedAt: new Date(Date.now() - 3 * 60 * 60_000),
    });

    // A lease-duration threshold would wrongly mark the 30m-old run stale; stale-run uses 2h.
    const staleByLeaseKnob = await collectorRuns.findStaleRunning(leaseDurationMs);
    expect(staleByLeaseKnob.map((row) => row.id).sort()).toEqual([old.id, recent.id].sort());

    const staleByConfiguredThreshold = await collectorRuns.findStaleRunning(staleRunAfterMs);
    expect(staleByConfiguredThreshold.map((row) => row.id)).toEqual([old.id]);
    expect(staleByConfiguredThreshold.map((row) => row.id)).not.toContain(recent.id);
  });

  it('countOwnedUnreleasedLeases counts unexpired and expired-but-still-owned leases', async () => {
    await seedTrackedPlayer({
      suffix: 'lease-active',
      leaseOwner: 'run-token',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await seedTrackedPlayer({
      suffix: 'lease-expired',
      leaseOwner: 'run-token',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await seedTrackedPlayer({
      suffix: 'lease-other',
      leaseOwner: 'other',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await seedTrackedPlayer({
      suffix: 'lease-cleared',
      leaseOwner: 'run-token',
      leaseExpiresAt: null,
    });

    await expect(trackedPlayers.countOwnedUnreleasedLeases('run-token')).resolves.toBe(2);
  });

  it('listEligiblePreview matches claim order and includes expired leases', async () => {
    const expired = await seedTrackedPlayer({
      suffix: 'preview-expired',
      priority: 5,
      leaseOwner: 'stale',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    const free = await seedTrackedPlayer({
      suffix: 'preview-free',
      priority: 10,
    });
    await seedTrackedPlayer({
      suffix: 'preview-leased',
      priority: 100,
      leaseOwner: 'alive',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const preview = await trackedPlayers.listEligiblePreview({
      platformRoutes: [PLATFORM],
      provider: PROVIDER,
      limit: 10,
    });
    expect(preview.map((row) => row.id)).toEqual([free.id, expired.id]);

    const claimed = await trackedPlayers.claimEligibleWave(
      claimDefaults({ ownerToken: 'preview-owner', limit: 10 }),
    );
    expect(claimed.map((row) => row.id)).toEqual([free.id, expired.id]);
  });

  it('upsertEnrollment preserves source and setStatus force clears lease', async () => {
    const { playerAccountId } = await seedAccount('enroll-1');
    const first = await trackedPlayers.upsertEnrollment({
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      enrollmentSource: TrackedPlayerEnrollmentSource.ADMIN_SEED,
      priority: 3,
      reactivate: false,
    });
    expect(first.created).toBe(true);

    const second = await trackedPlayers.upsertEnrollment({
      playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      enrollmentSource: TrackedPlayerEnrollmentSource.PRODUCT_SEARCH,
      priority: 3,
      reactivate: false,
    });
    expect(second.created).toBe(false);
    expect(second.trackedPlayer.enrollmentSource).toBe(TrackedPlayerEnrollmentSource.ADMIN_SEED);

    await prisma.trackedPlayer.update({
      where: { id: first.trackedPlayer.id },
      data: {
        status: TrackedPlayerStatus.PAUSED,
        leaseOwner: 'owner-x',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const withoutForce = await trackedPlayers.setStatus({
      trackedPlayerId: first.trackedPlayer.id,
      status: TrackedPlayerStatus.SUSPENDED,
      force: false,
      resetFailures: false,
    });
    expect(withoutForce?.status).toBe(TrackedPlayerStatus.SUSPENDED);
    expect(withoutForce?.leaseOwner).toBe('owner-x');

    const withForce = await trackedPlayers.setStatus({
      trackedPlayerId: first.trackedPlayer.id,
      status: TrackedPlayerStatus.ACTIVE,
      force: true,
      resetFailures: true,
    });
    expect(withForce?.status).toBe(TrackedPlayerStatus.ACTIVE);
    expect(withForce?.leaseOwner).toBeNull();
    expect(withForce?.leaseExpiresAt).toBeNull();
    expect(withForce?.consecutiveFailureCount).toBe(0);
  });

  it('forceReleaseOwnedLeases clears only the owner token leases', async () => {
    await seedTrackedPlayer({
      suffix: 'force-a',
      leaseOwner: 'run-a',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await seedTrackedPlayer({
      suffix: 'force-b',
      leaseOwner: 'run-b',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(trackedPlayers.forceReleaseOwnedLeases('run-a')).resolves.toBe(1);
    await expect(trackedPlayers.countOwnedUnreleasedLeases('run-a')).resolves.toBe(0);
    await expect(trackedPlayers.countOwnedUnreleasedLeases('run-b')).resolves.toBe(1);
  });

  it('EXPLAIN for claim query reports index or seq-scan choice', async () => {
    for (let i = 0; i < 80; i += 1) {
      await seedTrackedPlayer({
        suffix: `explain-na-${i}`,
        priority: i,
        nextEligibleAt: new Date(Date.now() - (i + 1) * 1_000),
      });
    }
    // Dilute selectivity with non-allowlisted platforms so an index can win over seq scan.
    for (let i = 0; i < 80; i += 1) {
      const { playerAccountId } = await seedAccount(`explain-euw-${i}`);
      await prisma.trackedPlayer.create({
        data: {
          playerAccountId,
          provider: PROVIDER,
          platformRoute: 'euw1',
          enrollmentSource: TrackedPlayerEnrollmentSource.ADMIN_SEED,
          status: TrackedPlayerStatus.ACTIVE,
          priority: i,
          nextEligibleAt: new Date(Date.now() - 60_000),
        },
      });
    }

    await prisma.$executeRawUnsafe(`ANALYZE "TrackedPlayer"`);

    const plan = await trackedPlayers.explainClaimPlan({
      platformRoutes: [PLATFORM],
      provider: PROVIDER,
      limit: 5,
    });

    // Small tables may still seq-scan; claim indexes exist and plan remains lock/scan shaped.
    expect(plan.length).toBeGreaterThan(0);
    expect(plan).toMatch(/LockRows|Seq Scan|Index Scan|Bitmap Index Scan/i);
  });
});
