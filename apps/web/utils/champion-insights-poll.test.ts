import { describe, expect, it } from 'vitest';
import {
  CHAMPION_AI_INSIGHT_POLL_MAX_MS,
  nextChampionInsightPollDelayMs,
  shouldContinueChampionInsightPoll,
} from './champion-insights-poll';

describe('champion insight pending poll', () => {
  it('uses 2s then 4s then 8s backoff', () => {
    expect(nextChampionInsightPollDelayMs(0)).toBe(2000);
    expect(nextChampionInsightPollDelayMs(1999)).toBe(2000);
    expect(nextChampionInsightPollDelayMs(2000)).toBe(4000);
    expect(nextChampionInsightPollDelayMs(5999)).toBe(4000);
    expect(nextChampionInsightPollDelayMs(6000)).toBe(8000);
    expect(nextChampionInsightPollDelayMs(60_000)).toBe(8000);
  });

  it('continues only while PENDING and under the max window', () => {
    expect(shouldContinueChampionInsightPoll('PENDING', 0)).toBe(true);
    expect(shouldContinueChampionInsightPoll('PENDING', 10_000)).toBe(true);
    expect(shouldContinueChampionInsightPoll('PENDING', CHAMPION_AI_INSIGHT_POLL_MAX_MS - 1)).toBe(
      true,
    );
    expect(shouldContinueChampionInsightPoll('PENDING', CHAMPION_AI_INSIGHT_POLL_MAX_MS)).toBe(
      false,
    );
    expect(shouldContinueChampionInsightPoll('AVAILABLE', 1000)).toBe(false);
    expect(shouldContinueChampionInsightPoll('UNAVAILABLE', 1000)).toBe(false);
  });
});
