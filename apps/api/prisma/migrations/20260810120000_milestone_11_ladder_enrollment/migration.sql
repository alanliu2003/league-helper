-- AlterEnum: additive LADDER enrollment source (Postgres ALTER TYPE ADD VALUE).
ALTER TYPE "TrackedPlayerEnrollmentSource" ADD VALUE 'LADDER';

-- CreateTable: singleton total TrackedPlayer + LADDER-root ceilings.
CREATE TABLE "CollectorTrackedPlayerBudget" (
    "id" TEXT NOT NULL,
    "trackedPlayerCount" INTEGER NOT NULL DEFAULT 0,
    "ladderEnrolledCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollectorTrackedPlayerBudget_pkey" PRIMARY KEY ("id")
);

-- Seed singleton bootstrapped from existing TrackedPlayer rows (never force trackedPlayerCount to 0).
-- Restart-safe / idempotent: ON CONFLICT DO NOTHING.
--
-- ladderEnrolledCount is seeded as 0 here because Postgres forbids using a newly added enum
-- value in the same transaction as ALTER TYPE ... ADD VALUE (SQLSTATE 55P04). No pre-migration
-- TrackedPlayer row can have enrollmentSource=LADDER. Post-migrate, use
-- ensureTrackedPlayerBudgetSingleton / reconcileTrackedPlayerBudgetFromRows for live counts.
INSERT INTO "CollectorTrackedPlayerBudget" (id, "trackedPlayerCount", "ladderEnrolledCount", "createdAt", "updatedAt")
SELECT
  'singleton',
  (SELECT COUNT(*)::int FROM "TrackedPlayer"),
  0,
  now(),
  now()
ON CONFLICT (id) DO NOTHING;
