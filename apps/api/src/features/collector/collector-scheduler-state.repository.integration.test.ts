import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CollectorSchedulerOutcome,
  PrismaClient,
  type CollectorSchedulerState,
} from '@prisma/client';
import { CollectorSchedulerStateRepository } from './collector-scheduler-state.repository';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const repo = new CollectorSchedulerStateRepository(prisma as never);

const LEASE_MS = 60_000;
const SINGLETON_ID = 'singleton';

async function resetSchedulerState(): Promise<void> {
  await repo.ensureSingleton();
  await prisma.$executeRawUnsafe(
    `
    UPDATE "CollectorSchedulerState"
    SET
      "leaseOwner" = NULL,
      "leaseExpiresAt" = NULL,
      "lastTriggerAt" = NULL,
      "lastOutcome" = NULL,
      "lastCollectorRunId" = NULL,
      "lastErrorCode" = NULL,
      "cooldownUntil" = NULL,
      "updatedAt" = now()
    WHERE id = $1::text
    `,
    SINGLETON_ID,
  );
}

async function forceLease(owner: string, expiresAt: Date): Promise<void> {
  await prisma.collectorSchedulerState.update({
    where: { id: SINGLETON_ID },
    data: {
      leaseOwner: owner,
      leaseExpiresAt: expiresAt,
    },
  });
}

async function readRaw(): Promise<CollectorSchedulerState> {
  return prisma.collectorSchedulerState.findUniqueOrThrow({
    where: { id: SINGLETON_ID },
  });
}

