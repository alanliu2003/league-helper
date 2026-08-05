/** BullMQ queue names used across API producers and (future) workers. */
export const MATCH_INGESTION_QUEUE_NAME = 'match-ingestion' as const;

export const MATCH_INGESTION_JOB_NAME = 'INGEST_MATCH' as const;

export type MatchIngestionQueueName = typeof MATCH_INGESTION_QUEUE_NAME;
export type MatchIngestionJobName = typeof MATCH_INGESTION_JOB_NAME;
