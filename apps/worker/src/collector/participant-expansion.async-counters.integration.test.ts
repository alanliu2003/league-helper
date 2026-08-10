import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CollectorRunStatus,
  MatchIngestionStatus,
  PrismaClient,
  TrackedPlayerEnrollmentSource,
  TrackedPlayerStatus,
} from '@prisma/client';
import { expandMatchParticipantsSafe } from './expand-match-participants-safe.js';
import { expandFromCompletedMatch } from './participant-expansion.service.js';
import type { ParticipantExpansionConfig } from './participant-expansion.config.js';

const testDatabaseUrl =
  process.env.WORKER_TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_worker_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const PROVIDER = 'RIOT';
const PLATFORM = 'na1';

function expansionConfig(
  overrides: Partial<ParticipantExpansionConfig> = {},
): ParticipantExpansionConfig {
  return {
    expandFromParticipants: true,
    expansionMaxDepth: 1,
    expansionMaxNewPlayersPerMatch: 3,
    expansionMaxNewPlayersPerSourcePlayer: 5,
    expansionMaxNewPlayersPerRun: 20,
    expansionMaxTrackedPlayers: 500,
    expansionQueueId: 420,
    platformAllowlist: [PLATFORM],
    totalTrackedPlayersHardCap: 5000,
    ...overrides,
  };
}

async function reset(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CollectorRunSourceQuota",
      "CollectorRun",
      "TrackedPlayer",
      "MatchParticipant",
      "Match",
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
  externalAccountId: string;
}> {
  const player = await prisma.player.create({ data: {} });
  const externalAccountId = `puuid-${suffix}-${randomUUID().slice(0, 8)}`;
  const account = await prisma.playerAccount.create({
    data: {
      playerId: player.id,
      provider: PROVIDER,
      externalAccountId,
      platformRoute: PLATFORM,
      regionalRoute: 'americas',
      currentGameName: `Player${suffix}`,
      currentTagLine: 'NA1',
      normalizedGameName: `player${suffix}`,
      normalizedTagLine: 'na1',
    },
  });
  return { playerAccountId: account.id, externalAccountId };
}

async function seedSourceTracked(suffix: string): Promise<{
  trackedPlayerId: string;
  playerAccountId: string;
  externalAccountId: string;
}> {
  const account = await seedAccount(suffix);
  const tracked = await prisma.trackedPlayer.create({
    data: {
      playerAccountId: account.playerAccountId,
      provider: PROVIDER,
      platformRoute: PLATFORM,
      enrollmentSource: TrackedPlayerEnrollmentSource.ADMIN_SEED,
      discoveryDepth: 0,
      status: TrackedPlayerStatus.ACTIVE,
      priority: 0,
      nextEligibleAt: new Date(),
    },
  });
  return {
    trackedPlayerId: tracked.id,
    playerAccountId: account.playerAccountId,
    externalAccountId: account.externalAccountId,
  };
}

async function seedTerminalRun(): Promise<string> {
  const run = await prisma.collectorRun.create({
    data: {
      ownerToken: `owner-${randomUUID()}`,
      status: CollectorRunStatus.COMPLETED,
      startedAt: new Date(),
      finishedAt: new Date(),
      effectivePlatforms: [PLATFORM],
      queueId: 420,
      batchLimit: 10,
      concurrency: 2,
      playersClaimed: 2,
      playersAttempted: 2,
      playersSucceeded: 1,
      playersFailed: 1,
      ownershipLost: 0,
      matchIdsDiscovered: 5,
      matchesEnqueued: 3,
      matchesSkippedComplete: 2,
    },
  });
  return run.id;
}

function participantCreate(input: {
  participantId: number;
  externalAccountId: string;
  gameName: string;
}) {
  return {
    participantId: input.participantId,
    externalAccountId: input.externalAccountId,
    riotIdGameName: input.gameName,
    riotIdTagLine: 'NA1',
    championId: 1,
    teamId: 100,
    teamPosition: 'TOP',
    individualPosition: 'TOP',
    win: true,
    kills: 0,
    deaths: 0,
    assists: 0,
  };
}

