import type { ProviderRateLimitedError } from '@league-helper/shared';

/** Convert ProviderRateLimitedError.details.retryAfterSeconds → ms (or null). */
export function retryAfterMsFromProviderRateLimited(
  error: ProviderRateLimitedError,
): number | null {
  const details = error.details;
  if (
    details === null ||
    typeof details !== 'object' ||
    !('retryAfterSeconds' in details)
  ) {
    return null;
  }
  const seconds = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.round(seconds * 1_000);
}
