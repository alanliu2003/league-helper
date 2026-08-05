import { HttpStatus } from '@nestjs/common';
import {
  DomainError,
  DomainErrorCode,
  ProviderRateLimitedError,
  ResourceNotFoundError,
  ValidationFailureError,
  type PlayerSafeWarning,
} from '@league-helper/shared';
import type { PlayerAccount } from '@prisma/client';
import type { z, ZodTypeAny } from 'zod';

/** HTTP status codes for domain errors — kept in sync with DomainExceptionFilter. */
export const DOMAIN_HTTP_STATUS: Record<DomainErrorCode, number> = {
  INVALID_RIOT_ID: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_PLATFORM_ROUTE: HttpStatus.BAD_REQUEST,
  INVALID_REGIONAL_ROUTE: HttpStatus.BAD_REQUEST,
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  INVALID_CURSOR: HttpStatus.BAD_REQUEST,
  RESOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  ACCOUNT_IDENTITY_CONFLICT: HttpStatus.CONFLICT,
  REFRESH_IN_PROGRESS: HttpStatus.CONFLICT,
  REFRESH_COOLDOWN: HttpStatus.TOO_MANY_REQUESTS,
  PROVIDER_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PROVIDER_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_UNAUTHORIZED: HttpStatus.FORBIDDEN,
  PROVIDER_FORBIDDEN: HttpStatus.FORBIDDEN,
  PROVIDER_RESPONSE_INVALID: HttpStatus.BAD_GATEWAY,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  QUEUE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  DATABASE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

export function domainErrorHttpStatus(error: DomainError): number {
  return DOMAIN_HTTP_STATUS[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
}

export function parseRequest<T extends ZodTypeAny>(
  schema: T,
  data: unknown,
  label = 'request',
): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationFailureError(`${label} validation failed.`, {
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function requirePlayerAccount(account: PlayerAccount | null): PlayerAccount {
  if (!account) {
    throw new ResourceNotFoundError('Player not found.');
  }
  return account;
}

export function providerFailureToWarning(error: unknown): PlayerSafeWarning {
  if (error instanceof DomainError) {
    if (error instanceof ProviderRateLimitedError) {
      const details = error.details as { retryAfterSeconds?: number } | undefined;
      return {
        code: error.code,
        message: error.message,
        ...(details?.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: details.retryAfterSeconds }
          : {}),
      };
    }
    return { code: error.code, message: error.message };
  }

  return {
    code: 'PROVIDER_UNAVAILABLE',
    message: 'A provider request failed unexpectedly.',
  };
}
