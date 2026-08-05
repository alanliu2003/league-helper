import { describe, expect, it } from 'vitest';
import { computeRetryDelayMs, decideRetry, isRetryableHttpStatus } from './riot-retry';

describe('Riot retry policy', () => {
  it('retries only selected 5xx statuses', () => {
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(502)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(504)).toBe(true);
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(403)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(429)).toBe(false);
  });

  it('bounds retry attempts and uses deterministic jitter', () => {
    const decision = decideRetry({
      method: 'GET',
      attempt: 0,
      maxRetries: 2,
      status: 503,
      maxRetryDelayMs: 5_000,
      random: () => 0.5,
    });
    expect(decision.retry).toBe(true);
    expect(decision.delayMs).toBe(
      computeRetryDelayMs(0, { baseDelayMs: 200, maxRetryDelayMs: 5_000, random: () => 0.5 }),
    );

    expect(
      decideRetry({
        method: 'GET',
        attempt: 2,
        maxRetries: 2,
        status: 503,
        maxRetryDelayMs: 5_000,
        random: () => 0,
      }).retry,
    ).toBe(false);
  });

  it('does not retry client errors', () => {
    for (const status of [400, 401, 403, 404, 429]) {
      expect(
        decideRetry({
          method: 'GET',
          attempt: 0,
          maxRetries: 2,
          status,
          maxRetryDelayMs: 1000,
          random: () => 0,
        }).retry,
      ).toBe(false);
    }
  });
});
