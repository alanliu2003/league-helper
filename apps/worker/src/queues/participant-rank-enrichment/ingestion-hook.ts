import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { ParticipantRankEnrichmentJobPayload } from '@league-helper/shared';
import type { ParticipantRankEnrichmentWorkerConfig } from '../../config.js';
import {
  enqueueParticipantRankEnrichmentAfterCommit,
  type RankEnrichmentCandidate,
} from './enqueue.js';
import { rankedQueueTypeForQueueId } from './queue-type.js';

/**
 * After ranked match COMPLETED persistence, enqueue async rank enrichment for
 * participants that still need resolution. Never blocks on League-v4.
 *
 * Non-ranked matches produce no candidates (queueType mapping returns null).
 */
export async function enqueueRankEnrichmentForCompletedMatch(input: {
  prisma: PrismaClient;
  matchId: string;
  queue: Queue<ParticipantRankEnrichmentJobPayload> | null | undefined;
  config: ParticipantRankEnrichmentWorkerConfig | null | undefined;
  correlationId?: string;
}): Promise<number> {
  if (!input.queue || !input.config) {
    return 0;
  }

  const match = await input.prisma.match.findUnique({
    where: { id: input.matchId },
    select: {
      id: true,
      platformRoute: true,
      queueId: true,
      participants: {
        select: {
          externalAccountId: true,
          rankResolutionStatus: true,
        },
      },
    },
  });

  if (!match?.platformRoute) {
    return 0;
  }

  const queueType = rankedQueueTypeForQueueId(match.queueId);
  if (!queueType) {
    return 0;
  }

  const candidates: RankEnrichmentCandidate[] = [];
  for (const participant of match.participants) {
    const puuid = participant.externalAccountId?.trim() ?? '';
    if (puuid.length === 0) {
      continue;
    }
    if (
      participant.rankResolutionStatus !== 'PENDING' &&
      participant.rankResolutionStatus !== 'FAILED_RETRYABLE'
    ) {
      continue;
    }
    candidates.push({
      platformRoute: match.platformRoute,
      externalAccountId: puuid,
      queueType,
      matchId: match.id,
    });
  }

  return enqueueParticipantRankEnrichmentAfterCommit({
    queue: input.queue,
    config: input.config,
    candidates,
    reason: 'MATCH_INGESTION',
    correlationId: input.correlationId,
  });
}
