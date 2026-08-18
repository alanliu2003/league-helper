-- M19 product timeline: kill/objective event columns + compact frames.
-- Does not backfill historical events (requires Riot re-fetch via match-timeline jobs).

CREATE TYPE "TimelineProductCoverage" AS ENUM ('NONE', 'STORED', 'INELIGIBLE');

ALTER TABLE "MatchTimeline"
ADD COLUMN "productCoverage" "TimelineProductCoverage" NOT NULL DEFAULT 'NONE',
ADD COLUMN "frameIntervalMs" INTEGER,
ADD COLUMN "productNormalizedAt" TIMESTAMPTZ(3);

ALTER TABLE "MatchTimelineEvent"
ADD COLUMN "killerParticipantId" INTEGER,
ADD COLUMN "victimParticipantId" INTEGER,
ADD COLUMN "assistingParticipantIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "teamId" INTEGER,
ADD COLUMN "positionX" INTEGER,
ADD COLUMN "positionY" INTEGER,
ADD COLUMN "monsterType" TEXT,
ADD COLUMN "monsterSubType" TEXT,
ADD COLUMN "buildingType" TEXT,
ADD COLUMN "towerType" TEXT,
ADD COLUMN "laneType" TEXT;

CREATE TABLE "MatchTimelineFrame" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "totalGold" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "cs" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchTimelineFrame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchTimelineFrame_matchId_timestampMs_participantId_key"
ON "MatchTimelineFrame"("matchId", "timestampMs", "participantId");

CREATE INDEX "MatchTimelineFrame_matchId_timestampMs_idx"
ON "MatchTimelineFrame"("matchId", "timestampMs");

ALTER TABLE "MatchTimelineFrame"
ADD CONSTRAINT "MatchTimelineFrame_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "Match"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
