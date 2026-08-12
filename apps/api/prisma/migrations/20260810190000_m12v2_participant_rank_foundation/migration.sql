-- M12-v2 Phase 2: participant-rank foundation (fresh from M11 baseline).
-- Do NOT reuse abandoned migration 20260810160000_participant_rank_enrichment.

-- CreateEnum
CREATE TYPE "ParticipantRankResolutionStatus" AS ENUM (
  'PENDING',
  'FAILED_RETRYABLE',
  'RESOLVED_RANKED',
  'RESOLVED_UNRANKED',
  'FAILED_PERMANENT',
  'NOT_APPLICABLE'
);

-- CreateTable
CREATE TABLE "ParticipantRankObservation" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "observedTier" TEXT,
    "observedDivision" TEXT,
    "resolutionStatus" "ParticipantRankResolutionStatus" NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "providerResultCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParticipantRankObservation_pkey" PRIMARY KEY ("id")
);

-- AlterTable MatchParticipant: explicit resolution state (keep rankTierAtIngestion).
ALTER TABLE "MatchParticipant"
ADD COLUMN "rankResolutionStatus" "ParticipantRankResolutionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "rankResolvedAt" TIMESTAMPTZ(3),
ADD COLUMN "rankObservationId" TEXT;

-- Replay-safe backfill for existing rows (empty DB is a no-op):
-- - non-420/440 → NOT_APPLICABLE
-- - ranked + missing PUUID → FAILED_PERMANENT
-- - ranked + valid exact tier → RESOLVED_RANKED
-- - ranked + null/invalid tier → PENDING (never silent UNKNOWN)
UPDATE "MatchParticipant" AS mp
SET
  "rankResolutionStatus" = CASE
    WHEN m."queueId" NOT IN (420, 440) THEN 'NOT_APPLICABLE'::"ParticipantRankResolutionStatus"
    WHEN mp."externalAccountId" IS NULL OR btrim(mp."externalAccountId") = '' THEN
      'FAILED_PERMANENT'::"ParticipantRankResolutionStatus"
    WHEN mp."rankTierAtIngestion" IS NOT NULL
      AND upper(btrim(mp."rankTierAtIngestion")) IN (
        'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD',
        'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'
      ) THEN 'RESOLVED_RANKED'::"ParticipantRankResolutionStatus"
    ELSE 'PENDING'::"ParticipantRankResolutionStatus"
  END,
  "rankResolvedAt" = CASE
    WHEN m."queueId" NOT IN (420, 440) THEN NULL
    WHEN mp."externalAccountId" IS NULL OR btrim(mp."externalAccountId") = '' THEN
      COALESCE(mp."updatedAt", mp."createdAt")
    WHEN mp."rankTierAtIngestion" IS NOT NULL
      AND upper(btrim(mp."rankTierAtIngestion")) IN (
        'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD',
        'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'
      ) THEN COALESCE(mp."updatedAt", mp."createdAt")
    ELSE NULL
  END,
  "rankTierAtIngestion" = CASE
    WHEN mp."rankTierAtIngestion" IS NOT NULL
      AND upper(btrim(mp."rankTierAtIngestion")) IN (
        'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD',
        'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'
      ) THEN upper(btrim(mp."rankTierAtIngestion"))
    ELSE mp."rankTierAtIngestion"
  END
FROM "Match" AS m
WHERE mp."matchId" = m."id";

-- CreateIndex
CREATE INDEX "ParticipantRankObservation_provider_platformRoute_externalAc_idx"
ON "ParticipantRankObservation"("provider", "platformRoute", "externalAccountId", "queueType", "observedAt" DESC);

CREATE INDEX "ParticipantRankObservation_externalAccountId_queueType_obser_idx"
ON "ParticipantRankObservation"("externalAccountId", "queueType", "observedAt");

CREATE INDEX "ParticipantRankObservation_resolutionStatus_observedAt_idx"
ON "ParticipantRankObservation"("resolutionStatus", "observedAt");

CREATE INDEX "MatchParticipant_rankResolutionStatus_championId_idx"
ON "MatchParticipant"("rankResolutionStatus", "championId");

CREATE INDEX "MatchParticipant_rankObservationId_idx"
ON "MatchParticipant"("rankObservationId");

-- AddForeignKey
ALTER TABLE "MatchParticipant"
ADD CONSTRAINT "MatchParticipant_rankObservationId_fkey"
FOREIGN KEY ("rankObservationId") REFERENCES "ParticipantRankObservation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
