import {
  effectiveWindowLimit,
  loadRiotRequestBudgetConfig,
} from '@league-helper/server-riot';
import { ValidationFailureError } from '@league-helper/shared';

/**
 * Collector-side Riot / enrichment pressure heuristic (M12-v2 Phase 6D.1).
 *
 * This is NOT request admission. {@link RiotRequestBudgetStore} remains the
 * authoritative gate for every Riot HTTP call (utilization, short/long windows,
 * enrichment share, product reserve, shared 429 cooldown).
 *
 * `longWindowMembers` is the current observed Redis ZCARD of reserved/admitted
 * requests in the sliding long window — approximate live pressure, not a future
 * reservation beyond what the coordinator already counted.
 *
 * Soft long-window threshold is derived from the shared budget envelope:
 *   effectiveLong = floor(longLimit * utilization)
 *   softLong = effectiveLong - softLongSafetyMargin
 *
 * Hard long-window is intentionally above the utilization ceiling: it is a
 * queue/pressure heuristic for paced multi-batch refresh loops when the
 * observed window is unusually full (e.g. header-observed limit skew), not a
 * second admission controller.
 */

export type CollectorRiotPressureConfig = {
  /** floor(longLimit * utilization) from shared Riot budget config. */
  effectiveLongBudget: number;
  /** Configured long limit before utilization (default 100). */
  longLimit: number;
  /** Shared budget utilization (default 0.75). */
  utilization: number;
  /**
   * Soft long threshold = effectiveLongBudget - softLongSafetyMargin.
   * Default margin 4 → soft 71 when longLimit=100 and utilization=0.75.
   */
  softLongSafetyMargin: number;
  softLongWindow: number;
  /**
   * Hard long pressure gate. Heuristic only; default 85 sits above the util
   * ceiling (~75) so normal coordinator pacing does not trip hard waits.
   */
  hardLongWindow: number;
  softEnrichPending: number;
  hardEnrichPending: number;
  /**
   * Long-window soft waits require at least this enrichment backlog.
   * Default 1: enrichPending=0 never soft-idles solely on longWin.
   */
  longSoftMinEnrichPending: number;
  softWaitMs: number;
  hardWaitMs: number;
  cooldownWaitMs: number;
};

export type CollectorRiotPressureSnapshot = {
  sharedCooldownActive: boolean;
  /** Observed long-window member count (Redis ZCARD). */
  longWindowMembers: number;
  /** waiting+active+delayed on participant-rank-enrichment. */
  enrichPending: number;
  /**
   * Optional wait hint from budget defer / oldest-member ETA.
   * When present and waiting is required, prefer this over fixed poll sleeps
   * (bounded; never busy-spin).
   */
  budgetSuggestedWaitMs?: number | null;
};

export type CollectorRiotPressureDecision =
  | {
      action: 'proceed';
      reason: 'clear';
      waitMs: 0;
      softLongWindow: number;
      hardLongWindow: number;
    }
  | {
      action: 'wait';
      reason: 'shared_cooldown' | 'hard_pressure' | 'soft_pressure';
      waitMs: number;
      softLongWindow: number;
      hardLongWindow: number;
      detail: {
        longWindowMembers: number;
        enrichPending: number;
        hard: boolean;
        softLongTriggered: boolean;
        softEnrichTriggered: boolean;
      };
    };

const DEFAULT_SOFT_LONG_SAFETY_MARGIN = 4;
const DEFAULT_HARD_LONG_WINDOW = 85;
const DEFAULT_SOFT_ENRICH_PENDING = 40;
const DEFAULT_HARD_ENRICH_PENDING = 120;
const DEFAULT_LONG_SOFT_MIN_ENRICH_PENDING = 1;
const DEFAULT_SOFT_WAIT_MS = 15_000;
const DEFAULT_HARD_WAIT_MS = 25_000;
const DEFAULT_COOLDOWN_WAIT_MS = 20_000;

