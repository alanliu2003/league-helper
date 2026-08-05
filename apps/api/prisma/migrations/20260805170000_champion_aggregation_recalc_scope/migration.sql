-- Durable previous-dimension-key scope for champion aggregation (previous ∪ current).
-- Written at post-COMPLETED-commit enqueue; read+cleared by the aggregation processor.

CREATE TABLE "ChampionAggregationRecalcScope" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sourceNormalizationVersion" TEXT NOT NULL,
    "aggregationVersion" TEXT NOT NULL,
    "previousDimensionKeys" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChampionAggregationRecalcScope_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChampionAggregationRecalcScope_createdAt_idx" ON "ChampionAggregationRecalcScope"("createdAt");

CREATE UNIQUE INDEX "ChampionAggregationRecalcScope_matchId_sourceNormalizationVe_key" ON "ChampionAggregationRecalcScope"("matchId", "sourceNormalizationVersion", "aggregationVersion");

ALTER TABLE "ChampionAggregationRecalcScope" ADD CONSTRAINT "ChampionAggregationRecalcScope_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
