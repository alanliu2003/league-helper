import type { PrismaClient, TrackedPlayer } from '@prisma/client';
import { parsePlatformRoute } from '@league-helper/shared';
import { attributeAsyncExpansionCounters } from './participant-expansion.counters.js';
import {
  loadParticipantExpansionConfig,
  type ParticipantExpansionConfig,
} from './participant-expansion.config.js';
import {
  applyDiscoveryDepthMin,
  reserveAndCreateTrackedParticipant,
} from './participant-expansion.reserve.js';
import {
  selectExpansionCandidates,
  type StableParticipantIdentity,
} from './participant-expansion.select.js';
import { upsertPlayerAccountIdentity } from './upsert-player-account.js';

export type ExpandFromCompletedMatchInput = {
  matchId: string;
  queueId: number;
  platformRoute: string;
  regionalRoute: string;
  provider?: string;
  /** PlayerAccount id that requested ingestion (source tracked player). */
  requestedByPlayerAccountId: string;
  participants: StableParticipantIdentity[];
  /** Optional attribution; missing/absent run → un-attributed path. */
  sourceCollectorRunId?: string | null;
};

export type ExpansionCandidateOutcome =
  | 'created'
  | 'already_tracked'
  | 'skipped_depth_limit'
  | 'skipped_total_cap'
  | 'skipped_population_cap'
  | 'skipped_run_cap'
  | 'skipped_source_cap'
  | 'skipped_identity';

export type ExpandFromCompletedMatchResult = {
  skipped: boolean;
  reason?:
    | 'disabled'
    | 'unsupported_queue'
    | 'unsupported_platform'
    | 'source_not_tracked'
    | 'source_identity_missing';
  participantsConsidered: number;
  outcomes: Array<{
    externalAccountId: string;
    participantId: number;
    outcome: ExpansionCandidateOutcome;
  }>;
};

const PROVIDER = 'RIOT';

/**
 * Domain orchestration for participant expansion.
 * Invoked post-COMPLETED via expandMatchParticipantsSafe (non-fatal).
 *
 * Does not enqueue collection, recurse, or call runOnce.
 */
