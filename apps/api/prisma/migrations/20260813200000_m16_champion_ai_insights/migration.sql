-- M16 champion AI insights. Dedicated table; do not reuse PlayerAnalysisReport.

CREATE TYPE "ChampionAiInsightStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "ChampionAiInsight" (
    "id" TEXT NOT NULL,
    "championId" INTEGER NOT NULL,
    "championKey" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "rankTier" TEXT NOT NULL,
    "teamPosition" TEXT NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ChampionAiInsightStatus" NOT NULL DEFAULT 'PENDING',
    "inputContext" JSONB NOT NULL,
    "structuredResult" JSONB,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChampionAiInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChampionAiInsight_scope_fp_key" ON "ChampionAiInsight"("championId", "patch", "platformRoute", "queueId", "rankTier", "teamPosition", "contextFingerprint");

CREATE INDEX "ChampionAiInsight_championId_patch_status_idx" ON "ChampionAiInsight"("championId", "patch", "status");

CREATE INDEX "ChampionAiInsight_status_updatedAt_idx" ON "ChampionAiInsight"("status", "updatedAt");