/** Minimum meaningful wait when a budget-suggested wait is tiny (no busy-spin). */
const MIN_MEANINGFUL_WAIT_MS = 5_000;
/** Cap suggested waits so a single tick cannot sleep for an entire long window. */
const MAX_SUGGESTED_WAIT_MS = 60_000;

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number; name: string },
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ValidationFailureError(`${bounds.name} must be an integer.`, { received: raw });
  }
  if (value < bounds.min || value > bounds.max) {
    throw new ValidationFailureError(
      `${bounds.name} must be an integer between ${bounds.min} and ${bounds.max}.`,
      { received: raw },
    );
  }
  return value;
}

/**
 * Derive soft long-window threshold from shared Riot budget + safety margin.
 * Never returns a value >= hardLongWindow or > effectiveLongBudget.
 */
export function deriveSoftLongWindow(input: {
  longLimit: number;
  utilization: number;
  softLongSafetyMargin: number;
  hardLongWindow: number;
}): number {
  const effective = effectiveWindowLimit(input.longLimit, input.utilization);
  const soft = Math.max(1, effective - input.softLongSafetyMargin);
  // Soft must stay strictly below hard; also never exceed effective budget.
  return Math.min(soft, effective, input.hardLongWindow - 1);
}

export function loadCollectorRiotPressureConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CollectorRiotPressureConfig {
  const budget = loadRiotRequestBudgetConfig(env as NodeJS.ProcessEnv);
  const softLongSafetyMargin = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_SOFT_LONG_SAFETY_MARGIN,
    DEFAULT_SOFT_LONG_SAFETY_MARGIN,
    { min: 0, max: 50, name: 'COLLECTOR_RIOT_PRESSURE_SOFT_LONG_SAFETY_MARGIN' },
  );
  const hardLongWindow = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_HARD_LONG_WINDOW,
    DEFAULT_HARD_LONG_WINDOW,
    { min: 2, max: 100_000, name: 'COLLECTOR_RIOT_PRESSURE_HARD_LONG_WINDOW' },
  );
  const softEnrichPending = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_SOFT_ENRICH_PENDING,
    DEFAULT_SOFT_ENRICH_PENDING,
    { min: 0, max: 10_000, name: 'COLLECTOR_RIOT_PRESSURE_SOFT_ENRICH_PENDING' },
  );
  const hardEnrichPending = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_HARD_ENRICH_PENDING,
    DEFAULT_HARD_ENRICH_PENDING,
    { min: 1, max: 100_000, name: 'COLLECTOR_RIOT_PRESSURE_HARD_ENRICH_PENDING' },
  );
  const longSoftMinEnrichPending = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_LONG_SOFT_MIN_ENRICH_PENDING,
    DEFAULT_LONG_SOFT_MIN_ENRICH_PENDING,
    { min: 0, max: 10_000, name: 'COLLECTOR_RIOT_PRESSURE_LONG_SOFT_MIN_ENRICH_PENDING' },
  );
  const softWaitMs = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_SOFT_WAIT_MS,
    DEFAULT_SOFT_WAIT_MS,
    { min: MIN_MEANINGFUL_WAIT_MS, max: MAX_SUGGESTED_WAIT_MS, name: 'COLLECTOR_RIOT_PRESSURE_SOFT_WAIT_MS' },
  );
  const hardWaitMs = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_HARD_WAIT_MS,
    DEFAULT_HARD_WAIT_MS,
    { min: MIN_MEANINGFUL_WAIT_MS, max: MAX_SUGGESTED_WAIT_MS, name: 'COLLECTOR_RIOT_PRESSURE_HARD_WAIT_MS' },
  );
  const cooldownWaitMs = parseBoundedInt(
    env.COLLECTOR_RIOT_PRESSURE_COOLDOWN_WAIT_MS,
    DEFAULT_COOLDOWN_WAIT_MS,
    {
      min: MIN_MEANINGFUL_WAIT_MS,
      max: MAX_SUGGESTED_WAIT_MS,
      name: 'COLLECTOR_RIOT_PRESSURE_COOLDOWN_WAIT_MS',
    },
  );

  const effectiveLongBudget = effectiveWindowLimit(budget.longLimit, budget.utilization);
  const softLongWindow = deriveSoftLongWindow({
    longLimit: budget.longLimit,
    utilization: budget.utilization,
    softLongSafetyMargin,
    hardLongWindow,
  });

  if (softEnrichPending >= hardEnrichPending) {
    throw new ValidationFailureError(
      'COLLECTOR_RIOT_PRESSURE_SOFT_ENRICH_PENDING must be < COLLECTOR_RIOT_PRESSURE_HARD_ENRICH_PENDING.',
      { softEnrichPending, hardEnrichPending },
    );
  }
  if (softLongWindow >= hardLongWindow) {
    throw new ValidationFailureError(
      'Derived soft long-window threshold must be < COLLECTOR_RIOT_PRESSURE_HARD_LONG_WINDOW.',
      {
        softLongWindow,
        hardLongWindow,
        effectiveLongBudget,
        softLongSafetyMargin,
      },
    );
  }

  return {
    effectiveLongBudget,
    longLimit: budget.longLimit,
    utilization: budget.utilization,
    softLongSafetyMargin,
    softLongWindow,
    hardLongWindow,
    softEnrichPending,
    hardEnrichPending,
    longSoftMinEnrichPending,
    softWaitMs,
    hardWaitMs,
    cooldownWaitMs,
  };
}

