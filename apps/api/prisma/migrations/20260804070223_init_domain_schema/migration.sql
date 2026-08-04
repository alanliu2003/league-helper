-- CreateEnum
CREATE TYPE "MatchIngestionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TimelineFetchStatus" AS ENUM ('PENDING', 'FETCHED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "StaticDataStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "AnalysisReportStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AnalysisReportType" AS ENUM ('PLAYER_OVERVIEW', 'CHAMPION_FOCUS', 'MATCHUP_FOCUS');

-- CreateEnum
CREATE TYPE "IngestionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAccount" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "regionalRoute" TEXT NOT NULL,
    "summonerId" TEXT,
    "accountId" TEXT,
    "currentGameName" TEXT NOT NULL,
    "currentTagLine" TEXT NOT NULL,
    "normalizedGameName" TEXT NOT NULL,
    "normalizedTagLine" TEXT NOT NULL,
    "profileIconId" INTEGER,
    "summonerLevel" INTEGER,
    "lastResolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlayerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAccountAlias" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "tagLine" TEXT NOT NULL,
    "normalizedGameName" TEXT NOT NULL,
    "normalizedTagLine" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlayerAccountAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "division" TEXT,
    "leaguePoints" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "veteran" BOOLEAN NOT NULL DEFAULT false,
    "inactive" BOOLEAN NOT NULL DEFAULT false,
    "freshBlood" BOOLEAN NOT NULL DEFAULT false,
    "hotStreak" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalMatchId" TEXT NOT NULL,
    "platformRoute" TEXT,
    "regionalRoute" TEXT NOT NULL,
    "gameId" BIGINT,
    "queueId" INTEGER NOT NULL,
    "mapId" INTEGER,
    "gameMode" TEXT,
    "gameType" TEXT,
    "gameCreation" TIMESTAMPTZ(3) NOT NULL,
    "gameEndTimestamp" TIMESTAMPTZ(3),
    "gameDurationSeconds" INTEGER NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "normalizedPatch" TEXT,
    "remake" BOOLEAN NOT NULL DEFAULT false,
    "earlySurrender" BOOLEAN NOT NULL DEFAULT false,
    "ingestionStatus" "MatchIngestionStatus" NOT NULL DEFAULT 'PENDING',
    "normalizationVersion" TEXT NOT NULL DEFAULT '1',
    "rawPayload" JSONB,
    "ingestedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "participantId" INTEGER NOT NULL,
    "playerAccountId" TEXT,
    "externalAccountId" TEXT,
    "riotIdGameName" TEXT,
    "riotIdTagLine" TEXT,
    "championId" INTEGER NOT NULL,
    "championName" TEXT,
    "teamId" INTEGER NOT NULL,
    "teamPosition" TEXT NOT NULL,
    "individualPosition" TEXT NOT NULL,
    "lane" TEXT,
    "role" TEXT,
    "rankTierAtIngestion" TEXT,
    "rankDivisionAtIngestion" TEXT,
    "win" BOOLEAN NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "largestKillingSpree" INTEGER,
    "totalMinionsKilled" INTEGER NOT NULL DEFAULT 0,
    "neutralMinionsKilled" INTEGER NOT NULL DEFAULT 0,
    "totalCs" INTEGER NOT NULL DEFAULT 0,
    "goldEarned" INTEGER NOT NULL DEFAULT 0,
    "goldSpent" INTEGER NOT NULL DEFAULT 0,
    "totalDamageDealtToChampions" INTEGER NOT NULL DEFAULT 0,
    "physicalDamageDealtToChampions" INTEGER NOT NULL DEFAULT 0,
    "magicDamageDealtToChampions" INTEGER NOT NULL DEFAULT 0,
    "trueDamageDealtToChampions" INTEGER NOT NULL DEFAULT 0,
    "totalDamageTaken" INTEGER NOT NULL DEFAULT 0,
    "visionScore" INTEGER NOT NULL DEFAULT 0,
    "wardsPlaced" INTEGER NOT NULL DEFAULT 0,
    "wardsKilled" INTEGER NOT NULL DEFAULT 0,
    "controlWardsPurchased" INTEGER,
    "timePlayedSeconds" INTEGER NOT NULL DEFAULT 0,
    "itemIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "perkIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "statPerkIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "summonerSpell1Id" INTEGER NOT NULL DEFAULT 0,
    "summonerSpell2Id" INTEGER NOT NULL DEFAULT 0,
    "goldAt10" INTEGER,
    "goldAt15" INTEGER,
    "csAt10" INTEGER,
    "csAt15" INTEGER,
    "xpAt10" INTEGER,
    "xpAt15" INTEGER,
    "goldDifferenceAt10" INTEGER,
    "goldDifferenceAt15" INTEGER,
    "csDifferenceAt10" INTEGER,
    "csDifferenceAt15" INTEGER,
    "xpDifferenceAt10" INTEGER,
    "xpDifferenceAt15" INTEGER,
    "deathsBefore10" INTEGER,
    "deathsBetween10And20" INTEGER,
    "deathsBeforeObjectives" INTEGER,
    "firstCompletedItemId" INTEGER,
    "firstCompletedItemAtSeconds" INTEGER,
    "killParticipation" DOUBLE PRECISION,
    "skillOrder" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTeam" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,
    "win" BOOLEAN NOT NULL,
    "earlySurrender" BOOLEAN NOT NULL DEFAULT false,
    "bans" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "objectives" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTimeline" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "fetchStatus" "TimelineFetchStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB,
    "timelineSchemaVersion" TEXT NOT NULL DEFAULT '1',
    "fetchedAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionMasterySnapshot" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "championLevel" INTEGER NOT NULL,
    "championPoints" INTEGER NOT NULL,
    "lastPlayTime" TIMESTAMPTZ(3),
    "championPointsSinceLastLevel" INTEGER,
    "championPointsUntilNextLevel" INTEGER,
    "chestGranted" BOOLEAN,
    "tokensEarned" INTEGER,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChampionMasterySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patch" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "normalizedMajorMinor" TEXT NOT NULL,
    "dataDragonVersion" TEXT,
    "releaseDate" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "staticDataStatus" "StaticDataStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Patch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionStaticData" (
    "id" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "championKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "baseStats" JSONB NOT NULL,
    "passive" JSONB NOT NULL,
    "spells" JSONB NOT NULL,
    "imageData" JSONB NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChampionStaticData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemStaticData" (
    "id" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "plaintext" TEXT,
    "goldData" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageData" JSONB NOT NULL,
    "purchasable" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ItemStaticData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuneStaticData" (
    "id" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "runeId" INTEGER NOT NULL,
    "runeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT,
    "longDescription" TEXT,
    "icon" TEXT NOT NULL,
    "treeId" INTEGER,
    "treeName" TEXT,
    "slotIndex" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RuneStaticData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionAggregate" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL DEFAULT '',
    "regionalRoute" TEXT NOT NULL DEFAULT '',
    "queueId" INTEGER NOT NULL,
    "rankTier" TEXT NOT NULL,
    "teamPosition" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "totalKills" INTEGER NOT NULL DEFAULT 0,
    "totalDeaths" INTEGER NOT NULL DEFAULT 0,
    "totalAssists" INTEGER NOT NULL DEFAULT 0,
    "totalCs" INTEGER NOT NULL DEFAULT 0,
    "totalGameSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalDamageToChampions" INTEGER NOT NULL DEFAULT 0,
    "totalVisionScore" INTEGER NOT NULL DEFAULT 0,
    "totalGoldDifferenceAt10" INTEGER,
    "goldDifferenceAt10Samples" INTEGER NOT NULL DEFAULT 0,
    "totalGoldDifferenceAt15" INTEGER,
    "goldDifferenceAt15Samples" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceNormalizationVersion" TEXT NOT NULL,

    CONSTRAINT "ChampionAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupAggregate" (
    "id" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL DEFAULT '',
    "regionalRoute" TEXT NOT NULL DEFAULT '',
    "queueId" INTEGER NOT NULL,
    "rankTier" TEXT NOT NULL,
    "teamPosition" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "opponentChampionId" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "totalGoldDifferenceAt10" INTEGER,
    "goldDifferenceAt10Samples" INTEGER NOT NULL DEFAULT 0,
    "totalGoldDifferenceAt15" INTEGER,
    "goldDifferenceAt15Samples" INTEGER NOT NULL DEFAULT 0,
    "totalCsDifferenceAt10" INTEGER,
    "csDifferenceAt10Samples" INTEGER NOT NULL DEFAULT 0,
    "totalCsDifferenceAt15" INTEGER,
    "csDifferenceAt15Samples" INTEGER NOT NULL DEFAULT 0,
    "soloKills" INTEGER,
    "firstDeaths" INTEGER,
    "totalKillDifference" INTEGER,
    "totalDeathDifference" INTEGER,
    "totalAssistDifference" INTEGER,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceNormalizationVersion" TEXT NOT NULL,

    CONSTRAINT "MatchupAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMetricSnapshot" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "selectedChampionId" INTEGER,
    "selectedOpponentChampionId" INTEGER,
    "patch" TEXT,
    "queueId" INTEGER,
    "role" TEXT,
    "matchesAnalyzed" INTEGER NOT NULL,
    "sourceDataVersion" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAnalysisReport" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "playerMetricSnapshotId" TEXT NOT NULL,
    "reportType" "AnalysisReportType" NOT NULL,
    "status" "AnalysisReportStatus" NOT NULL DEFAULT 'PENDING',
    "deterministicSummary" TEXT,
    "aiSummary" TEXT,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "sourceDataVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlayerAnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisFinding" (
    "id" TEXT NOT NULL,
    "playerAnalysisReportId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "playerValue" DOUBLE PRECISION,
    "peerValue" DOUBLE PRECISION,
    "percentile" DOUBLE PRECISION,
    "evidence" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJobRecord" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalResourceId" TEXT,
    "status" "IngestionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "scheduledAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "deadLetteredAt" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IngestionJobRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerAccount_playerId_idx" ON "PlayerAccount"("playerId");

-- CreateIndex
CREATE INDEX "PlayerAccount_provider_platformRoute_normalizedGameName_nor_idx" ON "PlayerAccount"("provider", "platformRoute", "normalizedGameName", "normalizedTagLine");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAccount_provider_externalAccountId_key" ON "PlayerAccount"("provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "PlayerAccountAlias_playerAccountId_isCurrent_idx" ON "PlayerAccountAlias"("playerAccountId", "isCurrent");

-- CreateIndex
CREATE INDEX "PlayerAccountAlias_normalizedGameName_normalizedTagLine_idx" ON "PlayerAccountAlias"("normalizedGameName", "normalizedTagLine");

-- CreateIndex
CREATE INDEX "RankSnapshot_playerAccountId_queueType_capturedAt_idx" ON "RankSnapshot"("playerAccountId", "queueType", "capturedAt");

-- CreateIndex
CREATE INDEX "Match_normalizedPatch_queueId_idx" ON "Match"("normalizedPatch", "queueId");

-- CreateIndex
CREATE INDEX "Match_gameCreation_idx" ON "Match"("gameCreation");

-- CreateIndex
CREATE INDEX "Match_ingestionStatus_idx" ON "Match"("ingestionStatus");

-- CreateIndex
CREATE INDEX "Match_platformRoute_queueId_gameCreation_idx" ON "Match"("platformRoute", "queueId", "gameCreation");

-- CreateIndex
CREATE INDEX "Match_regionalRoute_queueId_gameCreation_idx" ON "Match"("regionalRoute", "queueId", "gameCreation");

-- CreateIndex
CREATE UNIQUE INDEX "Match_provider_externalMatchId_key" ON "Match"("provider", "externalMatchId");

-- CreateIndex
CREATE INDEX "MatchParticipant_matchId_teamId_idx" ON "MatchParticipant"("matchId", "teamId");

-- CreateIndex
CREATE INDEX "MatchParticipant_playerAccountId_matchId_idx" ON "MatchParticipant"("playerAccountId", "matchId");

-- CreateIndex
CREATE INDEX "MatchParticipant_externalAccountId_idx" ON "MatchParticipant"("externalAccountId");

-- CreateIndex
CREATE INDEX "MatchParticipant_championId_teamPosition_idx" ON "MatchParticipant"("championId", "teamPosition");

-- CreateIndex
CREATE INDEX "MatchParticipant_championId_individualPosition_idx" ON "MatchParticipant"("championId", "individualPosition");

-- CreateIndex
CREATE INDEX "MatchParticipant_championId_matchId_idx" ON "MatchParticipant"("championId", "matchId");

-- CreateIndex
CREATE INDEX "MatchParticipant_rankTierAtIngestion_championId_idx" ON "MatchParticipant"("rankTierAtIngestion", "championId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_participantId_key" ON "MatchParticipant"("matchId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchTeam_matchId_teamId_key" ON "MatchTeam"("matchId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchTimeline_matchId_key" ON "MatchTimeline"("matchId");

-- CreateIndex
CREATE INDEX "MatchTimeline_fetchStatus_idx" ON "MatchTimeline"("fetchStatus");

-- CreateIndex
CREATE INDEX "ChampionMasterySnapshot_playerAccountId_capturedAt_idx" ON "ChampionMasterySnapshot"("playerAccountId", "capturedAt");

-- CreateIndex
CREATE INDEX "ChampionMasterySnapshot_playerAccountId_championId_captured_idx" ON "ChampionMasterySnapshot"("playerAccountId", "championId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Patch_version_key" ON "Patch"("version");

-- CreateIndex
CREATE INDEX "Patch_normalizedMajorMinor_idx" ON "Patch"("normalizedMajorMinor");

-- CreateIndex
CREATE INDEX "Patch_isActive_idx" ON "Patch"("isActive");

-- CreateIndex
CREATE INDEX "ChampionStaticData_name_idx" ON "ChampionStaticData"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionStaticData_patchId_championId_key" ON "ChampionStaticData"("patchId", "championId");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionStaticData_patchId_championKey_key" ON "ChampionStaticData"("patchId", "championKey");

-- CreateIndex
CREATE UNIQUE INDEX "ItemStaticData_patchId_itemId_key" ON "ItemStaticData"("patchId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "RuneStaticData_patchId_runeId_key" ON "RuneStaticData"("patchId", "runeId");

-- CreateIndex
CREATE INDEX "ChampionAggregate_championId_patch_queueId_rankTier_teamPos_idx" ON "ChampionAggregate"("championId", "patch", "queueId", "rankTier", "teamPosition");

-- CreateIndex
CREATE INDEX "ChampionAggregate_patch_queueId_rankTier_idx" ON "ChampionAggregate"("patch", "queueId", "rankTier");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionAggregate_patch_platformRoute_regionalRoute_queueId_key" ON "ChampionAggregate"("patch", "platformRoute", "regionalRoute", "queueId", "rankTier", "teamPosition", "championId");

-- CreateIndex
CREATE INDEX "MatchupAggregate_championId_opponentChampionId_patch_queueI_idx" ON "MatchupAggregate"("championId", "opponentChampionId", "patch", "queueId", "rankTier");

-- CreateIndex
CREATE INDEX "MatchupAggregate_championId_patch_teamPosition_idx" ON "MatchupAggregate"("championId", "patch", "teamPosition");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupAggregate_patch_platformRoute_regionalRoute_queueId__key" ON "MatchupAggregate"("patch", "platformRoute", "regionalRoute", "queueId", "rankTier", "teamPosition", "championId", "opponentChampionId");

-- CreateIndex
CREATE INDEX "PlayerMetricSnapshot_playerAccountId_calculatedAt_idx" ON "PlayerMetricSnapshot"("playerAccountId", "calculatedAt");

-- CreateIndex
CREATE INDEX "PlayerMetricSnapshot_playerAccountId_selectedChampionId_cal_idx" ON "PlayerMetricSnapshot"("playerAccountId", "selectedChampionId", "calculatedAt");

-- CreateIndex
CREATE INDEX "PlayerAnalysisReport_playerAccountId_createdAt_idx" ON "PlayerAnalysisReport"("playerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "PlayerAnalysisReport_playerMetricSnapshotId_idx" ON "PlayerAnalysisReport"("playerMetricSnapshotId");

-- CreateIndex
CREATE INDEX "PlayerAnalysisReport_status_idx" ON "PlayerAnalysisReport"("status");

-- CreateIndex
CREATE INDEX "AnalysisFinding_playerAnalysisReportId_sortOrder_idx" ON "AnalysisFinding"("playerAnalysisReportId", "sortOrder");

-- CreateIndex
CREATE INDEX "IngestionJobRecord_status_priority_scheduledAt_idx" ON "IngestionJobRecord"("status", "priority", "scheduledAt");

-- CreateIndex
CREATE INDEX "IngestionJobRecord_provider_externalResourceId_idx" ON "IngestionJobRecord"("provider", "externalResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionJobRecord_jobType_idempotencyKey_key" ON "IngestionJobRecord"("jobType", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "PlayerAccount" ADD CONSTRAINT "PlayerAccount_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAccountAlias" ADD CONSTRAINT "PlayerAccountAlias_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTeam" ADD CONSTRAINT "MatchTeam_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTimeline" ADD CONSTRAINT "MatchTimeline_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionMasterySnapshot" ADD CONSTRAINT "ChampionMasterySnapshot_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionStaticData" ADD CONSTRAINT "ChampionStaticData_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "Patch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStaticData" ADD CONSTRAINT "ItemStaticData_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "Patch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuneStaticData" ADD CONSTRAINT "RuneStaticData_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "Patch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMetricSnapshot" ADD CONSTRAINT "PlayerMetricSnapshot_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAnalysisReport" ADD CONSTRAINT "PlayerAnalysisReport_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAnalysisReport" ADD CONSTRAINT "PlayerAnalysisReport_playerMetricSnapshotId_fkey" FOREIGN KEY ("playerMetricSnapshotId") REFERENCES "PlayerMetricSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisFinding" ADD CONSTRAINT "AnalysisFinding_playerAnalysisReportId_fkey" FOREIGN KEY ("playerAnalysisReportId") REFERENCES "PlayerAnalysisReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual check constraints (Prisma cannot express these invariants)
ALTER TABLE "RankSnapshot"
  ADD CONSTRAINT "RankSnapshot_nonneg_counts_check"
  CHECK ("wins" >= 0 AND "losses" >= 0 AND "leaguePoints" >= 0);

ALTER TABLE "MatchParticipant"
  ADD CONSTRAINT "MatchParticipant_participantId_range_check"
  CHECK ("participantId" >= 0 AND "participantId" <= 20);

ALTER TABLE "MatchParticipant"
  ADD CONSTRAINT "MatchParticipant_nonneg_core_stats_check"
  CHECK (
    "kills" >= 0 AND "deaths" >= 0 AND "assists" >= 0
    AND "totalCs" >= 0 AND "goldEarned" >= 0 AND "visionScore" >= 0
  );

ALTER TABLE "MatchParticipant"
  ADD CONSTRAINT "MatchParticipant_killParticipation_range_check"
  CHECK ("killParticipation" IS NULL OR ("killParticipation" >= 0 AND "killParticipation" <= 1));

ALTER TABLE "ChampionAggregate"
  ADD CONSTRAINT "ChampionAggregate_nonneg_sample_check"
  CHECK ("sampleSize" >= 0 AND "wins" >= 0 AND "wins" <= "sampleSize");

ALTER TABLE "MatchupAggregate"
  ADD CONSTRAINT "MatchupAggregate_champion_ne_opponent_check"
  CHECK ("championId" <> "opponentChampionId");

ALTER TABLE "MatchupAggregate"
  ADD CONSTRAINT "MatchupAggregate_nonneg_sample_check"
  CHECK ("sampleSize" >= 0 AND "wins" >= 0 AND "wins" <= "sampleSize");

ALTER TABLE "AnalysisFinding"
  ADD CONSTRAINT "AnalysisFinding_percentile_range_check"
  CHECK ("percentile" IS NULL OR ("percentile" >= 0 AND "percentile" <= 100));

ALTER TABLE "IngestionJobRecord"
  ADD CONSTRAINT "IngestionJobRecord_attempts_check"
  CHECK ("attemptCount" >= 0 AND "maxAttempts" >= 1 AND "attemptCount" <= "maxAttempts" + 50);
