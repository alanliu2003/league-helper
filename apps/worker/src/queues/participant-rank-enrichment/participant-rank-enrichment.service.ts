import type { ParticipantRankObservation, PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { RiotSharedCooldownStore } from '@league-helper/server-riot';
import {
  PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS,
  type ChampionAggregationJobPayload,
  type GameDataProvider,
  type ParticipantRankEnrichmentJobPayload,
  type ParticipantRankResolutionStatus,
} from '@league-helper/shared';
import type {
  ChampionAggregationWorkerConfig,
  ParticipantRankEnrichmentWorkerConfig,
} from '../../config.js';
import { logger } from '../../logger.js';
import { createChampionAggregationRepository } from '../champion-aggregation/champion-aggregation.repository.js';
import { enqueueChampionAggregationAfterCommit } from '../champion-aggregation/enqueue.js';
import type { PreviousParticipantDimensionSnapshot } from '../champion-aggregation/previous-keys.js';
import {
  createParticipantRankObservationRepository,
  type ParticipantRankObservationRepository,
} from './participant-rank-observation.repository.js';
import {
  resolveParticipantRankViaLeagueV4,
  type ParticipantRankResolveOutcome,
} from './participant-rank-resolver.js';
import { queueIdsForRankedQueueType } from './queue-type.js';

/** Statuses that enrichment may overwrite with a newer observation. */
const UPDATABLE_PARTICIPANT_STATUSES: ParticipantRankResolutionStatus[] = [
  'PENDING',
  'FAILED_RETRYABLE',
];

export type ParticipantRankEnrichmentServiceDeps = {
  prisma: PrismaClient;
  provider: Pick<GameDataProvider, 'getRankedEntries'>;
  sharedCooldown: Pick<RiotSharedCooldownStore, 'remainingMs' | 'extendCooldown'> | null;
  config: ParticipantRankEnrichmentWorkerConfig;
  championAggregationQueue: Queue<ChampionAggregationJobPayload>;
  championAggregationConfig: ChampionAggregationWorkerConfig;
  observationRepository?: ParticipantRankObservationRepository;
  resolveRank?: typeof resolveParticipantRankViaLeagueV4;
  now?: () => Date;
};

export type ParticipantRankEnrichmentResult = {
  status:
    | 'resolved_from_cache'
    | 'resolved_from_provider'
    | 'retryable'
    | 'fail_closed'
    | 'permanent'
    | 'noop';
  resolutionStatus: ParticipantRankResolutionStatus;
  riotCalled: boolean;
  cacheHit: boolean;
  observationId: string | null;
  updatedParticipantCount: number;
  affectedMatchIds: string[];
  providerResultCode: string | null;
  /** Milliseconds to delay the BullMQ job when retryable due to cooldown/429. */
  delayMs?: number;
  failClosed: boolean;
};

type AffectedParticipantRow = {
  id: string;
  matchId: string;
  participantId: number;
  championId: number;
  teamPosition: string;
  individualPosition: string;
  lane: string | null;
  role: string | null;
  rankTierAtIngestion: string | null;
  rankResolutionStatus: ParticipantRankResolutionStatus;
  match: {
    id: string;
    normalizedPatch: string | null;
    platformRoute: string | null;
    regionalRoute: string;
    queueId: number;
    mapId: number | null;
    gameMode: string | null;
    remake: boolean;
  };
};

function boundDelayMs(retryAfterSeconds: number, config: ParticipantRankEnrichmentWorkerConfig): number {
  const requested = Math.max(0, retryAfterSeconds) * 1000;
  return Math.min(Math.max(requested, config.backoffBaseMs), config.backoffMaxMs);
}

function delayFromOutcome(
  outcome: ParticipantRankResolveOutcome,
  config: ParticipantRankEnrichmentWorkerConfig,
  sharedRemainingMs: number,
): number {
  if (sharedRemainingMs > 0) {
    return Math.min(Math.max(sharedRemainingMs, config.backoffBaseMs), config.backoffMaxMs);
  }
  if (outcome.rateLimited) {
    const details = outcome.rateLimited.details as Record<string, unknown> | undefined;
    const retryAfter =
      typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : 2;
    return boundDelayMs(retryAfter, config);
  }
  return config.backoffBaseMs;
}

function snapshotFromRow(row: AffectedParticipantRow): PreviousParticipantDimensionSnapshot | null {
  if (!row.match.normalizedPatch || !row.match.platformRoute) {
    return null;
  }
  return {
    patch: row.match.normalizedPatch,
    platformRoute: row.match.platformRoute,
    regionalRoute: row.match.regionalRoute,
    queueId: row.match.queueId,
    mapId: row.match.mapId,
    gameMode: row.match.gameMode,
    remake: row.match.remake,
    championId: row.championId,
    teamPosition: row.teamPosition,
    individualPosition: row.individualPosition,
    lane: row.lane,
    role: row.role,
    rankTierAtIngestion: row.rankTierAtIngestion,
    rankResolutionStatus: row.rankResolutionStatus,
  };
}

async function loadAffectedParticipants(input: {
  prisma: PrismaClient;
  platformRoute: string;
  externalAccountId: string;
  queueType: ParticipantRankEnrichmentJobPayload['queueType'];
  /** Optional match-scoped hint; still updates other unresolved rows for same PUUID. */
  matchId?: string;
}): Promise<AffectedParticipantRow[]> {
  const queueIds = queueIdsForRankedQueueType(input.queueType);
  const rows = await input.prisma.matchParticipant.findMany({
    where: {
      externalAccountId: input.externalAccountId,
      rankResolutionStatus: { in: UPDATABLE_PARTICIPANT_STATUSES },
      match: {
        platformRoute: input.platformRoute,
        queueId: { in: queueIds },
      },
    },
    select: {
      id: true,
      matchId: true,
      participantId: true,
      championId: true,
      teamPosition: true,
      individualPosition: true,
      lane: true,
      role: true,
      rankTierAtIngestion: true,
      rankResolutionStatus: true,
      match: {
        select: {
          id: true,
          normalizedPatch: true,
          platformRoute: true,
          regionalRoute: true,
          queueId: true,
          mapId: true,
          gameMode: true,
          remake: true,
        },
      },
    },
  });

  // Documented scope: apply current-cycle observation to all unresolved/retryable
  // MatchParticipant rows for the same (platform, PUUID, queueType). This is
  // ingestion/enrichment-cycle rank — not historical match-start rank. Terminal
  // RESOLVED_* / FAILED_PERMANENT rows are never overwritten.
  void input.matchId;
  return rows as AffectedParticipantRow[];
}

async function applyObservationToParticipants(input: {
  prisma: PrismaClient;
  rows: AffectedParticipantRow[];
  observation: ParticipantRankObservation;
}): Promise<{ updatedParticipantCount: number; affectedMatchIds: string[] }> {
  if (input.rows.length === 0) {
    return { updatedParticipantCount: 0, affectedMatchIds: [] };
  }

  const status = input.observation.resolutionStatus as ParticipantRankResolutionStatus;
  const resolvedAt = input.observation.observedAt;
  const tier =
    status === 'RESOLVED_RANKED' ? (input.observation.observedTier ?? null) : null;
  const division =
    status === 'RESOLVED_RANKED' ? (input.observation.observedDivision ?? null) : null;

  await input.prisma.matchParticipant.updateMany({
    where: { id: { in: input.rows.map((row) => row.id) } },
    data: {
      rankResolutionStatus: status,
      rankResolvedAt: resolvedAt,
      rankObservationId: input.observation.id,
      ...(status === 'RESOLVED_RANKED'
        ? {
            rankTierAtIngestion: tier,
            rankDivisionAtIngestion: division,
          }
        : {}),
      // RESOLVED_UNRANKED / FAILED_*: leave existing tier untouched (null for PENDING).
    },
  });

  const affectedMatchIds = [...new Set(input.rows.map((row) => row.matchId))];
  return { updatedParticipantCount: input.rows.length, affectedMatchIds };
}

async function enqueueAggregationForMatches(input: {
  deps: ParticipantRankEnrichmentServiceDeps;
  previousByMatchId: Map<string, PreviousParticipantDimensionSnapshot[]>;
  correlationId?: string;
}): Promise<void> {
  const repository = createChampionAggregationRepository(input.deps.prisma);
  for (const [matchId, previousSnapshots] of input.previousByMatchId) {
    await enqueueChampionAggregationAfterCommit({
      queue: input.deps.championAggregationQueue,
      repository,
      config: input.deps.championAggregationConfig,
      matchId,
      previousSnapshots,
      correlationId: input.correlationId,
    });
  }
}

/**
 * Process one PUUID-scoped rank enrichment job.
 *
 * Flow: fresh observation reuse → else League-v4 → durable observation →
 * update unresolved MatchParticipant rows → generic aggregate convergence.
 */
export async function enrichParticipantRank(
  deps: ParticipantRankEnrichmentServiceDeps,
  payload: ParticipantRankEnrichmentJobPayload,
): Promise<ParticipantRankEnrichmentResult> {
  const observationRepository =
    deps.observationRepository ?? createParticipantRankObservationRepository(deps.prisma);
  const resolveRank = deps.resolveRank ?? resolveParticipantRankViaLeagueV4;
  const now = deps.now?.() ?? new Date();
  const freshnessMs = deps.config.observationFreshnessMs;

  const cache = await observationRepository.findFreshReusableObservation({
    platformRoute: payload.platformRoute,
    externalAccountId: payload.externalAccountId,
    queueType: payload.queueType,
    freshnessMs,
    now,
  });

  const affectedBefore = await loadAffectedParticipants({
    prisma: deps.prisma,
    platformRoute: payload.platformRoute,
    externalAccountId: payload.externalAccountId,
    queueType: payload.queueType,
    matchId: payload.matchId,
  });

  const previousByMatchId = new Map<string, PreviousParticipantDimensionSnapshot[]>();
  for (const row of affectedBefore) {
    const snapshot = snapshotFromRow(row);
    if (!snapshot) {
      continue;
    }
    const list = previousByMatchId.get(row.matchId) ?? [];
    list.push(snapshot);
    previousByMatchId.set(row.matchId, list);
  }

  if (cache.reusable) {
    const applied = await applyObservationToParticipants({
      prisma: deps.prisma,
      rows: affectedBefore,
      observation: cache.observation,
    });
    if (applied.updatedParticipantCount > 0) {
      await enqueueAggregationForMatches({
        deps,
        previousByMatchId,
        correlationId: payload.correlationId,
      });
    }
    return {
      status: 'resolved_from_cache',
      resolutionStatus: cache.observation.resolutionStatus as ParticipantRankResolutionStatus,
      riotCalled: false,
      cacheHit: true,
      observationId: cache.observation.id,
      updatedParticipantCount: applied.updatedParticipantCount,
      affectedMatchIds: applied.affectedMatchIds,
      providerResultCode: cache.observation.providerResultCode,
      failClosed: false,
    };
  }

  const outcome = await resolveRank(
    {
      provider: deps.provider,
      sharedCooldown: deps.sharedCooldown,
      riotShared429CooldownMinMs: deps.config.riotShared429CooldownMinMs,
      now: () => (deps.now?.() ?? new Date()).getTime(),
    },
    {
      platformRoute: payload.platformRoute,
      externalAccountId: payload.externalAccountId,
      queueType: payload.queueType,
    },
  );

  // Active shared cooldown / proactive budget deferral: do not append a durable
  // FAILED_RETRYABLE observation as a negative cache — leave participants
  // unresolved and defer the job.
  if (
    outcome.providerResultCode === 'SHARED_COOLDOWN_ACTIVE' ||
    outcome.providerResultCode === 'RIOT_REQUEST_BUDGET_DEFERRED'
  ) {
    const remainingMs =
      outcome.providerResultCode === 'SHARED_COOLDOWN_ACTIVE' && deps.sharedCooldown
        ? await deps.sharedCooldown.remainingMs(now.getTime())
        : (outcome.budgetDeferWaitMs ?? deps.config.backoffBaseMs);
    return {
      status: 'retryable',
      resolutionStatus: 'FAILED_RETRYABLE',
      riotCalled: false,
      cacheHit: false,
      observationId: null,
      updatedParticipantCount: 0,
      affectedMatchIds: [],
      providerResultCode: outcome.providerResultCode,
      delayMs: delayFromOutcome(outcome, deps.config, remainingMs),
      failClosed: false,
    };
  }

  const observation = await observationRepository.appendObservation({
    platformRoute: payload.platformRoute,
    externalAccountId: payload.externalAccountId,
    queueType: payload.queueType,
    observedTier: outcome.observedTier,
    observedDivision: outcome.observedDivision,
    resolutionStatus: outcome.resolutionStatus,
    observedAt: now,
    providerResultCode: outcome.providerResultCode,
  });

  const applied = await applyObservationToParticipants({
    prisma: deps.prisma,
    rows: affectedBefore,
    observation,
  });

  if (
    applied.updatedParticipantCount > 0 &&
    (outcome.resolutionStatus === 'RESOLVED_RANKED' ||
      outcome.resolutionStatus === 'RESOLVED_UNRANKED' ||
      outcome.resolutionStatus === 'FAILED_PERMANENT')
  ) {
    await enqueueAggregationForMatches({
      deps,
      previousByMatchId,
      correlationId: payload.correlationId,
    });
  } else if (
    applied.updatedParticipantCount > 0 &&
    outcome.resolutionStatus === 'FAILED_RETRYABLE'
  ) {
    // Retryable status change still needs previous∪current so ALL stays correct
    // and exact/UNKNOWN keys are not incorrectly materialized.
    await enqueueAggregationForMatches({
      deps,
      previousByMatchId,
      correlationId: payload.correlationId,
    });
  }

  if (outcome.failClosed) {
    logger.error('participant_rank_enrichment_auth_fail_closed', {
      platformRoute: payload.platformRoute,
      queueType: payload.queueType,
      providerResultCode: outcome.providerResultCode,
      correlationId: payload.correlationId,
    });
    return {
      status: 'fail_closed',
      resolutionStatus: outcome.resolutionStatus,
      riotCalled: outcome.riotCalled,
      cacheHit: false,
      observationId: observation.id,
      updatedParticipantCount: applied.updatedParticipantCount,
      affectedMatchIds: applied.affectedMatchIds,
      providerResultCode: outcome.providerResultCode,
      failClosed: true,
    };
  }

  if (outcome.resolutionStatus === 'FAILED_PERMANENT') {
    return {
      status: 'permanent',
      resolutionStatus: outcome.resolutionStatus,
      riotCalled: outcome.riotCalled,
      cacheHit: false,
      observationId: observation.id,
      updatedParticipantCount: applied.updatedParticipantCount,
      affectedMatchIds: applied.affectedMatchIds,
      providerResultCode: outcome.providerResultCode,
      failClosed: false,
    };
  }

  if (outcome.retryable) {
    return {
      status: 'retryable',
      resolutionStatus: outcome.resolutionStatus,
      riotCalled: outcome.riotCalled,
      cacheHit: false,
      observationId: observation.id,
      updatedParticipantCount: applied.updatedParticipantCount,
      affectedMatchIds: applied.affectedMatchIds,
      providerResultCode: outcome.providerResultCode,
      delayMs: delayFromOutcome(outcome, deps.config, 0),
      failClosed: false,
    };
  }

  return {
    status: 'resolved_from_provider',
    resolutionStatus: outcome.resolutionStatus,
    riotCalled: outcome.riotCalled,
    cacheHit: false,
    observationId: observation.id,
    updatedParticipantCount: applied.updatedParticipantCount,
    affectedMatchIds: applied.affectedMatchIds,
    providerResultCode: outcome.providerResultCode,
    failClosed: false,
  };
}

export { PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS };
