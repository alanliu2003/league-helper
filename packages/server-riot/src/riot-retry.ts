import type { RandomFn, SleepFn } from './riot-api.types';

export type RetryDecision = {
  retry: boolean;
  delayMs: number;
  reason: string;
};

export type RetryPolicyOptions = {
  maxRetries: number;
  maxRetryDelayMs: number;
  baseDelayMs?: number;
  random?: RandomFn;
};

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  if (name === 'aborterror' || message.includes('aborted') || message.includes('timeout')) {
    return true;
  }

  if (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('socket')
  ) {
    return true;
  }

  return false;
}

/** Deterministic exponential backoff with injectable jitter. */
export function computeRetryDelayMs(
  attempt: number,
  options: { baseDelayMs: number; maxRetryDelayMs: number; random: RandomFn },
): number {
  const exp = Math.min(options.maxRetryDelayMs, options.baseDelayMs * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(options.random() * Math.min(250, exp));
  return Math.min(options.maxRetryDelayMs, exp + jitter);
}

export function decideRetry(input: {
  method: 'GET';
  attempt: number;
  maxRetries: number;
  status?: number;
  transportError?: unknown;
  baseDelayMs?: number;
  maxRetryDelayMs: number;
  random?: RandomFn;
}): RetryDecision {
  const random = input.random ?? Math.random;
  const baseDelayMs = input.baseDelayMs ?? 200;

  if (input.attempt >= input.maxRetries) {
    return { retry: false, delayMs: 0, reason: 'retry-budget-exhausted' };
  }

  if (input.status !== undefined) {
    if (!isRetryableHttpStatus(input.status)) {
      return { retry: false, delayMs: 0, reason: `non-retryable-status-${input.status}` };
    }

    return {
      retry: true,
      delayMs: computeRetryDelayMs(input.attempt, {
        baseDelayMs,
        maxRetryDelayMs: input.maxRetryDelayMs,
        random,
      }),
      reason: `http-${input.status}`,
    };
  }

  if (input.transportError !== undefined && isRetryableTransportError(input.transportError)) {
    return {
      retry: true,
      delayMs: computeRetryDelayMs(input.attempt, {
        baseDelayMs,
        maxRetryDelayMs: input.maxRetryDelayMs,
        random,
      }),
      reason: 'transport-error',
    };
  }

  return { retry: false, delayMs: 0, reason: 'not-retryable' };
}

export async function sleep(ms: number, sleepFn: SleepFn = defaultSleep): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await sleepFn(ms);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
