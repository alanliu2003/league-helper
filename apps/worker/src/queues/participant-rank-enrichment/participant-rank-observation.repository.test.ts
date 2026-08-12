import { describe, expect, it } from 'vitest';
import type { ParticipantRankObservation } from '@prisma/client';
import { PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS } from '@league-helper/shared';
import {
  classifyFreshObservationReuse,
  isReusablePermanentUnavailableCode,
} from './participant-rank-observation.repository.js';

function obs(
  overrides: Partial<ParticipantRankObservation> &
    Pick<ParticipantRankObservation, 'resolutionStatus' | 'observedAt'>,
): ParticipantRankObservation {
  return {
    id: 'obs-1',
    provider: 'RIOT',
    platformRoute: 'na1',
    externalAccountId: 'puuid-1',
    queueType: 'RANKED_SOLO_5x5',
    observedTier: null,
    observedDivision: null,
    providerResultCode: null,
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('participant-rank observation reuse', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const freshnessMs = PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS;

  it('reuses fresh RESOLVED_RANKED as cache hit', () => {
    const observation = obs({
      resolutionStatus: 'RESOLVED_RANKED',
      observedTier: 'DIAMOND',
      observedAt: new Date('2026-08-10T10:00:00.000Z'),
    });
    const result = classifyFreshObservationReuse({ observation, now, freshnessMs });
    expect(result.reusable).toBe(true);
    if (result.reusable) {
      expect(result.reason).toBe('RESOLVED_RANKED');
    }
  });

  it('reuses fresh RESOLVED_UNRANKED as cache hit', () => {
    const observation = obs({
      resolutionStatus: 'RESOLVED_UNRANKED',
      observedAt: new Date('2026-08-10T11:00:00.000Z'),
    });
    const result = classifyFreshObservationReuse({ observation, now, freshnessMs });
    expect(result.reusable).toBe(true);
    if (result.reusable) {
      expect(result.reason).toBe('RESOLVED_UNRANKED');
    }
  });

  it('treats stale observation as miss (provider lookup required)', () => {
    const observation = obs({
      resolutionStatus: 'RESOLVED_RANKED',
      observedTier: 'GOLD',
      observedAt: new Date('2026-08-09T12:00:00.000Z'), // 24h old
    });
    const result = classifyFreshObservationReuse({ observation, now, freshnessMs });
    expect(result).toEqual({
      observation,
      reusable: false,
      reason: 'STALE',
    });
  });

  it('does not treat FAILED_RETRYABLE as durable success cache', () => {
    const observation = obs({
      resolutionStatus: 'FAILED_RETRYABLE',
      providerResultCode: 'HTTP_429',
      observedAt: new Date('2026-08-10T11:55:00.000Z'),
    });
    const result = classifyFreshObservationReuse({ observation, now, freshnessMs });
    expect(result).toEqual({
      observation,
      reusable: false,
      reason: 'FAILED_RETRYABLE',
    });
  });

  it('reuses FAILED_PERMANENT only for documented deterministic codes', () => {
    expect(isReusablePermanentUnavailableCode('MISSING_PUUID')).toBe(true);
    expect(isReusablePermanentUnavailableCode('HTTP_403')).toBe(false);

    const reusable = classifyFreshObservationReuse({
      observation: obs({
        resolutionStatus: 'FAILED_PERMANENT',
        providerResultCode: 'MISSING_PUUID',
        observedAt: new Date('2026-08-10T11:00:00.000Z'),
      }),
      now,
      freshnessMs,
    });
    expect(reusable.reusable).toBe(true);

    const nonDeterministic = classifyFreshObservationReuse({
      observation: obs({
        resolutionStatus: 'FAILED_PERMANENT',
        providerResultCode: 'UNKNOWN_GAP',
        observedAt: new Date('2026-08-10T11:00:00.000Z'),
      }),
      now,
      freshnessMs,
    });
    expect(nonDeterministic.reusable).toBe(false);
  });
});
