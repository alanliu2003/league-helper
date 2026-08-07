-- CreateEnum
CREATE TYPE "TrackedPlayerStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TrackedPlayerEnrollmentSource" AS ENUM ('ADMIN_SEED', 'PRODUCT_SEARCH', 'BOOTSTRAP');

-- CreateEnum
CREATE TYPE "CollectorRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "TrackedPlayer" (
    "id" TEXT NOT NULL,
    "playerAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "enrollmentSource" "TrackedPlayerEnrollmentSource" NOT NULL,
    "status" "TrackedPlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "nextEligibleAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSuccessfulRefreshAt" TIMESTAMPTZ(3),
    "lastClaimedAt" TIMESTAMPTZ(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrackedPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" TEXT NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "status" "CollectorRunStatus" NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "platformFilter" TEXT,
    "effectivePlatforms" JSONB NOT NULL,
    "queueId" INTEGER NOT NULL,
    "batchLimit" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "playersClaimed" INTEGER NOT NULL DEFAULT 0,
    "playersAttempted" INTEGER NOT NULL DEFAULT 0,
    "playersSucceeded" INTEGER NOT NULL DEFAULT 0,
    "playersFailed" INTEGER NOT NULL DEFAULT 0,
    "ownershipLost" INTEGER NOT NULL DEFAULT 0,
    "matchIdsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "matchesEnqueued" INTEGER NOT NULL DEFAULT 0,
    "matchesSkippedComplete" INTEGER NOT NULL DEFAULT 0,
    "rateLimitStops" INTEGER NOT NULL DEFAULT 0,
    "budgetExhausted" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedPlayer_playerAccountId_key" ON "TrackedPlayer"("playerAccountId");

-- CreateIndex
CREATE INDEX "TrackedPlayer_status_nextEligibleAt_priority_leaseExpiresAt_idx" ON "TrackedPlayer"("status", "nextEligibleAt", "priority", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "TrackedPlayer_platformRoute_status_idx" ON "TrackedPlayer"("platformRoute", "status");

-- CreateIndex
CREATE INDEX "TrackedPlayer_claim_eligibility_idx" ON "TrackedPlayer"("platformRoute", "status", "nextEligibleAt", "priority", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "TrackedPlayer_leaseOwner_idx" ON "TrackedPlayer"("leaseOwner");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorRun_ownerToken_key" ON "CollectorRun"("ownerToken");

-- CreateIndex
CREATE INDEX "CollectorRun_status_startedAt_idx" ON "CollectorRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "CollectorRun_finishedAt_idx" ON "CollectorRun"("finishedAt");

-- AddForeignKey
ALTER TABLE "TrackedPlayer" ADD CONSTRAINT "TrackedPlayer_playerAccountId_fkey" FOREIGN KEY ("playerAccountId") REFERENCES "PlayerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
