import {
  IngestionJobStatus,
  MatchIngestionStatus,
  TimelineFetchStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { MATCH_INGESTION_JOB_NAME } from '@league-helper/shared';
import type { NormalizedMatch } from './match-normalizer.js';
import type { ParticipantTimelineMetrics } from './timeline-metrics.service.js';

export type AccountLinkMap = Map<string, string>; // externalAccountId (PUUID) -> playerAccountId

/** Batch-resolve known PlayerAccounts by provider + PUUID. Unknowns stay unlinked. */
export async function resolvePlayerAccountLinks(
  prisma: PrismaClient,
  provider: string,
  externalAccountIds: string[],
): Promise<AccountLinkMap> {
  const unique = [...new Set(externalAccountIds.filter(Boolean))];
  if (unique.length === 0) {
    return new Map();
  }

  const accounts = await prisma.playerAccount.findMany({
    where: {
      provider,
      externalAccountId: { in: unique },
    },
    select: { id: true, externalAccountId: true },
  });

  return new Map(accounts.map((account) => [account.externalAccountId, account.id]));
}

function isCompleteOrNewer(
  existingVersion: string,
  incomingVersion: string,
  existingStatus: MatchIngestionStatus,
): boolean {
  if (existingStatus !== MatchIngestionStatus.COMPLETED) {
    return false;
  }
  const existing = Number(existingVersion);
  const incoming = Number(incomingVersion);
  if (!Number.isFinite(existing) || !Number.isFinite(incoming)) {
    return existingVersion >= incomingVersion;
  }
  return existing >= incoming;
}

/**
 * Persist Match + teams + participants in one transaction.
 * Idempotent upsert: does not duplicate matches; does not overwrite COMPLETED
 * with a less-complete / older normalization.
 */
export async function persistNormalizedMatch(
  prisma: PrismaClient,
  match: NormalizedMatch,
  accountLinks: AccountLinkMap,
): Promise<{ matchId: string; created: boolean; skippedComplete: boolean }> {
  const existing = await prisma.match.findUnique({
    where: {
      provider_externalMatchId: {
        provider: match.provider,
        externalMatchId: match.externalMatchId,
      },
    },
    include: {
      participants: {
        select: { id: true, participantId: true, playerAccountId: true, externalAccountId: true },
      },
    },
  });

  if (
    existing &&
    isCompleteOrNewer(
      existing.normalizationVersion,
      match.normalizationVersion,
      existing.ingestionStatus,
    )
  ) {
    await linkMissingParticipants(prisma, existing.id, existing.participants, accountLinks);
    return { matchId: existing.id, created: false, skippedComplete: true };
  }

  const result = await prisma.$transaction(async (tx) => {
    const upserted = await tx.match.upsert({
      where: {
        provider_externalMatchId: {
          provider: match.provider,
          externalMatchId: match.externalMatchId,
        },
      },
      create: {
        provider: match.provider,
        externalMatchId: match.externalMatchId,
        platformRoute: match.platformRoute,
        regionalRoute: match.regionalRoute,
        gameId: match.gameId,
        queueId: match.queueId,
        mapId: match.mapId,
        gameMode: match.gameMode,
        gameType: match.gameType,
        gameCreation: match.gameCreation,
        gameEndTimestamp: match.gameEndTimestamp,
        gameDurationSeconds: match.gameDurationSeconds,
        gameVersion: match.gameVersion,
        normalizedPatch: match.normalizedPatch,
        remake: match.remake,
        earlySurrender: match.earlySurrender,
        ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
        normalizationVersion: match.normalizationVersion,
        rawPayload: match.rawPayload ?? undefined,
        ingestedAt: new Date(),
      },
      update: {
        platformRoute: match.platformRoute,
        regionalRoute: match.regionalRoute,
        gameId: match.gameId,
        queueId: match.queueId,
        mapId: match.mapId,
        gameMode: match.gameMode,
        gameType: match.gameType,
        gameCreation: match.gameCreation,
        gameEndTimestamp: match.gameEndTimestamp,
        gameDurationSeconds: match.gameDurationSeconds,
        gameVersion: match.gameVersion,
        normalizedPatch: match.normalizedPatch,
        remake: match.remake,
        earlySurrender: match.earlySurrender,
        ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
        normalizationVersion: match.normalizationVersion,
        ...(match.rawPayload !== null ? { rawPayload: match.rawPayload } : {}),
        ingestedAt: new Date(),
      },
    });

    for (const team of match.teams) {
      await tx.matchTeam.upsert({
        where: {
          matchId_teamId: { matchId: upserted.id, teamId: team.teamId },
        },
        create: {
          matchId: upserted.id,
          teamId: team.teamId,
          win: team.win,
          earlySurrender: team.earlySurrender,
          bans: team.bans,
          objectives: team.objectives ?? undefined,
        },
        update: {
          win: team.win,
          earlySurrender: team.earlySurrender,
          bans: team.bans,
          objectives: team.objectives ?? undefined,
        },
      });
    }

    for (const participant of match.participants) {
      const playerAccountId = participant.externalAccountId
        ? (accountLinks.get(participant.externalAccountId) ?? null)
        : null;

      await tx.matchParticipant.upsert({
        where: {
          matchId_participantId: {
            matchId: upserted.id,
            participantId: participant.participantId,
          },
        },
        create: {
          matchId: upserted.id,
          participantId: participant.participantId,
          playerAccountId,
          externalAccountId: participant.externalAccountId,
          riotIdGameName: participant.riotIdGameName,
          riotIdTagLine: participant.riotIdTagLine,
          championId: participant.championId,
          championName: participant.championName,
          teamId: participant.teamId,
          teamPosition: participant.teamPosition,
          individualPosition: participant.individualPosition,
          lane: participant.lane,
          role: participant.role,
          win: participant.win,
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
          largestKillingSpree: participant.largestKillingSpree,
          totalMinionsKilled: participant.totalMinionsKilled,
          neutralMinionsKilled: participant.neutralMinionsKilled,
          totalCs: participant.totalCs,
          goldEarned: participant.goldEarned,
          goldSpent: participant.goldSpent,
          totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
          physicalDamageDealtToChampions: participant.physicalDamageDealtToChampions,
          magicDamageDealtToChampions: participant.magicDamageDealtToChampions,
          trueDamageDealtToChampions: participant.trueDamageDealtToChampions,
          totalDamageTaken: participant.totalDamageTaken,
          visionScore: participant.visionScore,
          wardsPlaced: participant.wardsPlaced,
          wardsKilled: participant.wardsKilled,
          controlWardsPurchased: participant.controlWardsPurchased,
          timePlayedSeconds: participant.timePlayedSeconds,
          itemIds: participant.itemIds,
          perkIds: participant.perkIds,
          statPerkIds: participant.statPerkIds,
          summonerSpell1Id: participant.summonerSpell1Id,
          summonerSpell2Id: participant.summonerSpell2Id,
          rawPayload: participant.rawPayload ?? undefined,
        },
        update: {
          ...(playerAccountId ? { playerAccountId } : {}),
          externalAccountId: participant.externalAccountId,
          riotIdGameName: participant.riotIdGameName,
          riotIdTagLine: participant.riotIdTagLine,
          championId: participant.championId,
          championName: participant.championName,
          teamId: participant.teamId,
          teamPosition: participant.teamPosition,
          individualPosition: participant.individualPosition,
          lane: participant.lane,
          role: participant.role,
          win: participant.win,
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
          largestKillingSpree: participant.largestKillingSpree,
          totalMinionsKilled: participant.totalMinionsKilled,
          neutralMinionsKilled: participant.neutralMinionsKilled,
          totalCs: participant.totalCs,
          goldEarned: participant.goldEarned,
          goldSpent: participant.goldSpent,
          totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
          physicalDamageDealtToChampions: participant.physicalDamageDealtToChampions,
          magicDamageDealtToChampions: participant.magicDamageDealtToChampions,
          trueDamageDealtToChampions: participant.trueDamageDealtToChampions,
          totalDamageTaken: participant.totalDamageTaken,
          visionScore: participant.visionScore,
          wardsPlaced: participant.wardsPlaced,
          wardsKilled: participant.wardsKilled,
          controlWardsPurchased: participant.controlWardsPurchased,
          timePlayedSeconds: participant.timePlayedSeconds,
          itemIds: participant.itemIds,
          perkIds: participant.perkIds,
          statPerkIds: participant.statPerkIds,
          summonerSpell1Id: participant.summonerSpell1Id,
          summonerSpell2Id: participant.summonerSpell2Id,
          ...(participant.rawPayload !== null ? { rawPayload: participant.rawPayload } : {}),
        },
      });
    }

    return upserted;
  });

  return {
    matchId: result.id,
    created: !existing,
    skippedComplete: false,
  };
}

async function linkMissingParticipants(
  prisma: PrismaClient,
  matchId: string,
  participants: Array<{
    id: string;
    participantId: number;
    playerAccountId: string | null;
    externalAccountId: string | null;
  }>,
  accountLinks: AccountLinkMap,
): Promise<void> {
  for (const participant of participants) {
    if (participant.playerAccountId || !participant.externalAccountId) {
      continue;
    }
    const accountId = accountLinks.get(participant.externalAccountId);
    if (!accountId) {
      continue;
    }
    await prisma.matchParticipant.update({
      where: { id: participant.id },
      data: { playerAccountId: accountId },
    });
  }
  void matchId;
}

export async function persistTimelineAndMetrics(input: {
  prisma: PrismaClient;
  matchId: string;
  fetchStatus: TimelineFetchStatus;
  rawPayload: Prisma.InputJsonValue | null;
  timelineSchemaVersion: string;
  failureReason?: string | null;
  metrics: ParticipantTimelineMetrics[];
  markMatchCompleted: boolean;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await tx.matchTimeline.upsert({
      where: { matchId: input.matchId },
      create: {
        matchId: input.matchId,
        fetchStatus: input.fetchStatus,
        rawPayload: input.rawPayload ?? undefined,
        timelineSchemaVersion: input.timelineSchemaVersion,
        fetchedAt: input.fetchStatus === TimelineFetchStatus.FETCHED ? new Date() : null,
        failureReason: input.failureReason ?? null,
      },
      update: {
        fetchStatus: input.fetchStatus,
        ...(input.rawPayload !== null ? { rawPayload: input.rawPayload } : {}),
        timelineSchemaVersion: input.timelineSchemaVersion,
        fetchedAt: input.fetchStatus === TimelineFetchStatus.FETCHED ? new Date() : null,
        failureReason: input.failureReason ?? null,
      },
    });

    for (const metric of input.metrics) {
      await tx.matchParticipant.update({
        where: {
          matchId_participantId: {
            matchId: input.matchId,
            participantId: metric.participantId,
          },
        },
        data: {
          goldAt10: metric.goldAt10,
          goldAt15: metric.goldAt15,
          csAt10: metric.csAt10,
          csAt15: metric.csAt15,
          xpAt10: metric.xpAt10,
          xpAt15: metric.xpAt15,
          goldDifferenceAt10: metric.goldDifferenceAt10,
          goldDifferenceAt15: metric.goldDifferenceAt15,
          csDifferenceAt10: metric.csDifferenceAt10,
          csDifferenceAt15: metric.csDifferenceAt15,
          xpDifferenceAt10: metric.xpDifferenceAt10,
          xpDifferenceAt15: metric.xpDifferenceAt15,
          deathsBefore10: metric.deathsBefore10,
          deathsBetween10And20: metric.deathsBetween10And20,
          deathsBeforeObjectives: metric.deathsBeforeObjectives,
          firstCompletedItemId: metric.firstCompletedItemId,
          firstCompletedItemAtSeconds: metric.firstCompletedItemAtSeconds,
          killParticipation: metric.killParticipation,
          skillOrder: metric.skillOrder,
        },
      });
    }

    if (input.markMatchCompleted) {
      await tx.match.update({
        where: { id: input.matchId },
        data: {
          ingestionStatus: MatchIngestionStatus.COMPLETED,
          ingestedAt: new Date(),
        },
      });
    }
  });
}

