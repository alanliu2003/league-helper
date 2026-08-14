import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BULLMQ_DEFAULT_PREFIX,
  CHAMPION_AGGREGATION_JOB_NAME,
  CHAMPION_AGGREGATION_QUEUE_NAME,
  CHAMPION_AI_INSIGHT_JOB_NAME,
  CHAMPION_AI_INSIGHT_QUEUE_NAME,
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_QUEUE_NAME,
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME,
  resolveBullMqPrefix,
} from '@league-helper/shared';
import {
  QUEUE_NAME,
  loadChampionAggregationWorkerConfig,
  loadChampionAiInsightWorkerConfig,
  loadMatchIngestionWorkerConfig,
  loadParticipantRankEnrichmentWorkerConfig,
} from './config.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('worker bootstrap (dev:worker)', () => {
  it('registers match-ingestion as a primary queue config', () => {
    const config = loadMatchIngestionWorkerConfig({});
    expect(config.queueName).toBe(MATCH_INGESTION_QUEUE_NAME);
    expect(MATCH_INGESTION_JOB_NAME).toBe('INGEST_MATCH');
  });

  it('registers champion-aggregation as a primary queue config', () => {
    const config = loadChampionAggregationWorkerConfig({});
    expect(config.queueName).toBe(CHAMPION_AGGREGATION_QUEUE_NAME);
    expect(CHAMPION_AGGREGATION_JOB_NAME).toBe('RECALCULATE_CHAMPION_AGGREGATES');
    expect(config.sourceNormalizationVersion).toBe('1');
    expect(config.aggregationVersion).toBe('2');
  });

  it('registers participant-rank-enrichment with developer-key concurrency 1', () => {
    const config = loadParticipantRankEnrichmentWorkerConfig({});
    expect(config.queueName).toBe(PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME);
    expect(PARTICIPANT_RANK_ENRICHMENT_JOB_NAME).toBe('ENRICH_PARTICIPANT_RANK');
    expect(config.concurrency).toBe(1);
    expect(config.observationFreshnessMs).toBe(6 * 60 * 60 * 1000);
  });

  it('registers champion-ai-insight with concurrency 1 and AI disabled by default', () => {
    const config = loadChampionAiInsightWorkerConfig({});
    expect(config.queueName).toBe(CHAMPION_AI_INSIGHT_QUEUE_NAME);
    expect(CHAMPION_AI_INSIGHT_JOB_NAME).toBe('GENERATE_CHAMPION_AI_INSIGHT');
    expect(config.enabled).toBe(false);
    expect(config.concurrency).toBe(1);
    expect(config.jobAttempts).toBe(3);
    expect(config.provider).toBe('openai_compatible');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
    expect(config.model).toBe('qwen2.5:7b');
    expect(config.apiKey).toBe('');
    expect(config.timeoutMs).toBe(60_000);
    expect(config.temperature).toBe(0.2);
    expect(config.maxOutputTokens).toBe(1200);
    expect(config.maxRepairAttempts).toBe(1);
  });

  it('does not treat league-helper-default as a production queue', () => {
    expect(QUEUE_NAME).toBe('league-helper-default');
    expect(QUEUE_NAME).not.toBe(MATCH_INGESTION_QUEUE_NAME);
    expect(QUEUE_NAME).not.toBe(CHAMPION_AGGREGATION_QUEUE_NAME);
    expect(QUEUE_NAME).not.toBe(PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME);
    expect(QUEUE_NAME).not.toBe(CHAMPION_AI_INSIGHT_QUEUE_NAME);
  });

  it('shares the default BullMQ prefix with the API', () => {
    expect(resolveBullMqPrefix({})).toBe(BULLMQ_DEFAULT_PREFIX);
    expect(resolveBullMqPrefix({})).toBe('bull');
  });

  it('main.ts starts match-ingestion, champion-aggregation, rank enrichment, and AI insight', () => {
    const source = readFileSync(join(here, 'main.ts'), 'utf8');
    expect(source).toContain('createMatchIngestionWorker');
    expect(source).toContain('createChampionAggregationWorker');
    expect(source).toContain('createParticipantRankEnrichmentWorker');
    expect(source).toContain('createChampionAiInsightWorker');
    expect(source).toContain('MATCH_INGESTION_JOB_NAME');
    expect(source).toContain('CHAMPION_AGGREGATION_JOB_NAME');
    expect(source).toContain('PARTICIPANT_RANK_ENRICHMENT_JOB_NAME');
    expect(source).toContain('CHAMPION_AI_INSIGHT_JOB_NAME');
    expect(source).not.toContain('createDefaultWorker');
    expect(source).not.toContain('createDefaultQueue');
    expect(source).toContain('all_consumers_initialized');
    expect(source).toContain('matchIngestionWorker.close()');
    expect(source).toContain('championAggregationWorker.close()');
    expect(source).toContain('participantRankEnrichmentWorker.close()');
    expect(source).toContain('championAiInsightWorker.close()');
    expect(source).not.toContain('AI_API_KEY');
    expect(source).not.toContain('championAiInsightConfig.apiKey');
  });

  it('smoke CLI remains available separately', () => {
    const source = readFileSync(join(here, 'cli/smoke-worker.ts'), 'utf8');
    expect(source).toContain('createDefaultWorker');
    expect(source).toContain('league-helper-default');
  });
});