describe('participant expansion async counters + safe wrapper (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('attributes async counters on terminal CollectorRun without changing Task 3 fields or double-counting enrolled', async () => {
    const runId = await seedTerminalRun();
    const source = await seedSourceTracked('async-src');
    const candidates = await Promise.all([
      seedAccount('async-a'),
      seedAccount('async-b'),
    ]);

    // Pre-enroll one candidate → already_tracked path
    await prisma.trackedPlayer.create({
      data: {
        playerAccountId: candidates[0]!.playerAccountId,
        provider: PROVIDER,
        platformRoute: PLATFORM,
        enrollmentSource: TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT,
        discoveryDepth: 1,
        status: TrackedPlayerStatus.ACTIVE,
        priority: 0,
        nextEligibleAt: new Date(),
      },
    });
    await prisma.collectorPopulationBudget.update({
      where: { id: 'singleton' },
      data: { matchParticipantEnrolledCount: 1 },
    });

    const result = await expandFromCompletedMatch(
      prisma,
      {
        matchId: randomUUID(),
        queueId: 420,
        platformRoute: PLATFORM,
        regionalRoute: 'americas',
        requestedByPlayerAccountId: source.playerAccountId,
        sourceCollectorRunId: runId,
        participants: [
          {
            externalAccountId: source.externalAccountId,
            riotIdGameName: 'Source',
            riotIdTagLine: 'NA1',
            participantId: 1,
          },
          {
            externalAccountId: candidates[0]!.externalAccountId,
            riotIdGameName: 'Already',
            riotIdTagLine: 'NA1',
            participantId: 2,
          },
          {
            externalAccountId: candidates[1]!.externalAccountId,
            riotIdGameName: 'NewOne',
            riotIdTagLine: 'NA1',
            participantId: 3,
          },
        ],
      },
      expansionConfig({ expansionMaxNewPlayersPerMatch: 3 }),
    );

    expect(result.skipped).toBe(false);
    expect(result.outcomes.some((o) => o.outcome === 'created')).toBe(true);
    expect(result.outcomes.some((o) => o.outcome === 'already_tracked')).toBe(true);

    const run = await prisma.collectorRun.findUniqueOrThrow({ where: { id: runId } });
    // Task 3 invariants untouched
    expect(run.status).toBe(CollectorRunStatus.COMPLETED);
    expect(run.playersClaimed).toBe(2);
    expect(run.playersAttempted).toBe(2);
    expect(run.playersSucceeded).toBe(1);
    expect(run.playersFailed).toBe(1);
    expect(run.ownershipLost).toBe(0);
    expect(run.matchIdsDiscovered).toBe(5);
    expect(run.matchesEnqueued).toBe(3);
    // Task 4 async
    expect(run.participantsConsidered).toBe(result.participantsConsidered);
    expect(run.playersAlreadyTrackedFromParticipants).toBeGreaterThanOrEqual(1);
    // enrolled incremented exactly once by reservation TX (not doubled by async attribution)
    expect(run.playersEnrolledFromParticipants).toBe(1);
  });

  it('concurrent expandMatchParticipantsSafe respects global autonomous cap', async () => {
    const runId = await seedTerminalRun();
    const source = await seedSourceTracked('safe-src');
    const N = 2;

    const matches = await Promise.all(
      Array.from({ length: N + 2 }, async (_, i) => {
        const candidate = await seedAccount(`safe-c-${i}`);
        const match = await prisma.match.create({
          data: {
            provider: PROVIDER,
            externalMatchId: `NA1_SAFE_${i}_${randomUUID().slice(0, 8)}`,
            platformRoute: PLATFORM,
            regionalRoute: 'americas',
            queueId: 420,
            gameCreation: new Date(),
            gameDurationSeconds: 1800,
            gameVersion: '14.1.1',
            ingestionStatus: MatchIngestionStatus.COMPLETED,
            normalizationVersion: '1',
            participants: {
              create: [
                participantCreate({
                  participantId: 1,
                  externalAccountId: source.externalAccountId,
                  gameName: 'Source',
                }),
                participantCreate({
                  participantId: 2,
                  externalAccountId: candidate.externalAccountId,
                  gameName: `Cand${i}`,
                }),
              ],
            },
          },
        });
        return match;
      }),
    );

    await Promise.all(
      matches.map((match) =>
        expandMatchParticipantsSafe({
          prisma,
          matchId: match.id,
          requestedByPlayerAccountId: source.playerAccountId,
          sourceCollectorRunId: runId,
          loadConfig: () =>
            expansionConfig({
              expansionMaxTrackedPlayers: N,
              expansionMaxNewPlayersPerMatch: 1,
              expansionMaxNewPlayersPerRun: 50,
              expansionMaxNewPlayersPerSourcePlayer: 50,
            }),
        }),
      ),
    );

    const budget = await prisma.collectorPopulationBudget.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    const enrolled = await prisma.trackedPlayer.count({
      where: { enrollmentSource: TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT },
    });
    expect(budget.matchParticipantEnrolledCount).toBeLessThanOrEqual(N);
    expect(enrolled).toBeLessThanOrEqual(N);
  });
});
