import type { ParticipantRankObservation, PrismaClient } from '@prisma/client';
import {
  PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS,
  type ParticipantRankResolutionStatus,
} from '@league-helper/shared';

export const PARTICIPANT_RANK_PROVIDER = 'RIOT' as const;

/**
 * Durable observation statuses that may be reused as a fresh cache hit.
 * FAILED_RETRYABLE is never a long-lived negative cache hit.
 *
 * FAILED_PERMANENT is reusable only for documented deterministic reasons
 * (see {@link isReusablePermanentUnavailableCode}).
 */
const REUSABLE_SUCCESS_STATUSES = new Set<ParticipantRankResolutionStatus>([
  'RESOLVED_RANKED',
  'RESOLVED_UNRANKED',
]);

/**
 * Deterministic permanent-unavailable providerResultCode values that may be
 * reused within the freshness window without re-calling Riot.
 *
 * MISSING_PUUID: cannot League-v4 lookup — outcome cannot change until PUUID appears.
 * Other FAILED_PERMANENT codes are not treated as durable cache hits.
 */
export const REUSABLE_PERMANENT_UNAVAILABLE_CODES = new Set(['MISSING_PUUID']);

export function isReusablePermanentUnavailableCode(code: string | null | undefined): boolean {
  if (typeof code !== 'string' || code.trim() === '') {
    return false;
  }
  return REUSABLE_PERMANENT_UNAVAILABLE_CODES.has(code.trim().toUpperCase());
}

export type LatestObservationLookup = {
  provider?: string;
  platformRoute: string;
  externalAccountId: string;
  queueType: string;
  /** Defaults to PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS. */
  freshnessMs?: number;
  now?: Date;
};

export type AppendObservationInput = {
  provider?: string;
  platformRoute: string;
  externalAccountId: string;
  queueType: string;
  observedTier?: string | null;
  observedDivision?: string | null;
  resolutionStatus: ParticipantRankResolutionStatus;
  observedAt?: Date;
  providerResultCode?: string | null;
};

export type FreshObservationHit = {
  observation: ParticipantRankObservation;
  reusable: true;
  reason: 'RESOLVED_RANKED' | 'RESOLVED_UNRANKED' | 'FAILED_PERMANENT_DETERMINISTIC';
};

export type FreshObservationMiss = {
  observation: ParticipantRankObservation | null;
  reusable: false;
  reason:
    | 'NONE'
    | 'STALE'
    | 'FAILED_RETRYABLE'
    | 'PENDING'
    | 'FAILED_PERMANENT_NON_DETERMINISTIC'
    | 'NOT_APPLICABLE';
};

export type FreshObservationResult = FreshObservationHit | FreshObservationMiss;

export type ParticipantRankObservationRepository = {
  findLatestObservation(input: LatestObservationLookup): Promise<ParticipantRankObservation | null>;
  findFreshReusableObservation(input: LatestObservationLookup): Promise<FreshObservationResult>;
  appendObservation(input: AppendObservationInput): Promise<ParticipantRankObservation>;
};

function isFresh(observedAt: Date, now: Date, freshnessMs: number): boolean {
  return now.getTime() - observedAt.getTime() <= freshnessMs;
}

export function classifyFreshObservationReuse(input: {
  observation: ParticipantRankObservation | null;
  now: Date;
  freshnessMs: number;
}): FreshObservationResult {
  const observation = input.observation;
  if (!observation) {
    return { observation: null, reusable: false, reason: 'NONE' };
  }
  if (!isFresh(observation.observedAt, input.now, input.freshnessMs)) {
    return { observation, reusable: false, reason: 'STALE' };
  }

  const status = observation.resolutionStatus as ParticipantRankResolutionStatus;
  if (REUSABLE_SUCCESS_STATUSES.has(status)) {
    return {
      observation,
      reusable: true,
      reason: status === 'RESOLVED_RANKED' ? 'RESOLVED_RANKED' : 'RESOLVED_UNRANKED',
    };
  }
  if (status === 'FAILED_RETRYABLE') {
    return { observation, reusable: false, reason: 'FAILED_RETRYABLE' };
  }
  if (status === 'PENDING') {
    return { observation, reusable: false, reason: 'PENDING' };
  }
  if (status === 'FAILED_PERMANENT') {
    if (isReusablePermanentUnavailableCode(observation.providerResultCode)) {
      return {
        observation,
        reusable: true,
        reason: 'FAILED_PERMANENT_DETERMINISTIC',
      };
    }
    return {
      observation,
      reusable: false,
      reason: 'FAILED_PERMANENT_NON_DETERMINISTIC',
    };
  }
  return { observation, reusable: false, reason: 'NOT_APPLICABLE' };
}

export function createParticipantRankObservationRepository(
  prisma: PrismaClient,
): ParticipantRankObservationRepository {
  return {
    async findLatestObservation(input) {
      const provider = input.provider?.trim() || PARTICIPANT_RANK_PROVIDER;
      return prisma.participantRankObservation.findFirst({
        where: {
          provider,
          platformRoute: input.platformRoute,
          externalAccountId: input.externalAccountId,
          queueType: input.queueType,
        },
        orderBy: { observedAt: 'desc' },
      });
    },

    async findFreshReusableObservation(input) {
      const now = input.now ?? new Date();
      const freshnessMs = input.freshnessMs ?? PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS;
      const observation = await this.findLatestObservation(input);
      return classifyFreshObservationReuse({ observation, now, freshnessMs });
    },

    async appendObservation(input) {
      const provider = input.provider?.trim() || PARTICIPANT_RANK_PROVIDER;
      return prisma.participantRankObservation.create({
        data: {
          provider,
          platformRoute: input.platformRoute,
          externalAccountId: input.externalAccountId,
          queueType: input.queueType,
          observedTier: input.observedTier ?? null,
          observedDivision: input.observedDivision ?? null,
          resolutionStatus: input.resolutionStatus,
          observedAt: input.observedAt ?? new Date(),
          providerResultCode: input.providerResultCode ?? null,
        },
      });
    },
  };
}
