-- M14 champion build / rune / spell / skill-order aggregates + static identity fields.
-- Rebuildable from persisted MatchParticipant / MatchTimelineEvent source. No Riot backfill.

-- AlterTable ItemStaticData: from/into graph + consumed flag for completed-vs-component classification.
ALTER TABLE "ItemStaticData"
ADD COLUMN "fromItemIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "intoItemIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "consumed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable SummonerSpellStaticData
CREATE TABLE "SummonerSpellStaticData" (
    "id" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "spellId" INTEGER NOT NULL,
    "spellKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageData" JSONB NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SummonerSpellStaticData_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SummonerSpellStaticData_patchId_spellId_key"
ON "SummonerSpellStaticData"("patchId", "spellId");

ALTER TABLE "SummonerSpellStaticData"
ADD CONSTRAINT "SummonerSpellStaticData_patchId_fkey"
FOREIGN KEY ("patchId") REFERENCES "Patch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable ChampionBuildAggregate
CREATE TABLE "ChampionBuildAggregate" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL DEFAULT '',
    "regionalRoute" TEXT NOT NULL DEFAULT '',
    "queueId" INTEGER NOT NULL,
    "rankTier" TEXT NOT NULL,
    "teamPosition" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "entityIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "auxIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "primaryStyleId" INTEGER,
    "secondaryStyleId" INTEGER,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "eligibleGames" INTEGER NOT NULL,
    "aggregationVersion" TEXT NOT NULL DEFAULT '1',
    "latestEligibleMatchAt" TIMESTAMPTZ(3),
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceNormalizationVersion" TEXT NOT NULL,

    CONSTRAINT "ChampionBuildAggregate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChampionBuildAggregate_dims_category_sig_key"
ON "ChampionBuildAggregate"(
    "patch",
    "platformRoute",
    "regionalRoute",
    "queueId",
    "rankTier",
    "teamPosition",
    "championId",
    "category",
    "signature",
    "sourceNormalizationVersion",
    "aggregationVersion"
);

CREATE INDEX "ChampionBuildAggregate_champion_scope_idx"
ON "ChampionBuildAggregate"("championId", "patch", "queueId", "rankTier", "teamPosition", "category");

CREATE INDEX "ChampionBuildAggregate_patch_platform_queue_idx"
ON "ChampionBuildAggregate"("patch", "platformRoute", "queueId", "aggregationVersion", "category");