export async function expandFromCompletedMatch(
  prisma: PrismaClient,
  input: ExpandFromCompletedMatchInput,
  config: ParticipantExpansionConfig = loadParticipantExpansionConfig(),
): Promise<ExpandFromCompletedMatchResult> {
  if (!config.expandFromParticipants) {
    return {
      skipped: true,
      reason: 'disabled',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  if (input.queueId !== config.expansionQueueId) {
    return {
      skipped: true,
      reason: 'unsupported_queue',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  let platformRoute: string;
  try {
    platformRoute = parsePlatformRoute(input.platformRoute);
  } catch {
    return {
      skipped: true,
      reason: 'unsupported_platform',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  if (!config.platformAllowlist.includes(platformRoute)) {
    return {
      skipped: true,
      reason: 'unsupported_platform',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  const provider = input.provider ?? PROVIDER;
  if (provider !== PROVIDER) {
    return {
      skipped: true,
      reason: 'unsupported_platform',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  const sourceTracked = await prisma.trackedPlayer.findUnique({
    where: { playerAccountId: input.requestedByPlayerAccountId },
  });
  if (!sourceTracked) {
    return {
      skipped: true,
      reason: 'source_not_tracked',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  const sourceAccount = await prisma.playerAccount.findUnique({
    where: { id: input.requestedByPlayerAccountId },
    select: { externalAccountId: true },
  });
  if (!sourceAccount?.externalAccountId) {
    return {
      skipped: true,
      reason: 'source_identity_missing',
      participantsConsidered: 0,
      outcomes: [],
    };
  }

  // Fixed lifetime window from stable identity ONLY — before mutable tracked inspection.
  const window = selectExpansionCandidates({
    participants: input.participants,
    sourceExternalAccountId: sourceAccount.externalAccountId,
    maxPerMatch: config.expansionMaxNewPlayersPerMatch,
  });

  const outcomes: ExpandFromCompletedMatchResult['outcomes'] = [];
  const sourceDepth = sourceTracked.discoveryDepth;
  const proposedChildDepth = sourceDepth + 1;

  for (const candidate of window) {
    const existing = await findTrackedByExternalAccountId(
      prisma,
      provider,
      candidate.externalAccountId,
    );

    if (existing) {
      await applyDiscoveryDepthMin(prisma, {
        playerAccountId: existing.playerAccountId,
        proposedDepth: proposedChildDepth,
      });
      outcomes.push({
        externalAccountId: candidate.externalAccountId,
        participantId: candidate.participantId,
        outcome: 'already_tracked',
      });
      continue;
    }

    if (proposedChildDepth > config.expansionMaxDepth) {
      outcomes.push({
        externalAccountId: candidate.externalAccountId,
        participantId: candidate.participantId,
        outcome: 'skipped_depth_limit',
      });
      continue;
    }

    // Upsert account outside quota TX (no network I/O).
    let account;
    try {
      account = await upsertPlayerAccountIdentity(prisma, {
        provider,
        externalAccountId: candidate.externalAccountId,
        platformRoute,
        regionalRoute: input.regionalRoute,
        gameName: candidate.riotIdGameName,
        tagLine: candidate.riotIdTagLine,
      });
    } catch {
      outcomes.push({
        externalAccountId: candidate.externalAccountId,
        participantId: candidate.participantId,
        outcome: 'skipped_identity',
      });
      continue;
    }

    // Re-check tracked after upsert (another worker may have enrolled).
    const raced = await prisma.trackedPlayer.findUnique({
      where: { playerAccountId: account.id },
    });
    if (raced) {
      await applyDiscoveryDepthMin(prisma, {
        playerAccountId: raced.playerAccountId,
        proposedDepth: proposedChildDepth,
      });
      outcomes.push({
        externalAccountId: candidate.externalAccountId,
        participantId: candidate.participantId,
        outcome: 'already_tracked',
      });
      continue;
    }

    const result = await reserveAndCreateTrackedParticipant(prisma, {
      playerAccountId: account.id,
      provider,
      platformRoute,
      discoveryDepth: proposedChildDepth,
      sourceCollectorRunId: input.sourceCollectorRunId,
      sourceTrackedPlayerId: sourceTracked.id,
      totalCap: config.totalTrackedPlayersHardCap,
      globalCap: config.expansionMaxTrackedPlayers,
      runCap: config.expansionMaxNewPlayersPerRun,
      sourceCap: config.expansionMaxNewPlayersPerSourcePlayer,
    });

    if (result.outcome === 'created') {
      outcomes.push({
        externalAccountId: candidate.externalAccountId,
        participantId: candidate.participantId,
        outcome: 'created',
      });
      continue;
    }

    if (result.outcome === 'already_tracked') {
      await applyDiscoveryDepthMin(prisma, {
        playerAccountId: result.trackedPlayer.playerAccountId,
        proposedDepth: proposedChildDepth,
      });
      outcomes.push({
        externalAccountId: candidate.externalAccountId,
        participantId: candidate.participantId,
        outcome: 'already_tracked',
      });
      continue;
    }

    outcomes.push({
      externalAccountId: candidate.externalAccountId,
      participantId: candidate.participantId,
      outcome: result.outcome,
    });
  }

  // Async post-finalization metrics only. Reservation TX already incremented
  // playersEnrolledFromParticipants for attributed creates — do not double-count.
  await attributeAsyncExpansionCounters(
    prisma,
    input.sourceCollectorRunId,
    outcomes,
    window.length,
  );

  return {
    skipped: false,
    participantsConsidered: window.length,
    outcomes,
  };
}

async function findTrackedByExternalAccountId(
  prisma: PrismaClient,
  provider: string,
  externalAccountId: string,
): Promise<TrackedPlayer | null> {
  const account = await prisma.playerAccount.findUnique({
    where: {
      provider_externalAccountId: { provider, externalAccountId },
    },
    select: { id: true },
  });
  if (!account) {
    return null;
  }
  return prisma.trackedPlayer.findUnique({
    where: { playerAccountId: account.id },
  });
}
