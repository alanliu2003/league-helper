-- M17 player playstyle insights. Dedicated table; do not reuse PlayerAnalysisReport.

CREATE TYPE "PlayerPlaystyleInsightStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "PlayerPlaystyleInsight" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "PlayerPlaystyleInsightStatus" NOT NULL DEFAULT 'PENDING',
    "inputContext" JSONB NOT NULL,
    "structuredResult" JSONB,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlayerPlaystyleInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerPlaystyleInsight_scope_fp_key" ON "PlayerPlaystyleInsight"("playerAccountId", "queueId", "contextFingerprint");

CREATE INDEX "PlayerPlaystyleInsight_playerAccountId_status_idx" ON "PlayerPlaystyleInsight"("playerAccountId", "status");

CREATE INDEX "PlayerPlaystyleInsight_status_updatedAt_idx" ON "PlayerPlaystyleInsight"("status", "updatedAt");

ALTER TABLE "PlayerPlaystyleInsight" ADD CONSTRAINT "PlayerPlaystyleInsight_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
