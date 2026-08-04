import type { RiotEndpointCategory, RiotResponseMetadata } from './riot-api.types';
import { parseRiotRateLimitSnapshot } from './riot-rate-limit';

export function createRiotResponseMetadata(input: {
  headers: Headers;
  correlationId: string;
  httpStatus: number;
  durationMs: number;
  routeLabel: string;
  category: RiotEndpointCategory;
  attempt: number;
}): RiotResponseMetadata {
  return {
    correlationId: input.correlationId,
    riotRequestId:
      input.headers.get('x-riot-edge-trace-id') ??
      input.headers.get('x-request-id') ??
      input.headers.get('cf-ray'),
    httpStatus: input.httpStatus,
    durationMs: input.durationMs,
    routeLabel: input.routeLabel,
    category: input.category,
    rateLimit: parseRiotRateLimitSnapshot(input.headers),
    attempt: input.attempt,
  };
}
