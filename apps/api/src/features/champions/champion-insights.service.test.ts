import { describe, expect, it, vi } from 'vitest';
import {
  ChampionNotFoundError,
  type ChampionAiStoredInsight,
  type ChampionBuildsResponse,
  type ChampionDetailResponse,
  type ChampionMatchupsResponse,
  type ChampionStatsResponse,
} from '@league-helper/shared';
import type { ChampionAiConfig } from '../../config/champion-ai.config';
import type { ChampionStatsConfig } from '../../config/champion-stats.config';
import { ChampionInsightsService } from './champion-insights.service';

const INSIGHT_ID = '11111111-1111-1111-1111-111111111111';
const SUMMARY_TEXT = 'x'.repeat(80);
const CLAIM_TEXT = 'y'.repeat(40);
const MATCHUP_TEXT = 'z'.repeat(40);
const GENERATED_AT = '2026-08-13T08:00:00.000Z';

const ahri = {
  championId: 103,
  championKey: 'Ahri',
  name: 'Ahri',
  title: 'the Nine-Tailed Fox',
  tags: ['Mage'],
  patchVersion: '16.15.1',
  dataDragonVersion: '16.15.1',
};

const statsConfig: ChampionStatsConfig = {
  defaultPlatform: 'na1',
  defaultQueueId: 420,
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
  minimumSample: 30,
  confidenceLevel: 0.95,
  cacheTtlSeconds: 60,
  buildAggregationVersion: '1',
  matchupAggregationVersion: '1',
  matchupDisplayFloor: 10,
};

function aiConfig(overrides: Partial<ChampionAiConfig> = {}): ChampionAiConfig {
  return {
    enabled: true,
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: 'secret-should-not-appear',
    timeoutMs: 60_000,
    temperature: 0.2,
    maxOutputTokens: 1200,
    maxRepairAttempts: 1,
    queueName: 'champion-ai-insight',
    jobAttempts: 3,
    stalePendingMs: 120_000,
    failedRetryMs: 60_000,
    ...overrides,
  };
}

const sampleScope = {
  kind: 'COLLECTED_SAMPLE' as const,
  platform: 'na1' as const,
  patch: '16.15',
  queueId: 420,
};

const resolvedFilters = {
  platform: 'na1' as const,
  patch: '16.15',
  queueId: 420,
  tier: 'ALL' as const,
  position: 'MIDDLE' as const,
};

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function emptyBuilds(): ChampionBuildsResponse {
  return {
    disclaimer:
      'Statistics are based on matches collected by League Helper. They do not represent all League matches.',
    rankTierSemantics:
      'Known rank tier at ingestion; may not match rank when the match was played.',
    sampleScope,
    resolvedFilters,
    emptyReason: 'CHAMPION_HAS_NO_BUILDS',
    eligibility: {
      startingItemsEligibleGames: 0,
      coreBuildsEligibleGames: 0,
      bootsEligibleGames: 0,
      runesEligibleGames: 0,
      summonerSpellsEligibleGames: 0,
      skillOrderEligibleGames: 0,
    },
    startingItems: [],
    coreBuilds: [],
    boots: [],
    runes: [],
    summonerSpells: [],
    skillOrder: [],
  };
}

function eligibleBuilds(): ChampionBuildsResponse {
  return {
    ...emptyBuilds(),
    emptyReason: null,
    coreBuilds: [
      {
        items: [item(3001, 'Luden'), item(3002, 'Shadowflame'), item(3003, 'Zhonya')],
        sampleSize: 40,
        pickRate: 0.22,
        wins: 20,
        winRate: 0.5,
        lowSample: false,
        sampleBand: 'CREDIBLE',
      },
    ],
  };
}

function emptyStats(): Pick<ChampionStatsResponse, 'stats'> {
  return { stats: null };
}

function emptyMatchups(): Pick<ChampionMatchupsResponse, 'strongAgainst' | 'weakAgainst'> {
  return { strongAgainst: [], weakAgainst: [] };
}

function ahriDetail(): ChampionDetailResponse {
  return {
    champion: {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage'],
      iconUrl: 'https://example.com/ahri.png',
      abilities: [
        {
          slot: 'Q',
          name: 'Orb of Deception',
          description: 'Ahri sends out and pulls back her orb.',
          iconUrl: 'https://example.com/q.png',
        },
      ],
    },
  };
}

