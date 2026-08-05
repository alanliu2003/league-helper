import type { PlayerRefreshStatus } from '@league-helper/shared';

export const PLAYER_MATCH_POLL_INTERVAL_MS = 5_000;
export const PLAYER_MATCH_POLL_MAX_MS = 5 * 60_000;

/** Jobs still waiting or running (includes rate-limit delays). */
export function hasInFlightMatchJobs(refresh: PlayerRefreshStatus): boolean {
  return refresh.queuedMatchCount + refresh.activeMatchCount + refresh.delayedMatchCount > 0;
}

/**
 * Poll while PROCESSING/PARTIAL and work remains in queued/active/delayed.
 * Delayed rate-limit waits still count as in-flight (not "stuck").
 */
export function shouldPollMatchProgress(refresh: PlayerRefreshStatus): boolean {
  if (!hasInFlightMatchJobs(refresh)) {
    return false;
  }
  return (
    refresh.state === 'PROCESSING' ||
    refresh.state === 'PARTIAL' ||
    refresh.state === 'RATE_LIMITED'
  );
}

export function shouldStopPollingForTimeout(startedAtMs: number, nowMs = Date.now()): boolean {
  return nowMs - startedAtMs >= PLAYER_MATCH_POLL_MAX_MS;
}
