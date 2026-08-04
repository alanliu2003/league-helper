import { describe, expect, it } from 'vitest';
import {
  ApiErrorResponseSchema,
  InvalidRiotIdError,
  ProviderRateLimitedError,
  UnsupportedPlatformRouteError,
  serializeDomainError,
} from './errors';

describe('error serialization', () => {
  it('serializes typed errors without stack traces', () => {
    const error = new InvalidRiotIdError('Riot ID is invalid.', { field: 'gameName' });
    const payload = serializeDomainError(error);

    expect(ApiErrorResponseSchema.parse(payload)).toEqual({
      success: false,
      error: {
        code: 'INVALID_RIOT_ID',
        message: 'Riot ID is invalid.',
        details: { field: 'gameName' },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('stack');
  });

  it('keeps machine-readable codes for unsupported routes and rate limits', () => {
    expect(serializeDomainError(new UnsupportedPlatformRouteError()).error.code).toBe(
      'UNSUPPORTED_PLATFORM_ROUTE',
    );
    expect(serializeDomainError(new ProviderRateLimitedError()).error.code).toBe(
      'PROVIDER_RATE_LIMITED',
    );
  });
});
