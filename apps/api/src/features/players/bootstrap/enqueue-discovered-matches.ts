import { IngestionJobStatus, type PlayerAccount } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_NORMALIZATION_VERSION,
  buildMatchIngestionBullMqJobId,
  buildMatchIngestionIdempotencyKey,
  type MatchIngestionJobPayload,
  type PlayerSafeWarning,
} from '@league-helper/shared';
import type { IngestionJobRepository } from '../../../persistence/ingestion-job.repository';
import type { MatchRepository } from '../../../persistence/match.repository';
import type { MatchIngestionProducer } from '../../../queues/match-ingestion.producer';

export type EnqueueDiscoveredMatchesDeps = {
  matches: Pick<
    MatchRepository,
    | 'linkParticipantsByExternalAccountId'
    | 'findExistingByExternalIds'
    | 'findLinkedCompletedExternalIds'
    | 'findExistingExternalIdsMissingLink'
  >;
  ingestionJobs: Pick<
    IngestionJobRepository,
    'findByExternalResourceIds' | 'createIdempotent' | 'updateStatus'
  >;
  producer: Pick<MatchIngestionProducer, 'enqueueMatch' | 'getJobStates'>;
  matchIngestionJobAttempts: number;
  logger: { log: (message: unknown) => void };
  invalidatePlayerCache: (playerId: string) => Promise<void>;
};

export type EnqueueDiscoveredMatchesResult = {
  warnings: PlayerSafeWarning[];
  enqueuedCount: number;
  skippedAlreadyCompleteCount: number;
};

/**
 * Shared match-ingestion enqueue path used by player search and bootstrap.
 * Dry-run must not call this helper.
 */
export async function enqueueDiscoveredMatches(
  deps: EnqueueDiscoveredMatchesDeps,
  input: {
    account: PlayerAccount;
    discoveredMatchIds: string[];
    correlationId: string;
  },
): Promise<EnqueueDiscoveredMatchesResult> {
  const warnings: PlayerSafeWarning[] = [];
  const { account, discoveredMatchIds, correlationId } = input;
  if (discoveredMatchIds.length === 0) {
    return { warnings, enqueuedCount: 0, skippedAlreadyCompleteCount: 0 };
  }

  // Repair participant links for this account's PUUID before classifying work.
  const linkedRows = await deps.matches.linkParticipantsByExternalAccountId(
    account.provider,
    account.externalAccountId,
    account.id,
  );
  if (linkedRows > 0) {
    deps.logger.log({
      message: 'Linked existing match participants by account identity',
      correlationId,
      playerId: account.playerId,
      linkedParticipantRows: linkedRows,
    });
    await deps.invalidatePlayerCache(account.playerId);
  }

  const [existingMatches, linkedCompletedIds, missingLinkIds, durableJobs] = await Promise.all([
    deps.matches.findExistingByExternalIds(account.provider, discoveredMatchIds),
    deps.matches.findLinkedCompletedExternalIds(account.id, discoveredMatchIds),
    deps.matches.findExistingExternalIdsMissingLink(
      account.provider,
      account.id,
      discoveredMatchIds,
    ),
    deps.ingestionJobs.findByExternalResourceIds(
      MATCH_INGESTION_JOB_NAME,
      account.provider,
      discoveredMatchIds,
    ),
  ]);

  const knownIds = new Set(existingMatches.map((match) => match.externalMatchId));
  const linkedCompleted = new Set(linkedCompletedIds);
  const jobByMatchId = new Map(
    durableJobs.map((job) => [job.externalResourceId ?? '', job] as const),
  );

  const jobIds = discoveredMatchIds.map((externalMatchId) =>
    buildMatchIngestionBullMqJobId({
      provider: account.provider,
      regionalRoute: account.regionalRoute,
      externalMatchId,
      normalizationVersion: MATCH_INGESTION_NORMALIZATION_VERSION,
    }),
  );
  const bullStates = await deps.producer.getJobStates(jobIds);
  const bullStateByExternal = new Map<string, string | null>();
  discoveredMatchIds.forEach((externalMatchId, index) => {
    const jobId = jobIds[index];
    bullStateByExternal.set(externalMatchId, jobId ? (bullStates.get(jobId) ?? null) : null);
  });

  const idsNeedingPublication = new Set<string>();
  let skippedAlreadyCompleteCount = 0;

  for (const externalMatchId of discoveredMatchIds) {
    if (linkedCompleted.has(externalMatchId)) {
      skippedAlreadyCompleteCount += 1;
      continue;
    }

    const bullState = bullStateByExternal.get(externalMatchId);
    const durable = jobByMatchId.get(externalMatchId);
    const matchExists = knownIds.has(externalMatchId);
    const needsLinkRepair = missingLinkIds.includes(externalMatchId);

    // Active/waiting/delayed BullMQ work — leave alone.
    if (bullState === 'waiting' || bullState === 'active' || bullState === 'delayed') {
      continue;
    }

    // Durable pending/queued without a live Redis job → repair publish.
    // Includes completed/failed BullMQ records that stranded durable QUEUED rows.
    if (
      durable &&
      (durable.status === IngestionJobStatus.PENDING ||
        durable.status === IngestionJobStatus.QUEUED) &&
      (bullState === null ||
        bullState === undefined ||
        bullState === 'completed' ||
        bullState === 'failed')
    ) {
      idsNeedingPublication.add(externalMatchId);
      continue;
    }

    // No Match yet, or Match exists but this player is not linked → ensure a job.
    if (!matchExists || needsLinkRepair) {
      idsNeedingPublication.add(externalMatchId);
    }
  }

  const discoveredAt = new Date().toISOString();

  for (const externalMatchId of idsNeedingPublication) {
    const payload: MatchIngestionJobPayload = {
      provider: 'RIOT',
      externalMatchId,
      regionalRoute: account.regionalRoute as MatchIngestionJobPayload['regionalRoute'],
      requestedByPlayerAccountId: account.id,
      correlationId,
      normalizationVersion: MATCH_INGESTION_NORMALIZATION_VERSION,
      discoveredAt,
    };

    const idempotencyKey = buildMatchIngestionIdempotencyKey({
      provider: payload.provider,
      regionalRoute: payload.regionalRoute,
      externalMatchId: payload.externalMatchId,
      normalizationVersion: payload.normalizationVersion,
    });

    const existingDurable = jobByMatchId.get(externalMatchId);
    const { job } = existingDurable
      ? { job: existingDurable }
      : await deps.ingestionJobs.createIdempotent({
          jobType: MATCH_INGESTION_JOB_NAME,
          idempotencyKey,
          provider: account.provider,
          externalResourceId: externalMatchId,
          status: IngestionJobStatus.PENDING,
          metadata: payload,
          maxAttempts: deps.matchIngestionJobAttempts,
        });

    const result = await deps.producer.enqueueMatch(payload);
    if (result.published) {
      await deps.ingestionJobs.updateStatus(job.id, IngestionJobStatus.QUEUED, {
        scheduledAt: new Date(),
        metadata: payload,
      });
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return {
    warnings,
    enqueuedCount: idsNeedingPublication.size,
    skippedAlreadyCompleteCount,
  };
}
