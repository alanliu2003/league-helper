/**
 * Pure activity-aware refresh scheduling for successful collector finalization.
 *
 * Activity signal: enqueuedNewCount from THIS refresh (ids newly needing publication),
 * NOT discoveredMatchCount. Already-complete and already-queued/deduped matches are
 * zero-new success.
 *
 * Failures must NOT call this module — existing finalizeFailure backoff remains
 * authoritative.
 */

export type CollectorActivityTier = 'HOT' | 'WARM' | 'COLD';

export type CollectorRefreshPolicyConfig = {
  hotRefreshIntervalMs: number;
  warmRefreshIntervalMs: number;
  coldRefreshIntervalMs: number;
  /** Consecutive successful zero-new runs required to enter COLD (>= 1). */
  coldAfterZeroNewRuns: number;
  hotPriority: number;
  warmPriority: number;
  coldPriority: number;
  priorityMin: number;
  priorityMax: number;
  /** Hard cap so the streak counter cannot grow forever. */
  maxConsecutiveZeroNewMatchRuns: number;
};

export type ComputeSuccessfulRefreshScheduleInput = {
  /** Matches newly needing publication by this refresh (discovery.enqueuedCount). */
  enqueuedNewCount: number;
  consecutiveZeroNewMatchRuns: number;
  nowMs: number;
  config: CollectorRefreshPolicyConfig;
};

export type SuccessfulRefreshSchedule = {
  activityTier: CollectorActivityTier;
  priority: number;
  nextEligibleDelayMs: number;
  nextEligibleAt: Date;
  consecutiveZeroNewMatchRuns: number;
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function classifyCollectorActivityTier(input: {
  enqueuedNewCount: number;
  consecutiveZeroNewMatchRunsAfter: number;
  coldAfterZeroNewRuns: number;
}): CollectorActivityTier {
  if (input.enqueuedNewCount >= 1) {
    return 'HOT';
  }
  if (input.consecutiveZeroNewMatchRunsAfter >= input.coldAfterZeroNewRuns) {
    return 'COLD';
  }
  return 'WARM';
}

/**
 * Compute next priority / eligibility / zero-new streak after a successful discovery.
 * Deterministic given injected nowMs.
 */
export function computeSuccessfulRefreshSchedule(
  input: ComputeSuccessfulRefreshScheduleInput,
): SuccessfulRefreshSchedule {
  const { config, nowMs } = input;
  const enqueuedNewCount = Math.max(0, Math.floor(input.enqueuedNewCount));
  const previousStreak = Math.max(0, Math.floor(input.consecutiveZeroNewMatchRuns));

  let consecutiveZeroNewMatchRuns: number;
  if (enqueuedNewCount >= 1) {
    consecutiveZeroNewMatchRuns = 0;
  } else {
    consecutiveZeroNewMatchRuns = Math.min(
      previousStreak + 1,
      config.maxConsecutiveZeroNewMatchRuns,
    );
  }

  const activityTier = classifyCollectorActivityTier({
    enqueuedNewCount,
    consecutiveZeroNewMatchRunsAfter: consecutiveZeroNewMatchRuns,
    coldAfterZeroNewRuns: config.coldAfterZeroNewRuns,
  });

  let nextEligibleDelayMs: number;
  let tierPriority: number;
  switch (activityTier) {
    case 'HOT':
      nextEligibleDelayMs = config.hotRefreshIntervalMs;
      tierPriority = config.hotPriority;
      break;
    case 'COLD':
      nextEligibleDelayMs = config.coldRefreshIntervalMs;
      tierPriority = config.coldPriority;
      break;
    case 'WARM':
    default:
      nextEligibleDelayMs = config.warmRefreshIntervalMs;
      tierPriority = config.warmPriority;
      break;
  }

  const priority = clampInt(tierPriority, config.priorityMin, config.priorityMax);

  return {
    activityTier,
    priority,
    nextEligibleDelayMs,
    nextEligibleAt: new Date(nowMs + nextEligibleDelayMs),
    consecutiveZeroNewMatchRuns,
  };
}
