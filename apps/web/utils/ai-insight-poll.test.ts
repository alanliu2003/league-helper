import { describe, expect, it } from 'vitest';
import {
  AI_INSIGHT_POLL_MAX_MS,
  nextAiInsightPollDelayMs,
  shouldContinueAiInsightPoll,
} from './ai-insight-poll';

describe('generic AI insight pending poll', () => {
  it('uses 2s then 4s then 8s backoff', () => {
    expect(nextAiInsightPollDelayMs(0)).toBe(2000);
    expect(nextAiInsightPollDelayMs(1999)).toBe(2000);
    expect(nextAiInsightPollDelayMs(2000)).toBe(4000);
    expect(nextAiInsightPollDelayMs(5999)).toBe(4000);
    expect(nextAiInsightPollDelayMs(6000)).toBe(8000);
    expect(nextAiInsightPollDelayMs(60_000)).toBe(8000);
  });

  it('continues only while PENDING and under the max window', () => {
    expect(shouldContinueAiInsightPoll('PENDING', 0)).toBe(true);
    expect(shouldContinueAiInsightPoll('PENDING', 10_000)).toBe(true);
    expect(shouldContinueAiInsightPoll('PENDING', AI_INSIGHT_POLL_MAX_MS - 1)).toBe(true);
    expect(shouldContinueAiInsightPoll('PENDING', AI_INSIGHT_POLL_MAX_MS)).toBe(false);
    expect(shouldContinueAiInsightPoll('AVAILABLE', 1000)).toBe(false);
    expect(shouldContinueAiInsightPoll('UNAVAILABLE', 1000)).toBe(false);
    expect(shouldContinueAiInsightPoll('DISABLED', 1000)).toBe(false);
  });
});
