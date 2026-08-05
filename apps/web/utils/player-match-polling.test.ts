import { describe, expect, it } from 'vitest';
import type { PlayerRefreshStatus } from '@league-helper/shared';
import {
  PLAYER_MATCH_POLL_MAX_MS,
  hasInFlightMatchJobs,
  shouldPollMatchProgress,
  shouldStopPollingForTimeout,
} from './player-match-polling';

function refresh(overrides: Partial<PlayerRefreshStatus> = {}): PlayerRefreshStatus {
  return {
    state: 'PROCESSING',
    requestedMatchCount: 5,
    discoveredMatchCount: 5,
    knownMatchCount: 0,
    queuedMatchCount: 2,
    activeMatchCount: 1,
    delayedMatchCount: 0,
    completedMatchCount: 0,
    failedMatchCount: 0,
    lastResolvedAt: null,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastRefreshedAt: null,
    isStale: false,
    warnings: [],
    ...overrides,
  };
}

describe('player match polling helpers', () => {
  it('continues while PROCESSING with queued/active/delayed jobs', () => {
    expect(shouldPollMatchProgress(refresh())).toBe(true);
    expect(
      shouldPollMatchProgress(
        refresh({
          state: 'PARTIAL',
          queuedMatchCount: 0,
          activeMatchCount: 0,
          delayedMatchCount: 2,
        }),
      ),
    ).toBe(true);
  });

  it('stops when no queued/active/delayed remain', () => {
    const done = refresh({
      state: 'COMPLETE',
      queuedMatchCount: 0,
      activeMatchCount: 0,
      delayedMatchCount: 0,
      completedMatchCount: 5,
    });
    expect(hasInFlightMatchJobs(done)).toBe(false);
    expect(shouldPollMatchProgress(done)).toBe(false);
  });

  it('does not treat delayed-only as idle (rate limit wait)', () => {
    const delayed = refresh({
      queuedMatchCount: 0,
      activeMatchCount: 0,
      delayedMatchCount: 3,
    });
    expect(hasInFlightMatchJobs(delayed)).toBe(true);
    expect(shouldPollMatchProgress(delayed)).toBe(true);
  });

  it('stops after max 5 minutes', () => {
    const started = 1_000_000;
    expect(shouldStopPollingForTimeout(started, started + PLAYER_MATCH_POLL_MAX_MS - 1)).toBe(
      false,
    );
    expect(shouldStopPollingForTimeout(started, started + PLAYER_MATCH_POLL_MAX_MS)).toBe(true);
  });
});
