import { describe, expect, it, vi } from 'vitest';
import {
  PlayerPlaystyleResponseSchema,
  RANKED_SOLO_QUEUE_ID,
  ResourceNotFoundError,
  type PlayerPlaystyleStoredInsight,
} from '@league-helper/shared';
import type { PlayerPlaystyleAiConfig } from '../../config/player-playstyle-ai.config';
import type { ChampionStatsConfig } from '../../config/champion-stats.config';
import { assertNoPuuidLeak } from './player-response.mapper';
import { PLAYSTYLE_WINDOW_LIMIT } from './player-playstyle-matches';
import { PlayerPlaystyleService } from './player-playstyle.service';
import type { PlaystyleWindowRow } from './player-playstyle-matches';

const PLAYER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const INSIGHT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SUMMARY_TEXT = 'x'.repeat(80);
const CLAIM_TEXT = 'y'.repeat(40);
const TENDENCY_TEXT = 'z'.repeat(40);
const GENERATED_AT = '2026-08-14T08:00:00.000Z';

const statsConfig: ChampionStatsConfig = {
  defaultPlatform: 'na1',
  defaultQueueId: 420,
  sourceNormalizationVersion: '1',
  aggregationVersion: '2',
  minimumSample: 30,
  confidenceLevel: 0.95,
  cacheTtlSeconds: 60,
  buildAggregationVersion: '1',
  matchupAggregationVersion: '1',
  matchupDisplayFloor: 10,
};

function aiConfig(overrides: Partial<PlayerPlaystyleAiConfig> = {}): PlayerPlaystyleAiConfig {
  return {
    enabled: true,
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    apiKey: 'secret-should-not-appear',
    timeoutMs: 60_000,
    temperature: 0.2,
    maxOutputTokens: 1200,
    maxRepairAttempts: 1,
    queueName: 'player-ai-playstyle',
    jobAttempts: 3,
    stalePendingMs: 120_000,
    failedRetryMs: 60_000,
    ...overrides,
  };
}

const account = {
  id: ACCOUNT_ID,
  playerId: PLAYER_ID,
  puuid: 'leaked-puuid-must-not-appear',
  externalAccountId: 'leaked-external-account',
};

function participant(
  overrides: Partial<PlaystyleWindowRow['participants'][number]> = {},
): PlaystyleWindowRow['participants'][number] {
  return {
    participantId: 1,
    championId: 103,
    championName: 'Ahri',
    teamPosition: 'MIDDLE',
    individualPosition: 'MIDDLE',
    lane: 'MIDDLE',
    role: 'SOLO',
    rankTierAtIngestion: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    win: true,
    kills: 8,
    deaths: 4,
    assists: 9,
    totalCs: 210,
    goldEarned: 12500,
    visionScore: 22,
    timePlayedSeconds: 1800,
    totalDamageDealtToChampions: 22000,
    goldDifferenceAt10: 200,
    goldDifferenceAt15: 400,
    csDifferenceAt10: 10,
    csDifferenceAt15: 18,
    ...overrides,
  };
}

function windowMatch(id: string, overrides: Partial<PlaystyleWindowRow> = {}): PlaystyleWindowRow {
  const { participants, ...rest } = overrides;
  return {
    id,
    queueId: RANKED_SOLO_QUEUE_ID,
    gameCreation: rest.gameCreation ?? new Date(`2026-08-0${id.slice(-1)}T00:00:00.000Z`),
    gameDurationSeconds: rest.gameDurationSeconds ?? 1800,
    remake: rest.remake ?? false,
    ingestionStatus: rest.ingestionStatus ?? 'COMPLETED',
    normalizedPatch: rest.normalizedPatch ?? '16.15',
    platformRoute: rest.platformRoute ?? 'na1',
    regionalRoute: rest.regionalRoute ?? 'americas',
    mapId: rest.mapId ?? 11,
    gameMode: rest.gameMode ?? 'CLASSIC',
    participants: participants ?? [participant()],
    ...rest,
  };
}

