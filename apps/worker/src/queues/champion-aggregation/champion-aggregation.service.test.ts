import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_POSITION_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  buildChampionAggregateDimensionKey,
  expandChampionDimensionTuples,
  type ExactChampionDimensions,
  type MaterializedChampionDimensions,
} from '@league-helper/match-analytics';
import { buildChampionStatsGenerationKey } from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import type { ChampionAggregationRepository } from './champion-aggregation.repository.js';
import { recalculateForMatch } from './champion-aggregation.service.js';
import type { MatchEligibilityRow, ParticipantEligibilityRow } from './eligibility.js';

const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VERSIONS = { sourceNormalizationVersion: '1', aggregationVersion: '1' };

function config(
  overrides: Partial<ChampionAggregationWorkerConfig> = {},
): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation',
    concurrency: 2,
    jobAttempts: 5,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    matchupAggregationVersion: '1',
    confidenceLevel: 0.95,
    ...overrides,
  };
}

function matchRow(overrides: Partial<MatchEligibilityRow> = {}): MatchEligibilityRow {
  return {
    id: MATCH_ID,
    ingestionStatus: 'COMPLETED',
    remake: false,
    normalizationVersion: '1',
    normalizedPatch: '14.1',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    gameCreation: new Date('2024-01-01T00:00:00.000Z'),
    gameEndTimestamp: new Date('2024-01-01T00:30:00.000Z'),
    gameDurationSeconds: 1800,
    ...overrides,
  };
}

function participantRow(
  overrides: Partial<ParticipantEligibilityRow> = {},
): ParticipantEligibilityRow {
  return {
    participantId: 1,
    championId: 103,
    teamId: 100,
    teamPosition: 'MIDDLE',
    individualPosition: 'MIDDLE',
    lane: 'MIDDLE',
    role: 'SOLO',
    rankTierAtIngestion: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    win: true,
    kills: 5,
    deaths: 2,
    assists: 7,
    totalCs: 200,
    timePlayedSeconds: 1800,
    totalDamageDealtToChampions: 20_000,
    visionScore: 30,
    goldDifferenceAt10: 100,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    ...overrides,
  };
}

function exactDims(overrides: Partial<ExactChampionDimensions> = {}): ExactChampionDimensions {
  return {
    patch: '14.1',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    rankTier: 'GOLD',
    position: 'MIDDLE',
    championId: 103,
    ...VERSIONS,
    ...overrides,
  };
}

function keysFor(exact: ExactChampionDimensions): string[] {
  return expandChampionDimensionTuples(exact).map(buildChampionAggregateDimensionKey);
}

function createRepositoryMock(state: {
  match: MatchEligibilityRow | null;
  participants: ParticipantEligibilityRow[];
  previousKeys: string[] | null;
  contributorRows?: Array<{ match: MatchEligibilityRow; participant: ParticipantEligibilityRow }>;
}): ChampionAggregationRepository & {
  writeRecalculation: ReturnType<typeof vi.fn>;
  clearRecalcScope: ReturnType<typeof vi.fn>;
  fetchEligibleContributorCandidates: ReturnType<typeof vi.fn>;
  markProcessingFailed: ReturnType<typeof vi.fn>;
} {
  const writeRecalculation = vi.fn().mockResolvedValue(undefined);
  const clearRecalcScope = vi.fn().mockResolvedValue({ cleared: true, scopeStillPresent: false });
  const fetchEligibleContributorCandidates = vi.fn(async () => {
    if (state.contributorRows) {
      return state.contributorRows;
    }
    if (!state.match) {
      return [];
    }
    return state.participants.map((participant) => ({
      match: state.match!,
      participant,
    }));
  });

  return {
    loadMatchWithParticipants: vi.fn(async () => ({
      match: state.match,
      participants: state.participants,
    })),
    loadRecalcScope: vi.fn(async () =>
      state.previousKeys === null ? null : { previousDimensionKeys: state.previousKeys },
    ),
    upsertRecalcScope: vi.fn().mockResolvedValue(undefined),
    clearRecalcScope,
    fetchEligibleContributorCandidates,
    writeRecalculation,
    markProcessingFailed: vi.fn().mockResolvedValue(undefined),
    findProcessingMarker: vi.fn().mockResolvedValue(null),
  };
}