function storedInsight(): ChampionAiStoredInsight {
  return {
    summary: { text: SUMMARY_TEXT, evidence: ['BUILD_CORE_PRIMARY'] },
    strengths: [{ text: CLAIM_TEXT, evidence: ['BUILD_CORE_PRIMARY'] }],
    weaknesses: [{ text: CLAIM_TEXT, evidence: ['CONFIDENCE_WARNING'] }],
    buildInsight: { text: CLAIM_TEXT, evidence: ['BUILD_CORE_PRIMARY'] },
    matchupInsights: [
      {
        opponentChampionKey: 'Syndra',
        side: 'STRONG',
        text: MATCHUP_TEXT,
        evidence: ['MATCHUP_STRONG_Syndra'],
      },
    ],
  };
}

function createService(
  overrides: {
    ai?: Partial<ChampionAiConfig>;
    requireByKey?: () => Promise<typeof ahri>;
    getByKey?: (key: string) => Promise<ChampionDetailResponse>;
    stats?: Pick<ChampionStatsResponse, 'stats'>;
    builds?: ChampionBuildsResponse;
    matchups?: Pick<ChampionMatchupsResponse, 'strongAgainst' | 'weakAgainst'>;
    existing?: Record<string, unknown> | null;
    enqueue?: { published: boolean; alreadyExists: boolean; jobId: string };
  } = {},
) {
  const staticService = {
    requireByKey: vi.fn(
      overrides.requireByKey ??
        (async (key: string) => {
          if (/^\d+$/.test(key.trim()) || key === 'NotAChamp') {
            throw new ChampionNotFoundError();
          }
          return ahri;
        }),
    ),
    getByKey: vi.fn(overrides.getByKey ?? (async () => ahriDetail())),
  };
  const statsService = {
    getChampionStats: vi.fn(async () => overrides.stats ?? emptyStats()),
  };
  const buildsService = {
    getBuilds: vi.fn(async () => overrides.builds ?? emptyBuilds()),
  };
  const matchupsService = {
    getMatchups: vi.fn(async () => overrides.matchups ?? emptyMatchups()),
  };
  const repo = {
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
        overrides.enqueue ?? { published: true, alreadyExists: false, jobId: 'ai_champ_test' },
    ),
  };

  const service = new ChampionInsightsService(
    aiConfig(overrides.ai),
    statsConfig,
    staticService as never,
    statsService as never,
    buildsService as never,
    matchupsService as never,
    repo as never,
    producer as never,
  );

  return { service, staticService, statsService, buildsService, matchupsService, repo, producer };
}

const query = { position: 'MIDDLE' as const, patch: '16.15' };

