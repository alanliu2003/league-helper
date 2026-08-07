-- AlterEnum
ALTER TYPE "TrackedPlayerEnrollmentSource" ADD VALUE 'MATCH_PARTICIPANT';

-- CreateEnum
CREATE TYPE "CollectorSchedulerOutcome" AS ENUM ('TRIGGERED', 'SKIPPED_BACKPRESSURE', 'SKIPPED_COOLDOWN', 'FAILED_TO_START');

-- AlterTable TrackedPlayer
ALTER TABLE "TrackedPlayer" ADD COLUMN "discoveryDepth" INTEGER NOT NULL DEFAULT 0;

-- AlterTable CollectorRun (Task 4 async expansion counters; Task 3 counters unchanged)
ALTER TABLE "CollectorRun" ADD COLUMN "participantsConsidered" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectorRun" ADD COLUMN "playersEnrolledFromParticipants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectorRun" ADD COLUMN "playersAlreadyTrackedFromParticipants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectorRun" ADD COLUMN "playersSkippedDepthLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectorRun" ADD COLUMN "playersSkippedPopulationCap" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CollectorPopulationBudget" (
    "id" TEXT NOT NULL,
    "matchParticipantEnrolledCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollectorPopulationBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorSchedulerState" (
    "id" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "lastTriggerAt" TIMESTAMPTZ(3),
    "lastOutcome" "CollectorSchedulerOutcome",
    "lastCollectorRunId" TEXT,
    "lastErrorCode" TEXT,
    "cooldownUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollectorSchedulerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRunSourceQuota" (
    "id" TEXT NOT NULL,
    "collectorRunId" TEXT NOT NULL,
    "sourceTrackedPlayerId" TEXT NOT NULL,
    "newPlayersEnrolled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollectorRunSourceQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedPlayer_discoveryDepth_idx" ON "TrackedPlayer"("discoveryDepth");

-- CreateIndex
CREATE INDEX "CollectorRunSourceQuota_collectorRunId_idx" ON "CollectorRunSourceQuota"("collectorRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorRunSourceQuota_collectorRunId_sourceTrackedPlayerId_key" ON "CollectorRunSourceQuota"("collectorRunId", "sourceTrackedPlayerId");

-- AddForeignKey
ALTER TABLE "CollectorRunSourceQuota" ADD CONSTRAINT "CollectorRunSourceQuota_collectorRunId_fkey" FOREIGN KEY ("collectorRunId") REFERENCES "CollectorRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorRunSourceQuota" ADD CONSTRAINT "CollectorRunSourceQuota_sourceTrackedPlayerId_fkey" FOREIGN KEY ("sourceTrackedPlayerId") REFERENCES "TrackedPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed singletons (additive; idempotent)
INSERT INTO "CollectorPopulationBudget" (id, "matchParticipantEnrolledCount", "createdAt", "updatedAt")
VALUES ('singleton', 0, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "CollectorSchedulerState" (id, "createdAt", "updatedAt")
VALUES ('singleton', now(), now())
ON CONFLICT (id) DO NOTHING;