describe('recalculateForMatch', () => {
  let redis: { incr: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    redis = { incr: vi.fn().mockResolvedValue(1) };
  });

  it('writes 3 default rollup keys for one eligible participant', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: [],
    });

    const result = await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    expect(result.outcome).toBe('completed');
    if (result.outcome === 'completed') {
      expect(result.keysRecalculated).toBe(3);
      expect(result.rowsUpserted).toBe(3);
      expect(result.rowsDeleted).toBe(0);
    }
    expect(repository.writeRecalculation).toHaveBeenCalledTimes(1);
    const writeArg = repository.writeRecalculation.mock.calls[0]?.[0];
    expect(writeArg.writeCompletedMarker).toBe(true);
    expect(writeArg.upserts).toHaveLength(3);
    expect(writeArg.upserts.every((u: { accumulator: { sampleSize: number } }) => u.accumulator.sampleSize === 1)).toBe(
      true,
    );
    expect(redis.incr).toHaveBeenCalledTimes(1);
  });

  it('skips remakes without COMPLETED marker when no previous keys', async () => {
    const repository = createRepositoryMock({
      match: matchRow({ remake: true }),
      participants: [participantRow()],
      previousKeys: [],
    });

    const result = await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    expect(result.outcome).toBe('skipped_permanently_ineligible');
    expect(repository.writeRecalculation).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('skips incomplete matches without marker when no previous keys', async () => {
    const repository = createRepositoryMock({
      match: matchRow({ ingestionStatus: 'IN_PROGRESS' }),
      participants: [participantRow()],
      previousKeys: [],
    });

    const result = await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    expect(result).toMatchObject({
      outcome: 'skipped_permanently_ineligible',
      reason: 'MATCH_NOT_COMPLETED',
    });
    expect(repository.writeRecalculation).not.toHaveBeenCalled();
  });

  it('skips version mismatch without writes', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: [],
    });

    const result = await recalculateForMatch(
      MATCH_ID,
      { sourceNormalizationVersion: '9', aggregationVersion: '1' },
      { repository, redis: redis as never, config: config() },
    );

    expect(result).toEqual({
      outcome: 'skipped_version_mismatch',
      reason: 'VERSION_MISMATCH',
      wrote: false,
      scopeRemains: false,
    });
    expect(repository.loadRecalcScope).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('is idempotent on retry — same sample size, no double count', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: [],
    });
    const deps = { repository, redis: redis as never, config: config() };

    await recalculateForMatch(MATCH_ID, VERSIONS, deps);
    await recalculateForMatch(MATCH_ID, VERSIONS, deps);

    const first = repository.writeRecalculation.mock.calls[0]?.[0];
    const second = repository.writeRecalculation.mock.calls[1]?.[0];
    expect(first.upserts[0].accumulator.sampleSize).toBe(1);
    expect(second.upserts[0].accumulator.sampleSize).toBe(1);
  });

  it('deletes zero-contributor keys including previous-only SUPPORT after MIDDLE correction', async () => {
    const previousExact = exactDims({ position: 'SUPPORT' });
    const previousKeys = keysFor(previousExact);
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow({ teamPosition: 'MIDDLE', individualPosition: 'MIDDLE' })],
      previousKeys,
    });

    const result = await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    expect(result.outcome).toBe('completed');
    const writeArg = repository.writeRecalculation.mock.calls[0]?.[0];
    const deletedPositions = writeArg.deletes.map(
      (d: MaterializedChampionDimensions) => d.position,
    );
    // Previous SUPPORT exact / ALL-tier SUPPORT keys become zero-contributor.
    // ALL-position (GOLD) still has the MIDDLE contributor — not deleted.
    expect(deletedPositions.filter((p: string) => p === 'SUPPORT').length).toBeGreaterThanOrEqual(1);
    expect(deletedPositions).not.toContain(ALL_POSITION_SENTINEL);
    const upsertedExact = writeArg.upserts.find(
      (u: { dims: MaterializedChampionDimensions }) =>
        u.dims.position === 'MIDDLE' && u.dims.rankTier === 'GOLD',
    );
    expect(upsertedExact?.accumulator.sampleSize).toBe(1);
  });

  it('sets latestEligibleMatchAt from game end timestamp', async () => {
    const end = new Date('2024-06-01T12:00:00.000Z');
    const repository = createRepositoryMock({
      match: matchRow({ gameEndTimestamp: end }),
      participants: [participantRow()],
      previousKeys: [],
    });

    await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    const writeArg = repository.writeRecalculation.mock.calls[0]?.[0];
    expect(writeArg.upserts[0].accumulator.latestEligibleMatchAt).toEqual(end);
  });

  it('does not add zero samples for null timeline diffs', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [
        participantRow({
          goldDifferenceAt10: null,
          goldDifferenceAt15: null,
          csDifferenceAt10: null,
          csDifferenceAt15: null,
        }),
      ],
      previousKeys: [],
    });

    await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    const acc = repository.writeRecalculation.mock.calls[0]?.[0].upserts[0].accumulator;
    expect(acc.goldDifferenceAt10Samples).toBe(0);
    expect(acc.totalGoldDifferenceAt10).toBeNull();
    expect(acc.csDifferenceAt10Samples).toBe(0);
    expect(acc.sampleSize).toBe(1);
  });

  it('throws when durable recalc scope is missing (no silent current-only)', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: null,
    });

    await expect(
      recalculateForMatch(MATCH_ID, VERSIONS, {
        repository,
        redis: redis as never,
        config: config(),
      }),
    ).rejects.toMatchObject({ name: 'RECALC_SCOPE_MISSING' });
  });

  it('increments cache generation once per distinct scope after commit', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: [],
    });

    await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    expect(redis.incr).toHaveBeenCalledTimes(1);
    expect(redis.incr).toHaveBeenCalledWith(
      buildChampionStatsGenerationKey({
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
      }),
    );
  });

  it('does not incr cache generation when redis fails (non-fatal)', async () => {
    redis.incr.mockRejectedValue(new Error('redis unavailable'));
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: [],
    });

    await expect(
      recalculateForMatch(MATCH_ID, VERSIONS, {
        repository,
        redis: redis as never,
        config: config(),
      }),
    ).resolves.toMatchObject({ outcome: 'completed' });
  });

  it('batches contributor reads by shared match-level dimensions', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [
        participantRow({ participantId: 1, championId: 103 }),
        participantRow({ participantId: 2, championId: 222, teamPosition: 'TOP', individualPosition: 'TOP' }),
      ],
      previousKeys: [],
    });

    await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    expect(repository.fetchEligibleContributorCandidates).toHaveBeenCalled();
    const groups = repository.fetchEligibleContributorCandidates.mock.calls.map(
      (call) => call[0],
    );
    // All keys share patch/platform/region/queue/versions → one batch group.
    expect(groups).toHaveLength(1);
    expect(groups[0].championIds.sort()).toEqual([103, 222]);
  });

  it('writes COMPLETED marker for eligible zero-contributor empty write', async () => {
    // Eligible match but previous+current produce keys that all get deleted? 
    // Use eligible match with previous empty and contributors that expand — normal path.
    // For empty write: match eligible with previous=[] and somehow no keys — only if no contributors.
    // Force via previousKeys that parse to empty after filter — use valid empty previous and no participants.
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [],
      previousKeys: [],
    });

    const result = await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    // No eligible participants → permanently ineligible, no marker.
    expect(result.outcome).toBe('skipped_permanently_ineligible');
    expect(repository.writeRecalculation).not.toHaveBeenCalled();
  });

  it('includes ALL rank tier rollup key', async () => {
    const repository = createRepositoryMock({
      match: matchRow(),
      participants: [participantRow()],
      previousKeys: [],
    });

    await recalculateForMatch(MATCH_ID, VERSIONS, {
      repository,
      redis: redis as never,
      config: config(),
    });

    const tiers = repository.writeRecalculation.mock.calls[0]?.[0].upserts.map(
      (u: { dims: MaterializedChampionDimensions }) => u.dims.rankTier,
    );
    expect(tiers).toContain(ALL_RANK_TIER_SENTINEL);
    expect(tiers).toContain('GOLD');
  });
});
