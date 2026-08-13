-- M15 matchup aggregates: versioning + latestEligibleMatchAt for source-derived rebuilds.
-- Table was unused (0 rows). Unique key now includes sourceNormalizationVersion + aggregationVersion.

ALTER TABLE "MatchupAggregate"
ADD COLUMN "aggregationVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN "latestEligibleMatchAt" TIMESTAMPTZ(3);

DROP INDEX IF EXISTS "MatchupAggregate_patch_platformRoute_regionalRoute_queueId__key";

CREATE UNIQUE INDEX "MatchupAggregate_dims_key" ON "MatchupAggregate"(
  "patch",
  "platformRoute",
  "regionalRoute",
  "queueId",
  "rankTier",
  "teamPosition",
  "championId",
  "opponentChampionId",
  "sourceNormalizationVersion",
  "aggregationVersion"
);
