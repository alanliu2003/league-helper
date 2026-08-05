import {
  DatabaseUnavailableError,
  DomainError,
  ProviderRateLimitedError,
  ProviderResponseInvalidError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  UnsupportedPlatformRouteError,
  ValidationFailureError,
} from '@league-helper/shared';
import { Prisma } from '@prisma/client';

export type IngestionErrorKind = 'retryable' | 'delayed' | 'permanent';

export type ClassifiedIngestionError = {
  kind: IngestionErrorKind;
  code: string;
  message: string;
  retryAfterSeconds?: number;
};

const MAX_SAFE_ERROR_MESSAGE = 240;

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, MAX_SAFE_ERROR_MESSAGE);
  }
  return 'Unknown ingestion error';
}

function readRetryAfterSeconds(details: unknown): number | undefined {
  if (!details || typeof details !== 'object') {
    return undefined;
  }
  const record = details as Record<string, unknown>;
  const value = record.retryAfterSeconds ?? record.retryAfter;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.ceil(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.ceil(parsed);
    }
  }
  return undefined;
}

function isPrismaTransient(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P1001 connection, P1002 timeout, P1017 server closed, P2034 write conflict / deadlock
    return ['P1001', 'P1002', 'P1017', 'P2034'].includes(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return true;
  }
  return false;
}

/**
 * Classify errors for BullMQ retry / delay / permanent-fail policy.
 * Never includes PUUIDs, payloads, or connection strings in the result.
 */
export function classifyIngestionError(error: unknown): ClassifiedIngestionError {
  if (error instanceof ProviderRateLimitedError) {
    return {
      kind: 'delayed',
      code: error.code,
      message: safeMessage(error),
      retryAfterSeconds: readRetryAfterSeconds(error.details) ?? 2,
    };
  }

  if (
    error instanceof ProviderUnavailableError ||
    error instanceof DatabaseUnavailableError ||
    isPrismaTransient(error)
  ) {
    return {
      kind: 'retryable',
      code: error instanceof DomainError ? error.code : 'DATABASE_UNAVAILABLE',
      message: safeMessage(error),
    };
  }

  if (
    error instanceof ValidationFailureError ||
    error instanceof ProviderResponseInvalidError ||
    error instanceof ResourceNotFoundError ||
    error instanceof UnsupportedPlatformRouteError
  ) {
    return {
      kind: 'permanent',
      code: error.code,
      message: safeMessage(error),
    };
  }

  if (error instanceof DomainError) {
    // Auth/config issues should not spin forever on the same job.
    if (
      error.code === 'PROVIDER_UNAUTHORIZED' ||
      error.code === 'PROVIDER_FORBIDDEN' ||
      error.code === 'PROVIDER_NOT_CONFIGURED'
    ) {
      return { kind: 'permanent', code: error.code, message: safeMessage(error) };
    }
    if (error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'QUEUE_UNAVAILABLE') {
      return { kind: 'retryable', code: error.code, message: safeMessage(error) };
    }
  }

  // HTTP 5xx-style messages from unexpected errors → retryable; otherwise permanent.
  const message = safeMessage(error);
  if (/\b5\d\d\b/.test(message) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return { kind: 'retryable', code: 'PROVIDER_UNAVAILABLE', message };
  }

  return {
    kind: 'permanent',
    code: error instanceof DomainError ? error.code : 'VALIDATION_ERROR',
    message,
  };
}
