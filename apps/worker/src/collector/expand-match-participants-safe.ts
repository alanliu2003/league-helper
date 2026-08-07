import type { PrismaClient } from '@prisma/client';
import { logger } from '../logger.js';
import {
  loadParticipantExpansionConfig,
  type ParticipantExpansionConfig,
} from './participant-expansion.config.js';
import {
  expandFromCompletedMatch,
  type ExpandFromCompletedMatchResult,
} from './participant-expansion.service.js';

export type ExpandMatchParticipantsSafeInput = {
  prisma: PrismaClient;
  matchId: string;
  requestedByPlayerAccountId: string;
  sourceCollectorRunId?: string | null;
  correlationId?: string;
  /** Injectable for tests. */
  loadConfig?: () => ParticipantExpansionConfig;
  /** Injectable for tests. */
  expand?: typeof expandFromCompletedMatch;
};

/**
 * Non-fatal post-COMPLETED participant expansion hook.
 * Mirrors enqueueAggregationSafe isolation: failures never fail match ingestion.
 *
 * When COLLECTOR_EXPAND_FROM_PARTICIPANTS=false: true zero-op (no expansion DB reads).
 */
export async function expandMatchParticipantsSafe(
  input: ExpandMatchParticipantsSafeInput,
): Promise<ExpandFromCompletedMatchResult | { skipped: true; reason: 'disabled' | 'match_missing' | 'error' }> {
  try {
    const loadConfig = input.loadConfig ?? loadParticipantExpansionConfig;
    const config = loadConfig();

    if (!config.expandFromParticipants) {
      return { skipped: true, reason: 'disabled' };
    }

    const expand = input.expand ?? expandFromCompletedMatch;

    const match = await input.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        queueId: true,
        platformRoute: true,
        regionalRoute: true,
        participants: {
          select: {
            externalAccountId: true,
            riotIdGameName: true,
            riotIdTagLine: true,
            participantId: true,
          },
        },
      },
    });

    if (!match?.platformRoute) {
      logger.warn('Participant expansion skipped: match missing or incomplete', {
        correlationId: input.correlationId,
        // matchId is an internal UUID — safe ops identifier
        matchId: input.matchId,
      });
      return { skipped: true, reason: 'match_missing' };
    }

    return await expand(
      input.prisma,
      {
        matchId: match.id,
        queueId: match.queueId,
        platformRoute: match.platformRoute,
        regionalRoute: match.regionalRoute,
        requestedByPlayerAccountId: input.requestedByPlayerAccountId,
        participants: match.participants,
        sourceCollectorRunId: input.sourceCollectorRunId,
      },
      config,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown';
    // Never log PUUID, API keys, raw Riot payloads, or connection URLs.
    logger.warn('Participant expansion failed (non-fatal)', {
      correlationId: input.correlationId,
      matchId: input.matchId,
      errorName: error instanceof Error ? error.name : 'Error',
      // Bound message length; strip obvious secret-looking substrings.
      errorMessage: sanitizeExpansionErrorMessage(message),
    });
    return { skipped: true, reason: 'error' };
  }
}

function sanitizeExpansionErrorMessage(message: string): string {
  const truncated = message.slice(0, 200);
  return truncated
    .replace(/postgresql:\/\/[^\s]+/gi, '[redacted]')
    .replace(/redis:\/\/[^\s]+/gi, '[redacted]')
    .replace(/RGAPI-[A-Za-z0-9_-]+/g, '[redacted]');
}
