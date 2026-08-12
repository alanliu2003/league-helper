import { describe, expect, it } from 'vitest';
import {
  classifyParticipantRankForAggregates,
  initialParticipantRankResolutionStatus,
} from './participant-rank-resolution';

describe('classifyParticipantRankForAggregates', () => {
  it('PENDING: ALL yes, exact no, UNKNOWN no', () => {
    expect(classifyParticipantRankForAggregates({ status: 'PENDING' })).toEqual({
      contributesToAll: true,
      contributesToUnknown: false,
      isPermanentUnavailable: false,
      isRankResolved: false,
    });
  });

  it('FAILED_RETRYABLE: ALL yes, exact no, UNKNOWN no', () => {
    expect(classifyParticipantRankForAggregates({ status: 'FAILED_RETRYABLE' })).toEqual({
      contributesToAll: true,
      contributesToUnknown: false,
      isPermanentUnavailable: false,
      isRankResolved: false,
    });
  });

  it('RESOLVED_RANKED(DIAMOND): ALL yes, DIAMOND yes, UNKNOWN no', () => {
    expect(
      classifyParticipantRankForAggregates({
        status: 'RESOLVED_RANKED',
        resolvedTier: 'DIAMOND',
      }),
    ).toEqual({
      contributesToAll: true,
      exactRankTier: 'DIAMOND',
      contributesToUnknown: false,
      isPermanentUnavailable: false,
      isRankResolved: true,
    });
  });

  it('RESOLVED_UNRANKED: ALL yes, exact no, UNKNOWN yes', () => {
    expect(classifyParticipantRankForAggregates({ status: 'RESOLVED_UNRANKED' })).toEqual({
      contributesToAll: true,
      contributesToUnknown: true,
      isPermanentUnavailable: false,
      isRankResolved: true,
    });
  });

  it('FAILED_PERMANENT: ALL yes, exact no, UNKNOWN no, permanentUnavailable yes', () => {
    expect(classifyParticipantRankForAggregates({ status: 'FAILED_PERMANENT' })).toEqual({
      contributesToAll: true,
      contributesToUnknown: false,
      isPermanentUnavailable: true,
      isRankResolved: true,
    });
  });

  it('NOT_APPLICABLE: ALL yes, exact no, UNKNOWN no', () => {
    expect(classifyParticipantRankForAggregates({ status: 'NOT_APPLICABLE' })).toEqual({
      contributesToAll: true,
      contributesToUnknown: false,
      isPermanentUnavailable: false,
      isRankResolved: true,
    });
  });

  it('RESOLVED_RANKED with invalid tier does not silently become UNKNOWN', () => {
    expect(
      classifyParticipantRankForAggregates({
        status: 'RESOLVED_RANKED',
        resolvedTier: 'NOT_A_TIER',
      }),
    ).toEqual({
      contributesToAll: true,
      contributesToUnknown: false,
      isPermanentUnavailable: false,
      isRankResolved: false,
    });
  });

  it('Camille SUPPORT canonical: 1 Challenger + 1 GM + 25 PENDING', () => {
    const samples = [
      classifyParticipantRankForAggregates({
        status: 'RESOLVED_RANKED',
        resolvedTier: 'CHALLENGER',
      }),
      classifyParticipantRankForAggregates({
        status: 'RESOLVED_RANKED',
        resolvedTier: 'GRANDMASTER',
      }),
      ...Array.from({ length: 25 }, () =>
        classifyParticipantRankForAggregates({ status: 'PENDING' }),
      ),
    ];

    const all = samples.filter((s) => s.contributesToAll).length;
    const challenger = samples.filter((s) => s.exactRankTier === 'CHALLENGER').length;
    const grandmaster = samples.filter((s) => s.exactRankTier === 'GRANDMASTER').length;
    const unknown = samples.filter((s) => s.contributesToUnknown).length;
    const unresolved = samples.filter((s) => !s.isRankResolved).length;

    expect(all).toBe(27);
    expect(challenger).toBe(1);
    expect(grandmaster).toBe(1);
    expect(unknown).toBe(0);
    expect(unresolved).toBe(25);
  });

  it('keeps Challenger / Grandmaster / Master as distinct exact rank dimensions', () => {
    const samples = (['CHALLENGER', 'GRANDMASTER', 'MASTER'] as const).map((tier) =>
      classifyParticipantRankForAggregates({
        status: 'RESOLVED_RANKED',
        resolvedTier: tier,
      }),
    );

    expect(samples.map((s) => s.exactRankTier)).toEqual([
      'CHALLENGER',
      'GRANDMASTER',
      'MASTER',
    ]);
    expect(samples.every((s) => s.contributesToAll && !s.contributesToUnknown)).toBe(true);
  });
});

describe('initialParticipantRankResolutionStatus', () => {
  it('maps ranked null tier to PENDING', () => {
    expect(
      initialParticipantRankResolutionStatus({
        queueId: 420,
        rankTierAtIngestion: null,
        externalAccountId: 'puuid-1',
      }),
    ).toBe('PENDING');
  });

  it('maps ranked valid tier to RESOLVED_RANKED', () => {
    expect(
      initialParticipantRankResolutionStatus({
        queueId: 440,
        rankTierAtIngestion: 'GOLD',
        externalAccountId: 'puuid-1',
      }),
    ).toBe('RESOLVED_RANKED');
  });

  it('maps non-ranked queue to NOT_APPLICABLE', () => {
    expect(
      initialParticipantRankResolutionStatus({
        queueId: 450,
        rankTierAtIngestion: null,
        externalAccountId: 'puuid-1',
      }),
    ).toBe('NOT_APPLICABLE');
  });

  it('maps ranked missing PUUID to FAILED_PERMANENT', () => {
    expect(
      initialParticipantRankResolutionStatus({
        queueId: 420,
        rankTierAtIngestion: null,
        externalAccountId: null,
      }),
    ).toBe('FAILED_PERMANENT');
  });

  it('maps malformed ranked tier to PENDING (not UNKNOWN)', () => {
    expect(
      initialParticipantRankResolutionStatus({
        queueId: 420,
        rankTierAtIngestion: 'NOT_A_TIER',
        externalAccountId: 'puuid-1',
      }),
    ).toBe('PENDING');
  });
});
