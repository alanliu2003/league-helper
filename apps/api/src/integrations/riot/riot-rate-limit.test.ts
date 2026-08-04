import { describe, expect, it } from 'vitest';
import {
  parseRetryAfterSeconds,
  parseRiotRateLimitHeader,
  parseRiotRateLimitSnapshot,
} from './riot-rate-limit';

describe('Riot rate-limit header parsing', () => {
  it('parses multiple app rate-limit windows', () => {
    expect(parseRiotRateLimitHeader('20:1,100:120')).toEqual([
      { requests: 20, windowSeconds: 1 },
      { requests: 100, windowSeconds: 120 },
    ]);
  });

  it('parses app and method count headers via snapshot', () => {
    const headers = new Headers({
      'x-app-rate-limit': '20:1,100:120',
      'x-app-rate-limit-count': '1:1,10:120',
      'x-method-rate-limit': '500:10',
      'x-method-rate-limit-count': '12:10',
      'x-rate-limit-type': 'method',
      'retry-after': '3',
    });

    expect(parseRiotRateLimitSnapshot(headers)).toEqual({
      appRateLimit: [
        { requests: 20, windowSeconds: 1 },
        { requests: 100, windowSeconds: 120 },
      ],
      appRateLimitCount: [
        { requests: 1, windowSeconds: 1 },
        { requests: 10, windowSeconds: 120 },
      ],
      methodRateLimit: [{ requests: 500, windowSeconds: 10 }],
      methodRateLimitCount: [{ requests: 12, windowSeconds: 10 }],
      rateLimitType: 'method',
      retryAfterSeconds: 3,
    });
  });

  it('does not crash on malformed rate-limit headers', () => {
    expect(parseRiotRateLimitHeader('not-a-header')).toBeNull();
    expect(parseRiotRateLimitHeader('20:1,bad,5:x')).toEqual([{ requests: 20, windowSeconds: 1 }]);
  });

  it('parses integer Retry-After and rejects invalid values', () => {
    expect(parseRetryAfterSeconds('12')).toBe(12);
    expect(parseRetryAfterSeconds('Wed, 21 Oct 2015 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfterSeconds('-1')).toBeNull();
    expect(parseRetryAfterSeconds('abc')).toBeNull();
    expect(parseRetryAfterSeconds(null)).toBeNull();
  });
});
