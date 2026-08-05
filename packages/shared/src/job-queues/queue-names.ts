/** BullMQ queue names used across API producers and (future) workers. */
export const MATCH_INGESTION_QUEUE_NAME = 'match-ingestion' as const;

export const MATCH_INGESTION_JOB_NAME = 'INGEST_MATCH' as const;

export const CHAMPION_AGGREGATION_QUEUE_NAME = 'champion-aggregation' as const;

export const CHAMPION_AGGREGATION_JOB_NAME = 'RECALCULATE_CHAMPION_AGGREGATES' as const;

export type MatchIngestionQueueName = typeof MATCH_INGESTION_QUEUE_NAME;
export type MatchIngestionJobName = typeof MATCH_INGESTION_JOB_NAME;
export type ChampionAggregationQueueName = typeof CHAMPION_AGGREGATION_QUEUE_NAME;
export type ChampionAggregationJobName = typeof CHAMPION_AGGREGATION_JOB_NAME;
