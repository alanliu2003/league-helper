-- Milestone 11 Phase 3: activity-aware refresh (hot/warm/cold) streak counter.
-- Additive, default 0; existing TrackedPlayer rows remain valid.
ALTER TABLE "TrackedPlayer"
ADD COLUMN "consecutiveZeroNewMatchRuns" INTEGER NOT NULL DEFAULT 0;
