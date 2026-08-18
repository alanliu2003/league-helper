/** BullMQ queue names used across API producers and (future) workers. */
export const MATCH_INGESTION_QUEUE_NAME = 'match-ingestion' as const;

export const MATCH_INGESTION_JOB_NAME = 'INGEST_MATCH' as const;

export const MATCH_TIMELINE_QUEUE_NAME = 'match-timeline' as const;

export const MATCH_TIMELINE_JOB_NAME = 'ENRICH_MATCH_TIMELINE' as const;

export const CHAMPION_AGGREGATION_QUEUE_NAME = 'champion-aggregation' as const;

export const CHAMPION_AGGREGATION_JOB_NAME = 'RECALCULATE_CHAMPION_AGGREGATES' as const;

/** Phase 3 participant-rank enrichment (League-v4 by PUUID). Contract only in Phase 2. */
export const PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME = 'participant-rank-enrichment' as const;

export const PARTICIPANT_RANK_ENRICHMENT_JOB_NAME = 'ENRICH_PARTICIPANT_RANK' as const;

export const CHAMPION_AI_INSIGHT_QUEUE_NAME = 'champion-ai-insight' as const;

export const CHAMPION_AI_INSIGHT_JOB_NAME = 'GENERATE_CHAMPION_AI_INSIGHT' as const;

export const PLAYER_AI_PLAYSTYLE_QUEUE_NAME = 'player-ai-playstyle' as const;

export const PLAYER_AI_PLAYSTYLE_JOB_NAME = 'GENERATE_PLAYER_PLAYSTYLE_INSIGHT' as const;

export type MatchIngestionQueueName = typeof MATCH_INGESTION_QUEUE_NAME;
export type MatchIngestionJobName = typeof MATCH_INGESTION_JOB_NAME;
export type MatchTimelineQueueName = typeof MATCH_TIMELINE_QUEUE_NAME;
export type MatchTimelineJobName = typeof MATCH_TIMELINE_JOB_NAME;
export type ChampionAggregationQueueName = typeof CHAMPION_AGGREGATION_QUEUE_NAME;
export type ChampionAggregationJobName = typeof CHAMPION_AGGREGATION_JOB_NAME;
export type ParticipantRankEnrichmentQueueName = typeof PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME;
export type ParticipantRankEnrichmentJobName = typeof PARTICIPANT_RANK_ENRICHMENT_JOB_NAME;
export type ChampionAiInsightQueueName = typeof CHAMPION_AI_INSIGHT_QUEUE_NAME;
export type ChampionAiInsightJobName = typeof CHAMPION_AI_INSIGHT_JOB_NAME;
export type PlayerAiPlaystyleQueueName = typeof PLAYER_AI_PLAYSTYLE_QUEUE_NAME;
export type PlayerAiPlaystyleJobName = typeof PLAYER_AI_PLAYSTYLE_JOB_NAME;