function eligibleWindow(count: number): PlaystyleWindowRow[] {
  return Array.from({ length: count }, (_, index) =>
    windowMatch(`ok-${index + 1}`, {
      gameCreation: new Date(Date.UTC(2026, 7, 14 - index)),
    }),
  );
}

function aggregateRow() {
  return {
    id: 'agg-1',
    patch: '16.15',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    rankTier: 'GOLD',
    teamPosition: 'MIDDLE',
    championId: 103,
    sampleSize: 80,
    wins: 42,
    totalKills: 480,
    totalDeaths: 320,
    totalAssists: 640,
    totalCs: 16_000,
    totalGameSeconds: 144_000,
    totalDamageToChampions: 1_600_000,
    totalVisionScore: 1_600,
    totalGoldEarned: 960_000,
    totalGoldDifferenceAt10: 4_000,
    goldDifferenceAt10Samples: 80,
    totalGoldDifferenceAt15: 8_000,
    goldDifferenceAt15Samples: 80,
    totalCsDifferenceAt10: 400,
    csDifferenceAt10Samples: 80,
    totalCsDifferenceAt15: 800,
    csDifferenceAt15Samples: 80,
    aggregationVersion: '2',
    latestEligibleMatchAt: new Date(GENERATED_AT),
    calculatedAt: new Date(GENERATED_AT),
    sourceNormalizationVersion: '1',
  };
}

function storedInsight(): PlayerPlaystyleStoredInsight {
  return {
    summary: { text: SUMMARY_TEXT, evidence: ['OVERALL_CS_PER_MIN'] },
    economy: { text: CLAIM_TEXT, evidence: ['OVERALL_CS_PER_MIN'] },
    combat: { text: CLAIM_TEXT, evidence: ['OVERALL_DAMAGE_PER_MIN'] },
    strengths: [{ text: CLAIM_TEXT, evidence: ['OVERALL_CS_PER_MIN'] }],
    tradeoffs: [{ text: CLAIM_TEXT, evidence: ['OVERALL_DEATHS_PER_GAME'] }],
    championTendencies: [
      {
        championKey: 'Ahri',
        position: 'MIDDLE',
        text: TENDENCY_TEXT,
        evidence: ['SLICE_Ahri_MIDDLE_CS_PER_MIN'],
      },
    ],
  };
}

function createService(
  overrides: {
    ai?: Partial<PlayerPlaystyleAiConfig>;
    account?: typeof account | null;
    window?: PlaystyleWindowRow[];
    existing?: Record<string, unknown> | null;
    enqueue?: { published: boolean; alreadyExists: boolean; jobId: string };
    aggregate?: ReturnType<typeof aggregateRow> | null;
  } = {},
) {
  const playerAccounts = {
    findAccountByPlayerId: vi.fn(async () =>
      overrides.account === undefined ? account : overrides.account,
    ),
  };
  const matches = {
    listPlaystyleWindow: vi.fn(async () => overrides.window ?? eligibleWindow(5)),
  };
  const aggregates = {
    findExactAggregate: vi.fn(async () =>
      overrides.aggregate === undefined ? aggregateRow() : overrides.aggregate,
    ),
  };
  const championStatic = {
    findByChampionIds: vi.fn(
      async () =>
        new Map([
          [
            103,
            {
              championId: 103,
              championKey: 'Ahri',
              name: 'Ahri',
              title: 'the Nine-Tailed Fox',
              tags: ['Mage'],
              patchVersion: '16.15.1',
              dataDragonVersion: '16.15.1',
            },
          ],
        ]),
    ),
  };
  const insights = {
    findByScopeFingerprint: vi.fn(async () =>
      overrides.existing === undefined ? null : overrides.existing,
    ),
    upsertPending: vi.fn(async () => ({ id: INSIGHT_ID })),
    markReady: vi.fn(),
    markFailed: vi.fn(),
  };
  const producer = {
    enqueueInsight: vi.fn(
      async () =>
        overrides.enqueue ?? {
          published: true,
          alreadyExists: false,
          jobId: 'ai_player_test',
        },
    ),
  };

  const service = new PlayerPlaystyleService(
    aiConfig(overrides.ai),
    statsConfig,
    playerAccounts as never,
    matches as never,
    aggregates as never,
    championStatic as never,
    insights as never,
    producer as never,
  );

  return { service, playerAccounts, matches, aggregates, insights, producer };
}