export async function markDurableJobRunning(input: {
  prisma: PrismaClient;
  idempotencyKey: string;
  provider: string;
  externalMatchId: string;
  attemptCount: number;
  maxAttempts: number;
  metadata: Prisma.InputJsonValue;
}): Promise<{ id: string }> {
  const existing = await input.prisma.ingestionJobRecord.findUnique({
    where: {
      jobType_idempotencyKey: {
        jobType: MATCH_INGESTION_JOB_NAME,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (existing) {
    const updated = await input.prisma.ingestionJobRecord.update({
      where: { id: existing.id },
      data: {
        status: IngestionJobStatus.RUNNING,
        startedAt: new Date(),
        attemptCount: input.attemptCount,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
      select: { id: true },
    });
    return updated;
  }

  const created = await input.prisma.ingestionJobRecord.create({
    data: {
      jobType: MATCH_INGESTION_JOB_NAME,
      idempotencyKey: input.idempotencyKey,
      provider: input.provider,
      externalResourceId: input.externalMatchId,
      status: IngestionJobStatus.RUNNING,
      attemptCount: input.attemptCount,
      maxAttempts: input.maxAttempts,
      startedAt: new Date(),
      metadata: input.metadata,
    },
    select: { id: true },
  });
  return created;
}

export async function markDurableJobStatus(input: {
  prisma: PrismaClient;
  durableJobId: string;
  status: IngestionJobStatus;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): Promise<void> {
  const completed =
    input.status === IngestionJobStatus.COMPLETED ||
    input.status === IngestionJobStatus.FAILED ||
    input.status === IngestionJobStatus.DEAD_LETTERED ||
    input.status === IngestionJobStatus.CANCELLED;

  await input.prisma.ingestionJobRecord.update({
    where: { id: input.durableJobId },
    data: {
      status: input.status,
      lastErrorCode: input.lastErrorCode ?? undefined,
      lastErrorMessage: input.lastErrorMessage ?? undefined,
      completedAt: completed ? new Date() : undefined,
      deadLetteredAt: input.status === IngestionJobStatus.DEAD_LETTERED ? new Date() : undefined,
    },
  });
}

export async function ensurePlayerLinkageForCompletedMatch(input: {
  prisma: PrismaClient;
  provider: string;
  externalMatchId: string;
  requestedByPlayerAccountId: string;
}): Promise<string[]> {
  const match = await input.prisma.match.findUnique({
    where: {
      provider_externalMatchId: {
        provider: input.provider,
        externalMatchId: input.externalMatchId,
      },
    },
    include: {
      participants: {
        select: { id: true, playerAccountId: true, externalAccountId: true },
      },
    },
  });

  if (!match) {
    return [];
  }

  const externalIds = match.participants
    .map((participant) => participant.externalAccountId)
    .filter((id): id is string => Boolean(id));
  const links = await resolvePlayerAccountLinks(input.prisma, input.provider, externalIds);

  const linkedAccountIds = new Set<string>();
  for (const participant of match.participants) {
    if (participant.playerAccountId) {
      linkedAccountIds.add(participant.playerAccountId);
      continue;
    }
    if (!participant.externalAccountId) {
      continue;
    }
    const accountId = links.get(participant.externalAccountId);
    if (!accountId) {
      continue;
    }
    await input.prisma.matchParticipant.update({
      where: { id: participant.id },
      data: { playerAccountId: accountId },
    });
    linkedAccountIds.add(accountId);
  }

  linkedAccountIds.add(input.requestedByPlayerAccountId);
  return [...linkedAccountIds];
}
