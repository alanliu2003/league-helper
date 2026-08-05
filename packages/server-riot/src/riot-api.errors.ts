import {
  ProviderForbiddenError,
  ProviderRateLimitedError,
  ProviderResponseInvalidError,
  ProviderUnauthorizedError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  ValidationFailureError,
} from '@league-helper/shared';
import type { RiotEndpointCategory, RiotRateLimitSnapshot } from './riot-api.types';

const SENSITIVE_HEADER_NAMES = new Set([
  'x-riot-token',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

export function redactSensitiveText(value: string, secrets: readonly string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join('[REDACTED]');
    }
  }

  for (const header of SENSITIVE_HEADER_NAMES) {
    const pattern = new RegExp(`(${header}\\s*[:=]\\s*)([^\\s,;]+)`, 'gi');
    redacted = redacted.replace(pattern, '$1[REDACTED]');
  }

  return redacted;
}

export function assertNoSecretLeak(message: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (secret.length > 0 && message.includes(secret)) {
      throw new Error('Refusing to throw an error message that contains a secret value.');
    }
  }
}

export function mapHttpStatusToProviderError(input: {
  status: number;
  resourceHint?: string;
  routeLabel: string;
  category: RiotEndpointCategory;
  rateLimit: RiotRateLimitSnapshot;
  secrets?: readonly string[];
}): Error {
  const secrets = input.secrets ?? [];

  switch (input.status) {
    case 400: {
      const error = new ValidationFailureError('Riot rejected the request as invalid.', {
        status: 400,
        category: input.category,
        route: input.routeLabel,
      });
      assertNoSecretLeak(error.message, secrets);
      return error;
    }
    case 401: {
      const error = new ProviderUnauthorizedError(
        'Riot authentication failed. Check that RIOT_API_KEY is set correctly.',
        { status: 401, category: input.category, route: input.routeLabel },
      );
      assertNoSecretLeak(error.message, secrets);
      return error;
    }
    case 403: {
      const error = new ProviderForbiddenError(
        'Riot authorization failed. Development API keys expire regularly; refresh the key in the Riot Developer Portal and update RIOT_API_KEY.',
        { status: 403, category: input.category, route: input.routeLabel },
      );
      assertNoSecretLeak(error.message, secrets);
      return error;
    }
    case 404: {
      const error = new ResourceNotFoundError(notFoundMessage(input.resourceHint), {
        status: 404,
        category: input.category,
        route: input.routeLabel,
        resource: input.resourceHint ?? 'unknown',
      });
      assertNoSecretLeak(error.message, secrets);
      return error;
    }
    case 429: {
      const error = new ProviderRateLimitedError('Riot rate limit exceeded.', {
        status: 429,
        retryAfterSeconds: input.rateLimit.retryAfterSeconds,
        rateLimitType: input.rateLimit.rateLimitType,
        route: input.routeLabel,
        endpointCategory: input.category,
      });
      assertNoSecretLeak(error.message, secrets);
      return error;
    }
    default: {
      if (input.status >= 500) {
        const error = new ProviderUnavailableError('Riot API is temporarily unavailable.', {
          status: input.status,
          category: input.category,
          route: input.routeLabel,
          reason: 'http-5xx',
        });
        assertNoSecretLeak(error.message, secrets);
        return error;
      }

      const error = new ProviderUnavailableError('Riot API returned an unexpected status.', {
        status: input.status,
        category: input.category,
        route: input.routeLabel,
        reason: 'unexpected-status',
      });
      assertNoSecretLeak(error.message, secrets);
      return error;
    }
  }
}

export function mapTransportErrorToProviderError(
  error: unknown,
  context: { category: RiotEndpointCategory; routeLabel: string; secrets?: readonly string[] },
): ProviderUnavailableError {
  const secrets = context.secrets ?? [];
  const reason = classifyTransportFailure(error);
  const mapped = new ProviderUnavailableError('Riot API is temporarily unavailable.', {
    category: context.category,
    route: context.routeLabel,
    reason,
  });
  assertNoSecretLeak(mapped.message, secrets);
  return mapped;
}

export function createResponseValidationError(
  issues: unknown,
  context: { category: RiotEndpointCategory; routeLabel: string },
): ProviderResponseInvalidError {
  return new ProviderResponseInvalidError('Riot returned a response that failed validation.', {
    category: context.category,
    route: context.routeLabel,
    issues,
  });
}

function notFoundMessage(resourceHint?: string): string {
  switch (resourceHint) {
    case 'account':
      return 'Riot account not found.';
    case 'summoner':
      return 'Summoner profile not found.';
    case 'match':
      return 'Match not found.';
    case 'timeline':
      return 'Match timeline not found.';
    case 'mastery':
      return 'Champion mastery not found.';
    case 'ranked':
      return 'Ranked entries not found.';
    case 'match-ids':
      return 'Match IDs not found.';
    default:
      return 'Requested Riot resource was not found.';
  }
}

function classifyTransportFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'transport-failure';
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  if (name === 'aborterror' || message.includes('aborted') || message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('enotfound') || message.includes('dns')) {
    return 'dns-failure';
  }
  if (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket')
  ) {
    return 'connection-failure';
  }
  return 'transport-failure';
}
