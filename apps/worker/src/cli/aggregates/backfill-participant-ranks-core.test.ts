import { describe, expect, it, vi } from 'vitest';
import {
  dbNameFromUrl,
  parseBackfillParticipantRanksArgs,
  runBackfillParticipantRanks,
  selectBackfillIdentities,
  type BackfillCandidateRow,
} from './backfill-participant-ranks-core.js';

function row(
  overrides: Partial<BackfillCandidateRow> & Pick<BackfillCandidateRow, 'id' | 'externalAccountId'>,
): BackfillCandidateRow {
  return {
    id: overrides.id,
    matchId: overrides.matchId ?? '11111111-1111-1111-1111-111111111111',
    externalAccountId: overrides.externalAccountId,
    rankResolutionStatus: overrides.rankResolutionStatus ?? 'PENDING',
    match: overrides.match ?? { platformRoute: 'na1', queueId: 420 },
  };
}

describe('parseBackfillParticipantRanksArgs', () => {
  it('applies developer-key conservative defaults', () => {
    const flags = parseBackfillParticipantRanksArgs([]);
    expect(flags.platformRoute).toBe('na1');
    expect(flags.queueId).toBe(420);
    expect(flags.maxParticipants).toBe(200);
    expect(flags.maxRiotCalls).toBe(100);
    expect(flags.dryRun).toBe(false);
    expect(flags.confirm).toBe(false);
  });

  it('rejects non-ranked queues', () => {
    expect(() => parseBackfillParticipantRanksArgs(['--queue', '400'])).toThrow(/420 or 440/);
  });

  it('caps max-participants at 500', () => {
    expect(() =>
      parseBackfillParticipantRanksArgs(['--max-participants', '501']),
    ).toThrow(/<= 500/);
  });
});

describe('selectBackfillIdentities', () => {
  it('prioritizes PENDING over FAILED_RETRYABLE', () => {
    const selection = selectBackfillIdentities({
      rows: [
        row({ id: 'b', externalAccountId: 'puuid-retry', rankResolutionStatus: 'FAILED_RETRYABLE' }),
        row({ id: 'a', externalAccountId: 'puuid-pending', rankResolutionStatus: 'PENDING' }),
      ],
      maxParticipants: 10,
      maxRiotCalls: 10,
    });
    expect(selection.identities.map((i) => i.externalAccountId)).toEqual([
      'puuid-pending',
      'puuid-retry',
    ]);
    expect(selection.pendingRowsSeen).toBe(1);
    expect(selection.failedRetryableRowsSeen).toBe(1);
  });

  it('dedupes identities while counting participants toward the bound', () => {
    const selection = selectBackfillIdentities({
      rows: [
        row({ id: '1', externalAccountId: 'same', matchId: 'm1' }),
        row({ id: '2', externalAccountId: 'same', matchId: 'm2' }),
        row({ id: '3', externalAccountId: 'other' }),
      ],
      maxParticipants: 2,
      maxRiotCalls: 10,
    });
    expect(selection.participantsSelected).toBe(2);
    expect(selection.uniquePuuids).toBe(1);
    expect(selection.identities[0]!.participantIds).toEqual(['1', '2']);
    expect(selection.truncatedByParticipants).toBe(true);
  });

  it('bounds unique PUUIDs by maxRiotCalls', () => {
    const selection = selectBackfillIdentities({
      rows: [
        row({ id: '1', externalAccountId: 'a' }),
        row({ id: '2', externalAccountId: 'b' }),
        row({ id: '3', externalAccountId: 'c' }),
      ],
      maxParticipants: 100,
      maxRiotCalls: 2,
    });
    expect(selection.uniquePuuids).toBe(2);
    expect(selection.truncatedByRiotCalls).toBe(true);
    expect(selection.nextCursor).toBe('2');
  });

  it('skips empty PUUIDs', () => {
    const selection = selectBackfillIdentities({
      rows: [row({ id: '1', externalAccountId: '   ' }), row({ id: '2', externalAccountId: 'ok' })],
      maxParticipants: 10,
      maxRiotCalls: 10,
    });
    expect(selection.uniquePuuids).toBe(1);
    expect(selection.identities[0]!.externalAccountId).toBe('ok');
  });
});

describe('dbNameFromUrl', () => {
  it('extracts database name', () => {
    expect(dbNameFromUrl('postgresql://league:x@localhost:5432/league_helper_m12v2?schema=public')).toBe(
      'league_helper_m12v2',
    );
  });
});

describe('runBackfillParticipantRanks', () => {
  it('blocks abandoned league_helper database', async () => {
    const result = await runBackfillParticipantRanks({
      prisma: {} as never,
      flags: parseBackfillParticipantRanksArgs(['--dry-run']),
      databaseUrl: 'postgresql://league:x@localhost:5432/league_helper',
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.mode).toBe('blocked');
    expect(result.report.error).toMatch(/abandoned DB league_helper/);
  });

  it('blocks unexpected database names', async () => {
    const result = await runBackfillParticipantRanks({
      prisma: {} as never,
      flags: parseBackfillParticipantRanksArgs(['--dry-run']),
      databaseUrl: 'postgresql://league:x@localhost:5432/somewhere_else',
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.error).toMatch(/league_helper_m12v2/);
  });

  it('requires --confirm for mutating mode', async () => {
    const result = await runBackfillParticipantRanks({
      prisma: {} as never,
      flags: parseBackfillParticipantRanksArgs([]),
      databaseUrl: 'postgresql://league:x@localhost:5432/league_helper_m12v2',
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.error).toMatch(/--confirm/);
  });

  it('dry-run selects candidates without enqueue', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'p1',
          matchId: 'm1',
          externalAccountId: 'puuid-1',
          rankResolutionStatus: 'PENDING',
          match: { platformRoute: 'na1', queueId: 420 },
        },
      ])
      .mockResolvedValueOnce([]); // FAILED_RETRYABLE query
    const groupBy = vi.fn().mockResolvedValue([
      { rankResolutionStatus: 'PENDING', _count: { _all: 1 } },
      { rankResolutionStatus: 'RESOLVED_RANKED', _count: { _all: 9 } },
    ]);

    const result = await runBackfillParticipantRanks({
      prisma: {
        matchParticipant: { findMany, groupBy },
      } as never,
      flags: parseBackfillParticipantRanksArgs(['--dry-run', '--max-participants', '50']),
      databaseUrl: 'postgresql://league:x@localhost:5432/league_helper_m12v2',
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.mode).toBe('dry-run');
    expect(result.report.selection.participantsSelected).toBe(1);
    expect(result.report.selection.uniquePuuids).toBe(1);
    expect(result.report.enqueue).toBeUndefined();
    expect(result.report.baselineHealth?.exactRankCoverage).toBeCloseTo(0.9);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
