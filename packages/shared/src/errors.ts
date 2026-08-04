import { z } from 'zod';

export const DomainErrorCodeSchema = z.enum([
  'INVALID_RIOT_ID',
  'UNSUPPORTED_PLATFORM_ROUTE',
  'INVALID_REGIONAL_ROUTE',
  'VALIDATION_ERROR',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_UNAUTHORIZED',
  'PROVIDER_FORBIDDEN',
  'PROVIDER_RESPONSE_INVALID',
  'RESOURCE_NOT_FOUND',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
]);

export type DomainErrorCode = z.infer<typeof DomainErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: DomainErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  toJSON(): ApiErrorResponse {
    return serializeDomainError(this);
  }
}

export class InvalidRiotIdError extends DomainError {
  constructor(message = 'Riot ID is invalid.', details?: unknown) {
    super('INVALID_RIOT_ID', message, details);
    this.name = 'InvalidRiotIdError';
  }
}

export class UnsupportedPlatformRouteError extends DomainError {
  constructor(message = 'Platform route is not supported.', details?: unknown) {
    super('UNSUPPORTED_PLATFORM_ROUTE', message, details);
    this.name = 'UnsupportedPlatformRouteError';
  }
}

export class InvalidRegionalRouteError extends DomainError {
  constructor(message = 'Regional route is invalid.', details?: unknown) {
    super('INVALID_REGIONAL_ROUTE', message, details);
    this.name = 'InvalidRegionalRouteError';
  }
}

export class ValidationFailureError extends DomainError {
  constructor(message = 'Validation failed.', details?: unknown) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationFailureError';
  }
}

export class ProviderNotConfiguredError extends DomainError {
  constructor(message = 'Game data provider is not configured.', details?: unknown) {
    super('PROVIDER_NOT_CONFIGURED', message, details);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class ProviderUnauthorizedError extends DomainError {
  constructor(message = 'Provider authentication failed.', details?: unknown) {
    super('PROVIDER_UNAUTHORIZED', message, details);
    this.name = 'ProviderUnauthorizedError';
  }
}

export class ProviderForbiddenError extends DomainError {
  constructor(
    message = 'Provider authorization failed. Riot development keys expire regularly; refresh the key in the Riot Developer Portal.',
    details?: unknown,
  ) {
    super('PROVIDER_FORBIDDEN', message, details);
    this.name = 'ProviderForbiddenError';
  }
}

export class ProviderResponseInvalidError extends DomainError {
  constructor(message = 'Provider returned an invalid response.', details?: unknown) {
    super('PROVIDER_RESPONSE_INVALID', message, details);
    this.name = 'ProviderResponseInvalidError';
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(message = 'Resource was not found.', details?: unknown) {
    super('RESOURCE_NOT_FOUND', message, details);
    this.name = 'ResourceNotFoundError';
  }
}

export class ProviderRateLimitedError extends DomainError {
  constructor(message = 'Provider rate limit exceeded. Try again later.', details?: unknown) {
    super('PROVIDER_RATE_LIMITED', message, details);
    this.name = 'ProviderRateLimitedError';
  }
}

export class ProviderUnavailableError extends DomainError {
  constructor(message = 'Provider is temporarily unavailable.', details?: unknown) {
    super('PROVIDER_UNAVAILABLE', message, details);
    this.name = 'ProviderUnavailableError';
  }
}

/** Safe JSON shape for API clients — never includes stack traces or secrets. */
export function serializeDomainError(error: DomainError): ApiErrorResponse {
  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error.details !== undefined) {
    payload.error.details = error.details;
  }

  return ApiErrorResponseSchema.parse(payload);
}