describe('CollectorSchedulerStateRepository (integration)', () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    await resetSchedulerState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ensureSingleton is idempotent and leaves an existing singleton intact', async () => {
    await forceLease('owner-keep', new Date(Date.now() + LEASE_MS));
    await repo.ensureSingleton();
    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-keep');
  });

  it('A: concurrent acquisitions — exactly one winner', async () => {
    const [a, b] = await Promise.all([
      repo.tryAcquireLease('owner-a', LEASE_MS),
      repo.tryAcquireLease('owner-b', LEASE_MS),
    ]);

    const wins = [a, b].filter(Boolean);
    expect(wins).toHaveLength(1);

    const state = await readRaw();
    expect(state.leaseOwner === 'owner-a' || state.leaseOwner === 'owner-b').toBe(true);
    expect(state.leaseExpiresAt).not.toBeNull();
  });

  it('B: active lease blocks second owner', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    expect(await repo.tryAcquireLease('owner-b', LEASE_MS)).toBe(false);

    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-a');
  });

  it('C: expired lease is reclaimable by another owner', async () => {
    await forceLease('owner-a', new Date(Date.now() - 5_000));

    expect(await repo.tryAcquireLease('owner-b', LEASE_MS)).toBe(true);

    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-b');
    expect(state.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('D: stale owner cannot renew after takeover', async () => {
    await forceLease('owner-a', new Date(Date.now() - 5_000));
    expect(await repo.tryAcquireLease('owner-b', LEASE_MS)).toBe(true);

    expect(await repo.renewLease('owner-a', LEASE_MS)).toBe(false);

    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-b');
  });

  it('E: stale owner cannot release after takeover', async () => {
    await forceLease('owner-a', new Date(Date.now() - 5_000));
    expect(await repo.tryAcquireLease('owner-b', LEASE_MS)).toBe(true);

    expect(await repo.releaseLease('owner-a')).toBe(false);

    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-b');
    expect(state.leaseExpiresAt).not.toBeNull();
  });

  it('F: stale owner cannot record outcome after takeover', async () => {
    await forceLease('owner-a', new Date(Date.now() - 5_000));
    expect(await repo.tryAcquireLease('owner-b', LEASE_MS)).toBe(true);
    expect(
      await repo.recordOutcome('owner-b', CollectorSchedulerOutcome.TRIGGERED),
    ).toBe(true);

    expect(
      await repo.recordOutcome('owner-a', CollectorSchedulerOutcome.FAILED_TO_START, 'STALE'),
    ).toBe(false);

    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-b');
    expect(state.lastOutcome).toBe(CollectorSchedulerOutcome.TRIGGERED);
    expect(state.lastErrorCode).toBeNull();
  });

  it('G: stale owner cannot set cooldown after takeover', async () => {
    await forceLease('owner-a', new Date(Date.now() - 5_000));
    expect(await repo.tryAcquireLease('owner-b', LEASE_MS)).toBe(true);

    const cooldownUntil = new Date(Date.now() + 30_000);
    expect(await repo.setCooldown('owner-a', cooldownUntil)).toBe(false);

    const state = await readRaw();
    expect(state.leaseOwner).toBe('owner-b');
    expect(state.cooldownUntil).toBeNull();
  });

  it('H: current owner can renew', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    const before = await readRaw();

    expect(await repo.renewLease('owner-a', LEASE_MS * 2)).toBe(true);

    const after = await readRaw();
    expect(after.leaseOwner).toBe('owner-a');
    expect(after.leaseExpiresAt!.getTime()).toBeGreaterThan(before.leaseExpiresAt!.getTime());
  });

  it('I: current owner can record outcome', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);

    expect(
      await repo.recordOutcome(
        'owner-a',
        CollectorSchedulerOutcome.FAILED_TO_START,
        'RUN_ONCE_START_FAILED',
      ),
    ).toBe(true);

    const state = await readRaw();
    expect(state.lastOutcome).toBe(CollectorSchedulerOutcome.FAILED_TO_START);
    expect(state.lastErrorCode).toBe('RUN_ONCE_START_FAILED');
  });

  it('J: current owner can release (clears lease only)', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    expect(await repo.recordTrigger('owner-a', 'run-123')).toBe(true);
    expect(
      await repo.recordOutcome('owner-a', CollectorSchedulerOutcome.TRIGGERED),
    ).toBe(true);
    const cooldownUntil = new Date(Date.now() + 60_000);
    expect(await repo.setCooldown('owner-a', cooldownUntil)).toBe(true);

    expect(await repo.releaseLease('owner-a')).toBe(true);

    const state = await readRaw();
    expect(state.leaseOwner).toBeNull();
    expect(state.leaseExpiresAt).toBeNull();
    expect(state.lastTriggerAt).not.toBeNull();
    expect(state.lastCollectorRunId).toBe('run-123');
    expect(state.lastOutcome).toBe(CollectorSchedulerOutcome.TRIGGERED);
    expect(state.cooldownUntil).not.toBeNull();
  });

  it('K: losing replica does not overwrite active winner state', async () => {
    const [a, b] = await Promise.all([
      repo.tryAcquireLease('owner-a', LEASE_MS),
      repo.tryAcquireLease('owner-b', LEASE_MS),
    ]);
    const winner = a ? 'owner-a' : 'owner-b';
    const loser = a ? 'owner-b' : 'owner-a';
    expect(a !== b).toBe(true);

    expect(
      await repo.recordOutcome(winner, CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE),
    ).toBe(true);
    expect(
      await repo.recordOutcome(loser, CollectorSchedulerOutcome.TRIGGERED, 'SHOULD_NOT_WRITE'),
    ).toBe(false);

    const state = await readRaw();
    expect(state.leaseOwner).toBe(winner);
    expect(state.lastOutcome).toBe(CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE);
    expect(state.lastErrorCode).toBeNull();
  });

  it('winning owner can record SKIPPED_BACKPRESSURE then release', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    expect(
      await repo.recordOutcome('owner-a', CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE),
    ).toBe(true);
    expect(await repo.releaseLease('owner-a')).toBe(true);

    const state = await readRaw();
    expect(state.leaseOwner).toBeNull();
    expect(state.leaseExpiresAt).toBeNull();
    expect(state.lastOutcome).toBe(CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE);
  });

  it('recordTrigger sets lastTriggerAt and lastCollectorRunId for current owner', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    expect(await repo.recordTrigger('owner-a', 'run-abc')).toBe(true);

    const state = await repo.readState();
    expect(state).not.toBeNull();
    expect(state!.lastCollectorRunId).toBe('run-abc');
    expect(state!.lastTriggerAt).not.toBeNull();
  });

  it('recordOutcome clears lastErrorCode when omitted', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    expect(
      await repo.recordOutcome(
        'owner-a',
        CollectorSchedulerOutcome.FAILED_TO_START,
        'ERR',
      ),
    ).toBe(true);
    expect(
      await repo.recordOutcome('owner-a', CollectorSchedulerOutcome.SKIPPED_COOLDOWN),
    ).toBe(true);

    const state = await readRaw();
    expect(state.lastOutcome).toBe(CollectorSchedulerOutcome.SKIPPED_COOLDOWN);
    expect(state.lastErrorCode).toBeNull();
  });

  it('current owner can set cooldown', async () => {
    expect(await repo.tryAcquireLease('owner-a', LEASE_MS)).toBe(true);
    const cooldownUntil = new Date(Date.now() + 120_000);
    expect(await repo.setCooldown('owner-a', cooldownUntil)).toBe(true);

    const state = await readRaw();
    expect(state.cooldownUntil!.getTime()).toBe(cooldownUntil.getTime());
  });
});
