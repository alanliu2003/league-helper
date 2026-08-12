import type { RiotRequestWorkload } from './riot-request-workload';

export type RiotRequestBudgetDeferReason =
  | 'cooldown'
  | 'short_window'
  | 'long_window'
  | 'enrichment_share'
  | 'product_reserve'
  | 'header_pressure'
  | 'redis_error';

/**
 * Thrown when a Riot request must wait longer than the inline budget sleep budget.
 * Callers (BullMQ workers / collector) should delay/retry without publishing a 429 cooldown.
 */
export class RiotRequestBudgetDeferredError extends Error {
  readonly waitMs: number;
  readonly reason: RiotRequestBudgetDeferReason;
  readonly workload: RiotRequestWorkload;

  constructor(input: {
    waitMs: number;
    reason: RiotRequestBudgetDeferReason;
    workload: RiotRequestWorkload;
  }) {
    super(
      `Riot request budget deferred (${input.reason}) for ${input.waitMs}ms [workload=${input.workload}]`,
    );
    this.name = 'RiotRequestBudgetDeferredError';
    this.waitMs = Math.max(0, Math.ceil(input.waitMs));
    this.reason = input.reason;
    this.workload = input.workload;
  }
}

export function isRiotRequestBudgetDeferredError(
  error: unknown,
): error is RiotRequestBudgetDeferredError {
  return error instanceof RiotRequestBudgetDeferredError;
}
