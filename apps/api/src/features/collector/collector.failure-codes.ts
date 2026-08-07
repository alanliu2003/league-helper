/** Normalized permanent failure codes that may suspend a tracked player. */
export const COLLECTOR_PERMANENT_FAILURE_CODES = [
  'ACCOUNT_NOT_FOUND',
  'UNSUPPORTED_PLATFORM',
  'ACCOUNT_IDENTITY_INVALID',
] as const;

export type CollectorPermanentFailureCode = (typeof COLLECTOR_PERMANENT_FAILURE_CODES)[number];

export const COLLECTOR_RATE_LIMITED_FAILURE_CODE = 'RATE_LIMITED' as const;

export function isPermanentCollectorFailureCode(code: string): code is CollectorPermanentFailureCode {
  return (COLLECTOR_PERMANENT_FAILURE_CODES as readonly string[]).includes(code);
}

export function isRateLimitedCollectorFailureCode(code: string): boolean {
  return code === COLLECTOR_RATE_LIMITED_FAILURE_CODE;
}
