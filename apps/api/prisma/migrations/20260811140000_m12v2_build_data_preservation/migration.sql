-- M12-v2 build-data preservation checkpoint.
-- Forward-only source fields for future OP.GG-style build analytics.
-- Does not backfill historical item slots, perk styles, or timeline events.

-- AlterTable MatchParticipant: explicit perk style tree IDs (nullable for history).
ALTER TABLE "MatchParticipant"
ADD COLUMN "primaryPerkStyleId" INTEGER,
ADD COLUMN "secondaryPerkStyleId" INTEGER;

-- CreateTable: compact build/skill timeline events (not full Riot frames).
CREATE TABLE "MatchTimelineEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "participantId" INTEGER,
    "itemId" INTEGER,
    "beforeItemId" INTEGER,
    "afterItemId" INTEGER,
    "skillSlot" INTEGER,
    "levelUpType" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchTimelineEvent_matchId_eventIndex_key"
ON "MatchTimelineEvent"("matchId", "eventIndex");

-- CreateIndex: join path for per-participant purchase/skill reconstruction.
CREATE INDEX "MatchTimelineEvent_matchId_participantId_timestampMs_idx"
ON "MatchTimelineEvent"("matchId", "participantId", "timestampMs");

-- AddForeignKey
ALTER TABLE "MatchTimelineEvent"
ADD CONSTRAINT "MatchTimelineEvent_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "Match"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
