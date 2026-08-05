-- AlterEnum
CREATE TYPE "ChampionAggregationProcessingStatus" AS ENUM ('COMPLETED', 'FAILED');

-- AlterTable: ChampionAggregate CS-diff counters, versioning, freshness
ALTER TABLE "ChampionAggregate" ADD COLUMN "totalCsDifferenceAt10" INTEGER,
ADD COLUMN "csDifferenceAt10Samples" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalCsDifferenceAt15" INTEGER,
ADD COLUMN "csDifferenceAt15Samples" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aggregationVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN "latestEligibleMatchAt" TIMESTAMPTZ(3);

-- Drop old uniqueness (dimensions only) and replace with version-aware uniqueness.
-- Existing rows keep sourceNormalizationVersion and receive aggregationVersion='1' via DEFAULT.
DROP INDEX "ChampionAggregate_patch_platformRoute_regionalRoute_queueId_key";

CREATE UNIQUE INDEX "ChampionAggregate_patch_platformRoute_regionalRoute_queueId_key" ON "ChampionAggregate"("patch", "platformRoute", "regionalRoute", "queueId", "rankTier", "teamPosition", "championId", "sourceNormalizationVersion", "aggregationVersion");

-- Design-approved read/filter indexes (existing championId/patch and patch/queue indexes retained)
CREATE INDEX "ChampionAggregate_platformRoute_patch_queueId_aggregationVe_idx" ON "ChampionAggregate"("platformRoute", "patch", "queueId", "aggregationVersion");

CREATE INDEX "ChampionAggregate_aggregationVersion_calculatedAt_idx" ON "ChampionAggregate"("aggregationVersion", "calculatedAt");

-- Non-negative CHECKs for GD/CSD sample counters (existing wins<=sampleSize CHECK preserved)
ALTER TABLE "ChampionAggregate"
  ADD CONSTRAINT "ChampionAggregate_nonneg_diff_samples_check"
  CHECK (
    "goldDifferenceAt10Samples" >= 0
    AND "goldDifferenceAt15Samples" >= 0
    AND "csDifferenceAt10Samples" >= 0
    AND "csDifferenceAt15Samples" >= 0
  );

-- CreateTable: per-match operational aggregation processing marker
CREATE TABLE "ChampionAggregationProcessing" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sourceNormalizationVersion" TEXT NOT NULL,
    "aggregationVersion" TEXT NOT NULL,
    "status" "ChampionAggregationProcessingStatus" NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChampionAggregationProcessing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChampionAggregationProcessing_status_processedAt_idx" ON "ChampionAggregationProcessing"("status", "processedAt");

CREATE UNIQUE INDEX "ChampionAggregationProcessing_matchId_sourceNormalizationVe_key" ON "ChampionAggregationProcessing"("matchId", "sourceNormalizationVersion", "aggregationVersion");

ALTER TABLE "ChampionAggregationProcessing" ADD CONSTRAINT "ChampionAggregationProcessing_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