describe('ChampionInsightsService.getInsights', () => {
  it('returns DISABLED without looking up the champion when AI is off', async () => {
    const { service, staticService, producer } = createService({ ai: { enabled: false } });
    const result = await service.getInsights('NotAChamp', query);

    expect(result.status).toBe('DISABLED');
    expect(result.emptyReason).toBe('AI_DISABLED');
    expect(result.insight).toBeNull();
    expect(result.aiDisclaimer.length).toBeGreaterThan(0);
    expect(staticService.requireByKey).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret-should-not-appear');
  });

  it('throws ChampionNotFoundError when enabled and the champion is unknown', async () => {
    const { service } = createService();
    await expect(service.getInsights('NotAChamp', query)).rejects.toBeInstanceOf(
      ChampionNotFoundError,
    );
  });

  it('returns UNAVAILABLE UNKNOWN_RANK_HIDDEN without building context', async () => {
    const { service, statsService, buildsService, matchupsService, producer } = createService();
    const result = await service.getInsights('Ahri', { ...query, tier: 'UNKNOWN' });

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.emptyReason).toBe('UNKNOWN_RANK_HIDDEN');
    expect(result.insight).toBeNull();
    expect(statsService.getChampionStats).not.toHaveBeenCalled();
    expect(buildsService.getBuilds).not.toHaveBeenCalled();
    expect(matchupsService.getMatchups).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('returns LOW_CONFIDENCE without enqueueing when generation is ineligible', async () => {
    const { service, repo, producer } = createService({
      stats: emptyStats(),
      builds: emptyBuilds(),
      matchups: emptyMatchups(),
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('LOW_CONFIDENCE');
    expect(result.emptyReason).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.insight).toBeNull();
    expect(repo.findByScopeFingerprint).not.toHaveBeenCalled();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('returns AVAILABLE and strips evidence when a READY row exists', async () => {
    const { service, producer } = createService({
      builds: eligibleBuilds(),
      existing: {
        id: INSIGHT_ID,
        status: 'READY',
        structuredResult: storedInsight(),
        generatedAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
      },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('AVAILABLE');
    expect(result.insight?.summary).toBe(SUMMARY_TEXT);
    expect(result.insight?.strengths).toEqual([CLAIM_TEXT]);
    expect(result.insight?.generatedAt).toBe(GENERATED_AT);
    expect(JSON.stringify(result.insight)).not.toContain('evidence');
    expect(result.insight).not.toHaveProperty('evidence');
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('returns PENDING when a fresh PENDING row exists', async () => {
    const { service, producer } = createService({
      builds: eligibleBuilds(),
      existing: {
        id: INSIGHT_ID,
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('PENDING');
    expect(result.insight).toBeNull();
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('returns UNAVAILABLE GENERATION_FAILED while FAILED is within cooldown', async () => {
    const { service, producer } = createService({
      builds: eligibleBuilds(),
      existing: {
        id: INSIGHT_ID,
        status: 'FAILED',
        failureReason: 'VALIDATION',
        updatedAt: new Date(),
      },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.emptyReason).toBe('GENERATION_FAILED');
    expect(producer.enqueueInsight).not.toHaveBeenCalled();
  });

  it('enqueues on miss and returns PENDING with insightId and fingerprint', async () => {
    const { service, repo, producer } = createService({
      builds: eligibleBuilds(),
      existing: null,
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('PENDING');
    expect(repo.upsertPending).toHaveBeenCalledOnce();
    expect(producer.enqueueInsight).toHaveBeenCalledOnce();
    const payload = producer.enqueueInsight.mock.calls[0]?.[0];
    expect(payload?.insightId).toBe(INSIGHT_ID);
    expect(payload?.contextFingerprint).toEqual(expect.any(String));
    expect(payload?.contextFingerprint.length).toBeGreaterThanOrEqual(16);
  });

  it('returns UNAVAILABLE QUEUE_UNAVAILABLE and markFailed when enqueue is not published', async () => {
    const { service, repo } = createService({
      builds: eligibleBuilds(),
      existing: null,
      enqueue: { published: false, alreadyExists: false, jobId: 'ai_champ_test' },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.emptyReason).toBe('QUEUE_UNAVAILABLE');
    expect(repo.markFailed).toHaveBeenCalledWith(INSIGHT_ID, 'QUEUE_UNAVAILABLE');
  });

  it('re-enqueues when READY structuredResult is invalid', async () => {
    const { service, repo, producer } = createService({
      builds: eligibleBuilds(),
      existing: {
        id: INSIGHT_ID,
        status: 'READY',
        structuredResult: { not: 'valid' },
        generatedAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
      },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('PENDING');
    expect(repo.upsertPending).toHaveBeenCalledOnce();
    expect(producer.enqueueInsight).toHaveBeenCalledOnce();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('re-enqueues stale PENDING rows', async () => {
    const { service, repo, producer } = createService({
      builds: eligibleBuilds(),
      existing: {
        id: INSIGHT_ID,
        status: 'PENDING',
        updatedAt: new Date(Date.now() - 121_000),
      },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('PENDING');
    expect(repo.upsertPending).toHaveBeenCalledOnce();
    expect(producer.enqueueInsight).toHaveBeenCalledOnce();
  });

  it('re-enqueues FAILED rows after cooldown', async () => {
    const { service, repo, producer } = createService({
      builds: eligibleBuilds(),
      existing: {
        id: INSIGHT_ID,
        status: 'FAILED',
        failureReason: 'VALIDATION',
        updatedAt: new Date(Date.now() - 61_000),
      },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('PENDING');
    expect(repo.upsertPending).toHaveBeenCalledOnce();
    expect(producer.enqueueInsight).toHaveBeenCalledOnce();
  });

  it('does not markFailed when enqueue reports alreadyExists', async () => {
    const { service, repo } = createService({
      builds: eligibleBuilds(),
      existing: null,
      enqueue: { published: true, alreadyExists: true, jobId: 'ai_champ_test' },
    });
    const result = await service.getInsights('Ahri', query);

    expect(result.status).toBe('PENDING');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('does not pass rankScope to matchups', async () => {
    const { service, matchupsService } = createService({ builds: eligibleBuilds() });
    await service.getInsights('Ahri', query);
    expect(matchupsService.getMatchups).toHaveBeenCalledWith(
      'Ahri',
      expect.not.objectContaining({ rankScope: expect.anything() }),
    );
  });
});
