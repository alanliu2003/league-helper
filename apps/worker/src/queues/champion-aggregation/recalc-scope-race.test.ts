import { describe, expect, it, vi } from 'vitest';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import type { ChampionAggregationRepository } from './champion-aggregation.repository.js';
import { recalculateForMatch } from './champion-aggregation.service.js';
import {
  enqueueChampionAggregationFollowUp,
} from './enqueue.js';
import {
  dimensionKeysEqual,
  mergeRecalcScopeKeys,
} from './previous-keys.js';
import type { MatchEligibilityRow, ParticipantEligibilityRow } from './eligibility.js';

const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VERSIONS = { sourceNormalizationVersion: '1', aggregationVersion: '1' };

function config(): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation',
    concurrency: 2,
    jobAttempts: 5,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    matchupAggregationVersion: '1',
    confidenceLevel: 0.95,
  };
}

describe('mergeRecalcScopeKeys (upsert union)', () => {
  it('unions incoming keys with existing pending keys deterministically', () => {
    const existing = ['["14.1","na1","americas",420,"GOLD","SUPPORT",103,"1","1"]'];
    const incoming = ['["14.1","na1","americas",420,"GOLD","MIDDLE",103,"1","1"]'];
    const merged = mergeRecalcScopeKeys(existing, incoming);
    expect(merged).toEqual([...incoming, ...existing].sort());
    expect(mergeRecalcScopeKeys(incoming, existing)).toEqual(merged);
  });

  it('does not discard prior pending keys when incoming is empty create snapshot', () => {
    const existing = ['key-support', 'key-all-tier'];
    expect(mergeRecalcScopeKeys(existing, [])).toEqual(['key-all-tier', 'key-support']);
  });

  it('deduplicates identical keys', () => {
    expect(mergeRecalcScopeKeys(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('upsertRecalcScope repository merge', () => {
  it('unions with existing row instead of replacing', async () => {
    const store = {
      keys: ['existing-support'] as string[] | null,
    };

    const upsertRecalcScope: ChampionAggregationRepository['upsertRecalcScope'] = async (
      input,
    ) => {
      const existing = store.keys ?? [];
      const merged = mergeRecalcScopeKeys(existing, input.previousDimensionKeys);
      store.keys = merged;
      return { previousDimensionKeys: merged };
    };

    const first = await upsertRecalcScope({
      matchId: MATCH_ID,
      ...VERSIONS,
      previousDimensionKeys: [],
    });
    expect(first.previousDimensionKeys).toEqual(['existing-support']);

    const second = await upsertRecalcScope({
      matchId: MATCH_ID,
      ...VERSIONS,
      previousDimensionKeys: ['incoming-middle'],
    });
    expect(second.previousDimensionKeys).toEqual(['existing-support', 'incoming-middle']);
    expect(store.keys).toEqual(['existing-support', 'incoming-middle']);
  });
});

describe('clearRecalcScope conditional delete', () => {
  it('does not wipe a concurrently updated scope', async () => {
    let storedKeys = [''] as string[];
    storedKeys = [];

    const clearRecalcScope: ChampionAggregationRepository['clearRecalcScope'] = async (input) => {
      const expected = mergeRecalcScopeKeys([], input.expectedPreviousDimensionKeys);
      if (!dimensionKeysEqual(storedKeys, expected)) {
        return { cleared: false, scopeStillPresent: true };
      }
      storedKeys = [];
      return { cleared: true, scopeStillPresent: false };
    };

    // Job A loaded []
    // Concurrent re-ingest upserted SUPPORT keys
    storedKeys = ['support-key'];

    const result = await clearRecalcScope({
      matchId: MATCH_ID,
      ...VERSIONS,
      expectedPreviousDimensionKeys: [],
    });

    expect(result).toEqual({ cleared: false, scopeStillPresent: true });
    expect(storedKeys).toEqual(['support-key']);
  });

  it('clears when stored keys still match the loaded snapshot', async () => {
    let storedKeys = ['support-key'];

    const clearRecalcScope: ChampionAggregationRepository['clearRecalcScope'] = async (input) => {
      const expected = mergeRecalcScopeKeys([], input.expectedPreviousDimensionKeys);
      if (!dimensionKeysEqual(storedKeys, expected)) {
        return { cleared: false, scopeStillPresent: storedKeys.length > 0 };
      }
      storedKeys = [];
      return { cleared: true, scopeStillPresent: false };
    };

    const result = await clearRecalcScope({
      matchId: MATCH_ID,
      ...VERSIONS,
      expectedPreviousDimensionKeys: ['support-key'],
    });

    expect(result).toEqual({ cleared: true, scopeStillPresent: false });
    expect(storedKeys).toEqual([]);
  });
});

describe('recalculateForMatch scope race', () => {
  function matchRow(): MatchEligibilityRow {
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
    };
  }

  function participantRow(): ParticipantEligibilityRow {
    return {
      participantId: 1,
      championId: 103,
      teamId: 100,
      teamPosition: 'MIDDLE',
      individualPosition: 'MIDDLE',
      lane: 'MIDDLE',
      role: 'SOLO',
      rankTierAtIngestion: 'GOLD',
      rankResolutionStatus: 'RESOLVED_RANKED' as const,
      win: true,
      kills: 5,
      deaths: 2,
      assists: 7,
      totalCs: 200,
      timePlayedSeconds: 1800,
      totalDamageDealtToChampions: 20_000,
      visionScore: 30,
      goldEarned: 12_000,
      goldDifferenceAt10: null,
      goldDifferenceAt15: null,
      csDifferenceAt10: null,
      csDifferenceAt15: null,
    };
  }

  it('signals scopeRemains when clear preserves a concurrent upsert', async () => {
    const clearRecalcScope = vi.fn().mockResolvedValue({
      cleared: false,
      scopeStillPresent: true,
    });
    const repository = {
      loadMatchWithParticipants: vi.fn(async () => ({
        match: matchRow(),
        participants: [participantRow()],
      })),
      loadRecalcScope: vi.fn(async () => ({ previousDimensionKeys: [] })),
      upsertRecalcScope: vi.fn(),
      clearRecalcScope,
      fetchEligibleContributorCandidates: vi.fn(async () => [
        { match: matchRow(), participant: participantRow() },
      ]),
      writeRecalculation: vi.fn().mockResolvedValue(undefined),
      markProcessingFailed: vi.fn(),
      findProcessingMarker: vi.fn(),
    } as unknown as ChampionAggregationRepository;

    const result = await recalculateForMatch(
      MATCH_ID,
      VERSIONS,
      {
        repository,
        redis: { incr: vi.fn().mockResolvedValue(1) } as never,
        config: config(),
      },
    );

    expect(result.scopeRemains).toBe(true);
    expect(clearRecalcScope).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: MATCH_ID,
        expectedPreviousDimensionKeys: [],
      }),
    );
  });

  it('signals scopeRemains=false when clear succeeds', async () => {
    const repository = {
      loadMatchWithParticipants: vi.fn(async () => ({
        match: matchRow(),
        participants: [participantRow()],
      })),
      loadRecalcScope: vi.fn(async () => ({ previousDimensionKeys: [] })),
      upsertRecalcScope: vi.fn(),
      clearRecalcScope: vi.fn().mockResolvedValue({ cleared: true, scopeStillPresent: false }),
      fetchEligibleContributorCandidates: vi.fn(async () => [
        { match: matchRow(), participant: participantRow() },
      ]),
      writeRecalculation: vi.fn().mockResolvedValue(undefined),
      markProcessingFailed: vi.fn(),
      findProcessingMarker: vi.fn(),
    } as unknown as ChampionAggregationRepository;

    const result = await recalculateForMatch(
      MATCH_ID,
      VERSIONS,
      {
        repository,
        redis: { incr: vi.fn().mockResolvedValue(1) } as never,
        config: config(),
      },
    );

    expect(result.scopeRemains).toBe(false);
  });
});

describe('follow-up enqueue when scope remains', () => {
  it('re-enqueues after concurrent scope retention', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({ id: 'job' });
    const queue = {
      getJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        remove,
      }),
      add,
    };

    const result = await enqueueChampionAggregationFollowUp({
      queue: queue as never,
      config: config(),
      matchId: MATCH_ID,
      correlationId: 'corr-race',
    });

    expect(result?.published).toBe(true);
    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'RECALCULATE_CHAMPION_AGGREGATES',
      expect.objectContaining({
        matchId: MATCH_ID,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
      }),
      expect.objectContaining({ jobId: expect.stringContaining(MATCH_ID) }),
    );
  });

  it('does not double-add when a live follow-up job already exists', async () => {
    const add = vi.fn();
    const queue = {
      getJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn(),
      }),
      add,
    };

    const result = await enqueueChampionAggregationFollowUp({
      queue: queue as never,
      config: config(),
      matchId: MATCH_ID,
    });

    expect(result?.published).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });
});