describe('PlayerPlaystyleService.getPlaystyle', () => {
  it('throws ResourceNotFoundError for an unknown player', async () => {
    const { service, matches, producer } = createService({ account: null });
    await expect(service.getPlaystyle(PLAYER_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(matches.listPlaystyleWindow).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('returns DISABLED with deterministic comparisons when AI is off and does not enqueue', async () => {
    const { service, matches, producer, insights } = createService({
      ai: { enabled: false },
      window: eligibleWindow(5),
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('DISABLED');
    expect(result.ai.emptyReason).toBe('AI_DISABLED');
    expect(result.ai.insight).toBeNull();
    expect(result.overall.comparisons.length).toBeGreaterThan(0);
    expect(result.sampleScope.matchesAnalyzed).toBe(5);
    expect(result.sampleScope.comparableMatchCount).toBeGreaterThanOrEqual(5);
    expect(matches.listPlaystyleWindow).toHaveBeenCalled();
    expect(insights.upsertPending).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret-should-not-appear');
    assertNoPuuidLeak(result);
    expect(PlayerPlaystyleResponseSchema.parse(result).ai.status).toBe('DISABLED');
  });

  it('returns LOW_CONFIDENCE without enqueueing when comparable matches are under 5', async () => {
    const { service, producer, insights } = createService({
      window: eligibleWindow(4),
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('LOW_CONFIDENCE');
    expect(result.ai.emptyReason).toBe('INSUFFICIENT_SAMPLE');
    expect(result.overall.comparisons.length).toBeGreaterThan(0);
    expect(result.sampleScope.comparableMatchCount).toBeLessThan(5);
    expect(insights.upsertPending).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
    assertNoPuuidLeak(result);
  });

  it('upserts PENDING and enqueues when eligible and no insight row exists', async () => {
    const { service, insights, producer, aggregates, matches } = createService({
      window: eligibleWindow(5),
      existing: null,
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('PENDING');
    expect(insights.upsertPending).toHaveBeenCalledOnce();
    expect(producer.enqueueInsight).toHaveBeenCalledOnce();
    const pendingInput = insights.upsertPending.mock.calls[0]?.[0] as {
      playerAccountId: string;
      queueId: number;
      inputContext: { subject: { label: string }; matchIdentity: unknown[] };
    };
    expect(pendingInput.playerAccountId).toBe(ACCOUNT_ID);
    expect(pendingInput.queueId).toBe(420);
    expect(pendingInput.inputContext.subject).toEqual({ label: 'player' });
    expect(pendingInput.inputContext.matchIdentity.length).toBeGreaterThan(0);
    const payload = producer.enqueueInsight.mock.calls[0]?.[0];
    expect(payload?.insightId).toBe(INSIGHT_ID);
    expect(payload?.contextFingerprint).toEqual(expect.any(String));
    expect(String(payload?.contextFingerprint).length).toBeGreaterThanOrEqual(16);
    expect(matches.listPlaystyleWindow).toHaveBeenCalledWith(
      expect.objectContaining({ playerAccountId: ACCOUNT_ID, limit: PLAYSTYLE_WINDOW_LIMIT }),
    );
    expect(matches.listPlaystyleWindow.mock.calls[0]?.[0]?.limit).toBe(20);
    expect(aggregates.findExactAggregate).not.toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ tier: 'UNKNOWN' }) }),
    );
    expect(aggregates.findExactAggregate).not.toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ position: 'ALL' }) }),
    );
    assertNoPuuidLeak(result);
  });

  it('returns AVAILABLE and strips evidence when a READY row matches the fingerprint', async () => {
    const { service, producer } = createService({
      window: eligibleWindow(5),
      existing: {
        id: INSIGHT_ID,
        status: 'READY',
        structuredResult: storedInsight(),
        generatedAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
      },
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('AVAILABLE');
    expect(result.ai.insight?.summary).toBe(SUMMARY_TEXT);
    expect(result.ai.insight?.strengths).toEqual([CLAIM_TEXT]);
    expect(result.ai.insight?.championTendencies[0]?.text).toBe(TENDENCY_TEXT);
    expect(result.ai.insight?.generatedAt).toBe(GENERATED_AT);
    expect(JSON.stringify(result.ai.insight)).not.toContain('evidence');
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
    assertNoPuuidLeak(result);
  });

  it('returns UNAVAILABLE GENERATION_FAILED while FAILED is within cooldown', async () => {
    const { service, producer } = createService({
      window: eligibleWindow(5),
      existing: {
        id: INSIGHT_ID,
        status: 'FAILED',
        failureReason: 'VALIDATION',
        updatedAt: new Date(),
      },
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('UNAVAILABLE');
    expect(result.ai.emptyReason).toBe('GENERATION_FAILED');
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
    expect(result.overall.comparisons.length).toBeGreaterThan(0);
    assertNoPuuidLeak(result);
  });

  it('returns PENDING when a fresh PENDING row exists', async () => {
    const { service, producer, insights } = createService({
      window: eligibleWindow(5),
      existing: {
        id: INSIGHT_ID,
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('PENDING');
    expect(result.ai.insight).toBeNull();
    expect(insights.upsertPending).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('honors window skip accounting identity on a mixed fixture window', async () => {
    const window: PlaystyleWindowRow[] = [
      windowMatch('remake', { remake: true }),
      windowMatch('incomplete', { ingestionStatus: 'FAILED' }),
      windowMatch('unknown', {
        participants: [
          participant({ teamPosition: 'NONE', individualPosition: 'NONE', lane: null, role: null }),
        ],
      }),
      ...eligibleWindow(5),
    ];
    const { service } = createService({ ai: { enabled: false }, window });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.sampleScope.windowSize).toBe(8);
    expect(result.skipped.remake).toBe(1);
    expect(result.skipped.incomplete).toBe(1);
    expect(result.skipped.unknownPosition).toBe(1);
    expect(result.sampleScope.matchesAnalyzed).toBe(5);
    expect(
      result.skipped.remake +
        result.skipped.incomplete +
        result.skipped.unknownPosition +
        result.sampleScope.matchesAnalyzed,
    ).toBe(result.sampleScope.windowSize);
    expect(result.skipped.noBaseline).toBeLessThanOrEqual(result.sampleScope.matchesAnalyzed);
    expect(result.sampleScope.comparableMatchCount).toBe(
      result.sampleScope.matchesAnalyzed - result.skipped.noBaseline,
    );
    expect(result.sampleScope.windowSize).toBeLessThanOrEqual(20);
    expect(result.sampleScope.matchWindow).toBe(20);
    assertNoPuuidLeak(result);
  });

  it('does not fetch limit 21', async () => {
    const { service, matches } = createService({ ai: { enabled: false }, window: [] });
    await service.getPlaystyle(PLAYER_ID);
    const limit = matches.listPlaystyleWindow.mock.calls[0]?.[0]?.limit as number;
    expect(limit).toBe(20);
    expect(limit).toBeLessThan(21);
  });

  it('returns UNAVAILABLE QUEUE_UNAVAILABLE and markFailed when enqueue is not published', async () => {
    const { service, insights } = createService({
      window: eligibleWindow(5),
      existing: null,
      enqueue: { published: false, alreadyExists: false, jobId: 'ai_player_test' },
    });
    const result = await service.getPlaystyle(PLAYER_ID);

    expect(result.ai.status).toBe('UNAVAILABLE');
    expect(result.ai.emptyReason).toBe('QUEUE_UNAVAILABLE');
    expect(insights.markFailed).toHaveBeenCalledWith(INSIGHT_ID, 'QUEUE_UNAVAILABLE');
    expect(result.overall.comparisons.length).toBeGreaterThan(0);
  });
});
