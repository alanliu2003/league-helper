import type { RiotRateLimitSnapshot, RiotRateLimitWindow } from './riot-api.types';

/**
 * Parse Riot multi-window rate-limit headers such as:
 * `20:1,100:120` → [{ requests: 20, windowSeconds: 1 }, ...]
 * Malformed segments are skipped; fully malformed headers yield null.
 */
export function parseRiotRateLimitHeader(value: string | null): RiotRateLimitWindow[] | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const windows: RiotRateLimitWindow[] = [];
  for (const segment of value.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const [requestsRaw, windowRaw] = trimmed.split(':');
    const requests = Number(requestsRaw);
    const windowSeconds = Number(windowRaw);
    if (
      !Number.isFinite(requests) ||
      !Number.isFinite(windowSeconds) ||
      !Number.isInteger(requests) ||
      !Number.isInteger(windowSeconds) ||
      requests < 0 ||
      windowSeconds < 0
    ) {
      continue;
    }

    windows.push({ requests, windowSeconds });
  }

  return windows.length > 0 ? windows : null;
}

/** Parse Retry-After as integer seconds; ignore HTTP-date forms and invalid values. */
export function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const seconds = Number(trimmed);
  if (!Number.isInteger(seconds) || seconds < 0) {
    return null;
  }

  // Bound absurd Retry-After values so callers can schedule safely.
  return Math.min(seconds, 3600);
}

export function parseRiotRateLimitSnapshot(headers: Headers): RiotRateLimitSnapshot {
  return {
    appRateLimit: parseRiotRateLimitHeader(headers.get('x-app-rate-limit')),
    appRateLimitCount: parseRiotRateLimitHeader(headers.get('x-app-rate-limit-count')),
    methodRateLimit: parseRiotRateLimitHeader(headers.get('x-method-rate-limit')),
    methodRateLimitCount: parseRiotRateLimitHeader(headers.get('x-method-rate-limit-count')),
    rateLimitType: headers.get('x-rate-limit-type'),
    retryAfterSeconds: parseRetryAfterSeconds(headers.get('retry-after')),
  };
}