function resolveWaitMs(
  fallbackMs: number,
  budgetSuggestedWaitMs: number | null | undefined,
): number {
  if (
    budgetSuggestedWaitMs == null ||
    !Number.isFinite(budgetSuggestedWaitMs) ||
    budgetSuggestedWaitMs <= 0
  ) {
    return fallbackMs;
  }
  // Prefer budget/defer ETA when present; floor against busy-spin; cap runaway sleeps.
  return Math.min(
    MAX_SUGGESTED_WAIT_MS,
    Math.max(MIN_MEANINGFUL_WAIT_MS, Math.ceil(budgetSuggestedWaitMs)),
  );
}

/**
 * Evaluate whether a paced collector batch loop should proceed or wait.
 * Does not admit Riot requests and does not bypass RiotRequestBudgetStore.
 */
export function evaluateCollectorRiotPressure(
  snapshot: CollectorRiotPressureSnapshot,
  config: CollectorRiotPressureConfig,
): CollectorRiotPressureDecision {
  const longWindowMembers = Math.max(0, Math.floor(snapshot.longWindowMembers));
  const enrichPending = Math.max(0, Math.floor(snapshot.enrichPending));
  const softLongWindow = config.softLongWindow;
  const hardLongWindow = config.hardLongWindow;

  if (snapshot.sharedCooldownActive) {
    return {
      action: 'wait',
      reason: 'shared_cooldown',
      waitMs: resolveWaitMs(config.cooldownWaitMs, snapshot.budgetSuggestedWaitMs),
      softLongWindow,
      hardLongWindow,
      detail: {
        longWindowMembers,
        enrichPending,
        hard: true,
        softLongTriggered: false,
        softEnrichTriggered: false,
      },
    };
  }

  const hard =
    enrichPending >= config.hardEnrichPending || longWindowMembers >= hardLongWindow;
  if (hard) {
    return {
      action: 'wait',
      reason: 'hard_pressure',
      waitMs: resolveWaitMs(config.hardWaitMs, snapshot.budgetSuggestedWaitMs),
      softLongWindow,
      hardLongWindow,
      detail: {
        longWindowMembers,
        enrichPending,
        hard: true,
        softLongTriggered: longWindowMembers >= hardLongWindow,
        softEnrichTriggered: enrichPending >= config.hardEnrichPending,
      },
    };
  }

  const softEnrichTriggered = enrichPending > config.softEnrichPending;
  // Enrichment-aware long soft: do not idle solely on longWin when backlog is empty/low.
  const softLongTriggered =
    longWindowMembers > softLongWindow &&
    enrichPending >= config.longSoftMinEnrichPending;

  if (softEnrichTriggered || softLongTriggered) {
    return {
      action: 'wait',
      reason: 'soft_pressure',
      waitMs: resolveWaitMs(config.softWaitMs, snapshot.budgetSuggestedWaitMs),
      softLongWindow,
      hardLongWindow,
      detail: {
        longWindowMembers,
        enrichPending,
        hard: false,
        softLongTriggered,
        softEnrichTriggered,
      },
    };
  }

  return {
    action: 'proceed',
    reason: 'clear',
    waitMs: 0,
    softLongWindow,
    hardLongWindow,
  };
}
