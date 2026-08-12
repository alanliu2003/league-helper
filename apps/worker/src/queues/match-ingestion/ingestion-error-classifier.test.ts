import { describe, expect, it } from 'vitest';
import { RiotRequestBudgetDeferredError } from '@league-helper/server-riot';
import {
  ProviderRateLimitedError,
  ProviderResponseInvalidError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  UnsupportedPlatformRouteError,
  ValidationFailureError,
} from '@league-helper/shared';
import { classifyIngestionError } from './ingestion-error-classifier.js';

describe('classifyIngestionError', () => {
  it('marks 429 as delayed with retryAfterSeconds', () => {
    const result = classifyIngestionError(
      new ProviderRateLimitedError('rate limited', { retryAfterSeconds: 12 }),
    );
    expect(result.kind).toBe('delayed');
    expect(result.retryAfterSeconds).toBe(12);
  });

  it('marks proactive budget deferral as delayed without treating it as 429', () => {
    const result = classifyIngestionError(
      new RiotRequestBudgetDeferredError({
        waitMs: 2500,
        reason: 'short_window',
        workload: 'match',
      }),
    );
    expect(result.kind).toBe('delayed');
    expect(result.code).toBe('RIOT_REQUEST_BUDGET_DEFERRED');
    expect(result.retryAfterSeconds).toBe(3);
  });

  it('marks unavailable and 5xx-like as retryable', () => {
    expect(classifyIngestionError(new ProviderUnavailableError()).kind).toBe('retryable');
    expect(classifyIngestionError(new Error('upstream 503')).kind).toBe('retryable');
  });

  it('marks invalid payload/response/404/unsupported route as permanent', () => {
    expect(classifyIngestionError(new ValidationFailureError('bad')).kind).toBe('permanent');
    expect(classifyIngestionError(new ProviderResponseInvalidError()).kind).toBe('permanent');
    expect(classifyIngestionError(new ResourceNotFoundError()).kind).toBe('permanent');
    expect(classifyIngestionError(new UnsupportedPlatformRouteError('bad')).kind).toBe('permanent');
  });
});
