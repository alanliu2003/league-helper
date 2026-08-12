import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { RiotSharedCooldownStore } from '@league-helper/server-riot';
import type { CollectorRun, PlayerAccount, TrackedPlayer } from '@prisma/client';
import { CollectorRunStatus } from '@prisma/client';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { PlayerMatchDiscoveryService } from '../players/discovery/player-match-discovery.service';
import type { PlayerMatchDiscoveryResult } from '../players/discovery/player-match-discovery.types';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { CollectorEligibilityService, computeEffectivePlatforms } from './collector-eligibility.service';
import { COLLECTOR_CONFIG } from './collector-enrollment.service';
import { RIOT_SHARED_COOLDOWN_STORE } from './collector.tokens';
import { isRateLimitedCollectorFailureCode } from './collector.failure-codes';
import { computeSuccessfulRefreshSchedule } from './collector-refresh-policy';
import { CollectorRunRepository } from './collector-run.repository';
import {
  COLLECTOR_PROVIDER,
  type CollectorPreviewInput,
  type CollectorPreviewResult,
  type CollectorRunCounters,
  type CollectorRunOnceInput,
  type CollectorRunOnceResult,
} from './collector.types';
import { TrackedPlayerRepository } from './tracked-player.repository';

export class CollectorRunError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CollectorRunError';
    this.code = code;
  }
}

type RuntimeConfig = Pick<
  CollectorConfig,
  | 'minRefreshIntervalMs'
  | 'hotRefreshIntervalMs'
  | 'warmRefreshIntervalMs'
  | 'coldRefreshIntervalMs'
  | 'coldAfterZeroNewRuns'
  | 'hotPriority'
  | 'warmPriority'
  | 'coldPriority'
  | 'maxConsecutiveZeroNewMatchRuns'
  | 'priorityMin'
  | 'priorityMax'
  | 'baseBackoffMs'
  | 'maxBackoffMs'
  | 'maxBackoffExponent'
  | 'playerTimeoutMs'
  | 'leaseDurationMs'
  | 'platformAllowlist'
>;

type PlayerOutcome =
  | { kind: 'success'; discovered: number; enqueued: number; skipped: number }
  | {
      kind: 'failure';
      discovered: number;
      enqueued: number;
      skipped: number;
      rateLimited: boolean;
      /** Proactive budget deferral — wave drain without shared 429 cooldown. */
      budgetDeferred?: boolean;
    }
  | { kind: 'ownership_lost' }
  /**
   * Claimed with no useful budget: lease released without success cadence.
   * Counts as playersFailed + budgetExhausted (see releaseZeroBudgetClaim).
   */
  | { kind: 'budget_skip' }
  /**
   * Claimed but not started due to shared Riot cooldown / rate-limit drain.
   * Lease released without finalizeFailure. Does NOT count as attempted/failed.
   */
  | { kind: 'cooldown_skip' };

type WaveAssignment = {
  player: TrackedPlayer;
  maxMatches: number;
};

const PLAYER_ACCOUNT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function zeroCounters(): CollectorRunCounters {
  return {
    playersClaimed: 0,
    playersAttempted: 0,
    playersSucceeded: 0,
    playersFailed: 0,
    ownershipLost: 0,
    matchIdsDiscovered: 0,
    matchesEnqueued: 0,
    matchesSkippedComplete: 0,
    rateLimitStops: 0,
    budgetExhausted: false,
    failureCode: null,
  };
}

function assertCounterEquality(counters: CollectorRunCounters): void {
  const sum =
    counters.playersSucceeded + counters.playersFailed + counters.ownershipLost;
  if (sum !== counters.playersAttempted) {
    throw new CollectorRunError(
      'COUNTER_INVARIANT_VIOLATION',
      `Counter equality failed: succeeded(${counters.playersSucceeded}) + failed(${counters.playersFailed}) + ownershipLost(${counters.ownershipLost}) !== attempted(${counters.playersAttempted})`,
    );
  }
  if (counters.playersAttempted > counters.playersClaimed) {
    throw new CollectorRunError(
      'COUNTER_INVARIANT_VIOLATION',
      `playersAttempted (${counters.playersAttempted}) > playersClaimed (${counters.playersClaimed})`,
    );
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

function isPlayerAccountIdUuid(value: string): boolean {
  return PLAYER_ACCOUNT_ID_UUID_RE.test(value.trim());
}

/**
 * Pre-allocate per-player maxMatches so parallel work cannot overshoot run budgets.
 * Gives each claimed player at least 1 when total useful budget >= claimed.length
 * (caller should cap claim size by useful budget), then tops up to matchesPerPlayer.
 */
export function preallocateWaveBudgets(input: {
  claimed: TrackedPlayer[];
  matchesPerPlayer: number;
  remainingMatchBudget: number;
  remainingEnqueueBudget: number;
}): WaveAssignment[] {
  let matchBudget = input.remainingMatchBudget;
  let enqueueBudget = input.remainingEnqueueBudget;
  const assignments: WaveAssignment[] = input.claimed.map((player) => {
    const useful = Math.min(matchBudget, enqueueBudget);
    if (useful < 1) {
      return { player, maxMatches: 0 };
    }
    matchBudget -= 1;
    enqueueBudget -= 1;
    return { player, maxMatches: 1 };
  });

  for (const assignment of assignments) {
    if (assignment.maxMatches === 0) {
      continue;
    }
    const extra = Math.min(
      input.matchesPerPlayer - assignment.maxMatches,
      matchBudget,
      enqueueBudget,
    );
    if (extra > 0) {
      assignment.maxMatches += extra;
      matchBudget -= extra;
      enqueueBudget -= extra;
    }
  }

  return assignments;
}

@Injectable()
export class PopulationCollectorService {
  private readonly logger = new Logger(PopulationCollectorService.name);
  private readonly baseConfig: CollectorConfig;

  constructor(
    @Inject(TrackedPlayerRepository) private readonly trackedPlayers: TrackedPlayerRepository,
    @Inject(CollectorRunRepository) private readonly runs: CollectorRunRepository,
    @Inject(PlayerMatchDiscoveryService)
    private readonly discovery: PlayerMatchDiscoveryService,
    @Inject(CollectorEligibilityService)
    private readonly eligibility: CollectorEligibilityService,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
    @Optional()
    @Inject(RIOT_SHARED_COOLDOWN_STORE)
    private readonly sharedCooldown?: RiotSharedCooldownStore | null,
  ) {
    this.baseConfig = config ?? loadCollectorConfig(process.env);
  }

  /** Test factory — bypasses Nest DI. */
  static create(deps: {
    trackedPlayers: TrackedPlayerRepository;
    runs: CollectorRunRepository;
    discovery: Pick<PlayerMatchDiscoveryService, 'discoverAndEnqueue'>;
    eligibility: Pick<CollectorEligibilityService, 'preview'>;
    playerAccounts: Pick<PlayerAccountRepository, 'findById'>;
    config: CollectorConfig;
    sharedCooldown?: RiotSharedCooldownStore | null;
  }): PopulationCollectorService {
    return new PopulationCollectorService(
      deps.trackedPlayers,
      deps.runs,
      deps.discovery as PlayerMatchDiscoveryService,
      deps.eligibility as CollectorEligibilityService,
      deps.playerAccounts as PlayerAccountRepository,
      deps.config,
      deps.sharedCooldown,
    );
  }

  preview(input: CollectorPreviewInput): Promise<CollectorPreviewResult> {
    return this.eligibility.preview(input);
  }

  async runOnce(input: CollectorRunOnceInput): Promise<CollectorRunOnceResult> {
    const startedAt = Date.now();
    const runtime = this.resolveRuntimeConfig(input);
    const effectivePlatforms = computeEffectivePlatforms(
      runtime.platformAllowlist,
      input.platformFilter,
    );

    if (effectivePlatforms.length === 0) {
      throw new CollectorRunError(
        'NO_EFFECTIVE_PLATFORMS',
        'No effective platforms after intersecting allowlist with platform filter.',
      );
    }

    const ownerToken = randomUUID();
    let run: CollectorRun;
    try {
      run = await this.runs.createRunning({
        ownerToken,
        platformFilter: input.platformFilter ?? null,
        effectivePlatforms,
        queueId: input.queueId,
        batchLimit: input.batchLimit,
        concurrency: input.concurrency,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create CollectorRun';
      throw new CollectorRunError('SETUP_FAILED', message);
    }

    const counters = zeroCounters();
    let stopClaims = false;
    let anyAttempted = false;
    let unexpectedFailureCode: string | null = null;

    try {
      while (!stopClaims) {
        const remainingBatch = input.batchLimit - counters.playersClaimed;
        if (remainingBatch <= 0) {
          break;
        }

        const remainingMatchBudget = input.maxMatchIdsPerRun - counters.matchIdsDiscovered;
        const remainingEnqueueBudget = input.maxEnqueuePerRun - counters.matchesEnqueued;
        const usefulBudget = Math.min(remainingMatchBudget, remainingEnqueueBudget);

        if (usefulBudget <= 0) {
          const stillEligible = await this.trackedPlayers.countEligible({
            platformRoutes: effectivePlatforms,
            provider: COLLECTOR_PROVIDER,
          });
          if (stillEligible > 0) {
            counters.budgetExhausted = true;
          }
          break;
        }

        // Each claimed player needs at least 1 match-id and 1 enqueue unit of useful budget.
        const waveLimit = Math.min(
          input.concurrency,
          remainingBatch,
          remainingMatchBudget,
          remainingEnqueueBudget,
        );
        if (waveLimit <= 0) {
          break;
        }

        // Shared cooldown preflight: do not claim; do not set rateLimitStops.
        if (this.sharedCooldown && (await this.sharedCooldown.isCoolingDown(Date.now()))) {
          break;
        }

        const claimed = await this.trackedPlayers.claimEligibleWave({
          platformRoutes: effectivePlatforms,
          provider: COLLECTOR_PROVIDER,
          limit: waveLimit,
          ownerToken,
          leaseDurationMs: runtime.leaseDurationMs,
        });

        if (claimed.length === 0) {
          break;
        }

        counters.playersClaimed += claimed.length;

        const assignments = preallocateWaveBudgets({
          claimed,
          matchesPerPlayer: input.matchesPerPlayer,
          remainingMatchBudget,
          remainingEnqueueBudget,
        });

        const { outcomes, rateLimited, budgetDeferred } = await this.processWaveParallel({
          assignments,
          ownerToken,
          collectorRunId: run.id,
          input,
          runtime,
          effectivePlatforms,
          workerCount: Math.min(input.concurrency, assignments.length),
        });

        for (const outcome of outcomes) {
          // cooldown_skip: claimed but not attempted (lease released cleanly).
          if (outcome.kind === 'cooldown_skip') {
            continue;
          }

          anyAttempted = true;
          counters.playersAttempted += 1;

          if (outcome.kind === 'success') {
            counters.playersSucceeded += 1;
            counters.matchIdsDiscovered += outcome.discovered;
            counters.matchesEnqueued += outcome.enqueued;
            counters.matchesSkippedComplete += outcome.skipped;
          } else if (outcome.kind === 'ownership_lost') {
            counters.ownershipLost += 1;
          } else if (outcome.kind === 'budget_skip') {
            // Non-success release: attempted but no refresh; see releaseZeroBudgetClaim.
            counters.playersFailed += 1;
            counters.budgetExhausted = true;
            stopClaims = true;
          } else {
            counters.playersFailed += 1;
            counters.matchIdsDiscovered += outcome.discovered;
            counters.matchesEnqueued += outcome.enqueued;
            counters.matchesSkippedComplete += outcome.skipped;
          }
        }

        if (rateLimited) {
          counters.rateLimitStops += 1;
          stopClaims = true;
        }
        if (budgetDeferred) {
          // Proactive pacing backpressure — stop further claims without 429 cooldown.
          stopClaims = true;
        }
      }

      await this.ensureNoUnreleasedLeases(ownerToken);

      assertCounterEquality(counters);

      const status = this.resolveTerminalStatus({
        counters,
        anyAttempted,
      });

      const finalized = await this.finalizeRun({
        runId: run.id,
        ownerToken,
        status,
        counters,
      });

      return {
        runId: finalized.id,
        ownerToken,
        status: finalized.status as Exclude<CollectorRunStatus, 'RUNNING'>,
        effectivePlatforms,
        queueId: input.queueId,
        batchLimit: input.batchLimit,
        concurrency: input.concurrency,
        counters,
        durationMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      unexpectedFailureCode =
        error instanceof CollectorRunError ? error.code : 'INTERNAL_TRANSIENT';
      const message = error instanceof Error ? error.message : 'Collector run failed';
      this.logger.warn({
        message: 'Collector runOnce unexpected error',
        runId: run.id,
        code: unexpectedFailureCode,
        error: message,
      });

      try {
        await this.trackedPlayers.forceReleaseOwnedLeases(ownerToken);
      } catch {
        // best-effort
      }

      const skipFinalize =
        error instanceof CollectorRunError && error.code === 'FINALIZATION_CONFLICT';
      const terminalStatus =
        counters.playersClaimed > 0 || anyAttempted
          ? CollectorRunStatus.PARTIAL
          : CollectorRunStatus.FAILED;

      counters.failureCode = unexpectedFailureCode;
      try {
        assertCounterEquality(counters);
      } catch {
        // leave counters as-is for best-effort finalize
      }

      if (!skipFinalize) {
        await this.runs.finalizeIfRunning({
          id: run.id,
          ownerToken,
          status: terminalStatus,
          counters: {
            ...counters,
            failureCode: unexpectedFailureCode,
          },
        });
      }

      throw error instanceof CollectorRunError
        ? error
        : new CollectorRunError(unexpectedFailureCode, message);
    }
  }

  private resolveRuntimeConfig(input: CollectorRunOnceInput): RuntimeConfig {
    const c = this.baseConfig;
    const o = input.config ?? {};
    const warmRefreshIntervalMs = o.minRefreshIntervalMs ?? c.warmRefreshIntervalMs;
    // Fail-fast: runtime warm override must preserve HOT < WARM < COLD (same as loadCollectorConfig).
    if (
      !(
        c.hotRefreshIntervalMs < warmRefreshIntervalMs &&
        warmRefreshIntervalMs < c.coldRefreshIntervalMs
      )
    ) {
      throw new CollectorRunError(
        'INVALID_REFRESH_INTERVALS',
        'Runtime warm refresh interval must satisfy HOT < WARM < COLD.',
      );
    }
    return {
      minRefreshIntervalMs: warmRefreshIntervalMs,
      hotRefreshIntervalMs: c.hotRefreshIntervalMs,
      warmRefreshIntervalMs,
      coldRefreshIntervalMs: c.coldRefreshIntervalMs,
      coldAfterZeroNewRuns: c.coldAfterZeroNewRuns,
      hotPriority: c.hotPriority,
      warmPriority: c.warmPriority,
      coldPriority: c.coldPriority,
      maxConsecutiveZeroNewMatchRuns: c.maxConsecutiveZeroNewMatchRuns,
      priorityMin: c.priorityMin,
      priorityMax: c.priorityMax,
      baseBackoffMs: o.baseBackoffMs ?? c.baseBackoffMs,
      maxBackoffMs: o.maxBackoffMs ?? c.maxBackoffMs,
      maxBackoffExponent: o.maxBackoffExponent ?? c.maxBackoffExponent,
      playerTimeoutMs: o.playerTimeoutMs ?? c.playerTimeoutMs,
      leaseDurationMs: o.leaseDurationMs ?? c.leaseDurationMs,
      platformAllowlist: o.platformAllowlist ?? c.platformAllowlist,
    };
  }

  /**
   * Process a claimed wave with true parallel concurrency (worker pool).
   * Rate-limit stops further starts; already in-flight work drains normally.
   */
  private async processWaveParallel(input: {
    assignments: WaveAssignment[];
    ownerToken: string;
    collectorRunId: string;
    input: CollectorRunOnceInput;
    runtime: RuntimeConfig;
    effectivePlatforms: string[];
    workerCount: number;
  }): Promise<{
    outcomes: PlayerOutcome[];
    rateLimited: boolean;
    budgetDeferred: boolean;
  }> {
    const outcomes = new Array<PlayerOutcome>(input.assignments.length);
    let nextIndex = 0;
    let rateLimited = false;
    let budgetDeferred = false;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= input.assignments.length) {
          return;
        }

        const assignment = input.assignments[index]!;

        // Defense-in-depth: never finalizeSuccess without discovery (starves via cadence).
        if (assignment.maxMatches <= 0) {
          outcomes[index] = await this.releaseZeroBudgetClaim({
            player: assignment.player,
            ownerToken: input.ownerToken,
          });
          continue;
        }

        // Rate-limit / shared-cooldown drain: release lease without finalizeFailure.
        const sharedCooling =
          this.sharedCooldown != null &&
          (await this.sharedCooldown.isCoolingDown(Date.now()));
        if (rateLimited || budgetDeferred || sharedCooling) {
          outcomes[index] = await this.releaseCooldownSkipClaim({
            player: assignment.player,
            ownerToken: input.ownerToken,
          });
          continue;
        }

        const outcome = await this.processClaimedPlayer({
          player: assignment.player,
          maxMatches: assignment.maxMatches,
          ownerToken: input.ownerToken,
          collectorRunId: input.collectorRunId,
          input: input.input,
          runtime: input.runtime,
          effectivePlatforms: input.effectivePlatforms,
        });

        if (outcome.kind === 'failure' && outcome.rateLimited) {
          rateLimited = true;
        }
        if (outcome.kind === 'failure' && outcome.budgetDeferred) {
          budgetDeferred = true;
        }
        outcomes[index] = outcome;
      }
    };

    const workers = Array.from(
      { length: Math.max(1, input.workerCount) },
      () => worker(),
    );
    await Promise.all(workers);

    return { outcomes, rateLimited, budgetDeferred };
  }

  private async processClaimedPlayer(input: {
    player: TrackedPlayer;
    maxMatches: number;
    ownerToken: string;
    collectorRunId: string;
    input: CollectorRunOnceInput;
    runtime: RuntimeConfig;
    effectivePlatforms: string[];
  }): Promise<PlayerOutcome> {
    const validationFailure = await this.validateTrackedAccount(
      input.player,
      input.effectivePlatforms,
    );
    if (validationFailure) {
      return this.finalizeTransientOrPermanentFailure({
        player: input.player,
        ownerToken: input.ownerToken,
        runtime: input.runtime,
        failureCode: validationFailure,
      });
    }

    let discovery: PlayerMatchDiscoveryResult;
    try {
      discovery = await withTimeout(
        this.discovery.discoverAndEnqueue({
          mode: 'PLAYER_ACCOUNT',
          playerAccountId: input.player.playerAccountId,
          queueId: input.input.queueId,
          maxMatches: input.maxMatches,
          dryRun: false,
          correlationId: `collector-${input.ownerToken}-${input.player.id}`,
          sourceCollectorRunId: input.collectorRunId,
        }),
        input.runtime.playerTimeoutMs,
        `trackedPlayer:${input.player.id}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Player processing failed';
      const failureCode = message.includes('timed out')
        ? 'PLAYER_TIMEOUT'
        : 'INTERNAL_TRANSIENT';
      return this.finalizeTransientFailure({
        player: input.player,
        ownerToken: input.ownerToken,
        runtime: input.runtime,
        failureCode,
        rateLimited: false,
      });
    }

    if (discovery.ok) {
      // Activity signal = newly published enqueue work from THIS refresh, not discovered count.
      const schedule = computeSuccessfulRefreshSchedule({
        enqueuedNewCount: discovery.enqueuedCount,
        consecutiveZeroNewMatchRuns: input.player.consecutiveZeroNewMatchRuns,
        nowMs: Date.now(),
        config: {
          hotRefreshIntervalMs: input.runtime.hotRefreshIntervalMs,
          warmRefreshIntervalMs: input.runtime.warmRefreshIntervalMs,
          coldRefreshIntervalMs: input.runtime.coldRefreshIntervalMs,
          coldAfterZeroNewRuns: input.runtime.coldAfterZeroNewRuns,
          hotPriority: input.runtime.hotPriority,
          warmPriority: input.runtime.warmPriority,
          coldPriority: input.runtime.coldPriority,
          priorityMin: input.runtime.priorityMin,
          priorityMax: input.runtime.priorityMax,
          maxConsecutiveZeroNewMatchRuns: input.runtime.maxConsecutiveZeroNewMatchRuns,
        },
      });
      const finalized = await this.trackedPlayers.finalizeSuccess({
        trackedPlayerId: input.player.id,
        ownerToken: input.ownerToken,
        nextEligibleDelayMs: schedule.nextEligibleDelayMs,
        priority: schedule.priority,
        consecutiveZeroNewMatchRuns: schedule.consecutiveZeroNewMatchRuns,
      });
      if (!finalized.updated) {
        return { kind: 'ownership_lost' };
      }
      return {
        kind: 'success',
        discovered: discovery.discoveredMatchCount,
        enqueued: discovery.enqueuedCount,
        skipped: discovery.skippedAlreadyCompleteCount,
      };
    }

    const failureCode = discovery.normalizedFailureCode ?? 'DISCOVERY_FAILED';
    const rateLimited =
      discovery.rateLimited === true || isRateLimitedCollectorFailureCode(failureCode);
    const budgetDeferred =
      discovery.budgetDeferred === true || failureCode === 'RIOT_REQUEST_BUDGET_DEFERRED';

    // Emergency shared cooldown only for true Riot 429s — never for proactive budget waits.
    if (rateLimited && !budgetDeferred && this.sharedCooldown) {
      await this.sharedCooldown.extendCooldown({
        now: Date.now(),
        configuredFloorMs: this.baseConfig.riotShared429CooldownMinMs,
        retryAfterMs: discovery.retryAfterMs ?? null,
        source: 'collector',
      });
    }

    const finalized = await this.trackedPlayers.finalizeFailure({
      trackedPlayerId: input.player.id,
      ownerToken: input.ownerToken,
      failureCode,
      baseBackoffMs: input.runtime.baseBackoffMs,
      maxBackoffMs: input.runtime.maxBackoffMs,
      maxBackoffExponent: input.runtime.maxBackoffExponent,
      retryAfterMs: discovery.retryAfterMs,
    });

    if (!finalized.updated) {
      return { kind: 'ownership_lost' };
    }

    return {
      kind: 'failure',
      discovered: discovery.discoveredMatchCount,
      enqueued: discovery.enqueuedCount,
      skipped: discovery.skippedAlreadyCompleteCount,
      rateLimited,
      budgetDeferred,
    };
  }

  /**
   * Load canonical PlayerAccount and validate denormalized TrackedPlayer fields
   * before any mutating discovery/enqueue call.
   */
  private async validateTrackedAccount(
    player: TrackedPlayer,
    effectivePlatforms: string[],
  ): Promise<string | null> {
    if (!isPlayerAccountIdUuid(player.playerAccountId)) {
      return 'ACCOUNT_REFERENCE_INVALID';
    }

    const account: PlayerAccount | null = await this.playerAccounts.findById(
      player.playerAccountId,
    );
    if (!account) {
      return 'TRACKED_ACCOUNT_MISSING';
    }

    if (
      account.provider !== player.provider ||
      account.platformRoute !== player.platformRoute
    ) {
      return 'ACCOUNT_IDENTITY_INVALID';
    }

    if (!effectivePlatforms.includes(player.platformRoute)) {
      return 'UNSUPPORTED_PLATFORM';
    }

    return null;
  }

  /**
   * Defense-in-depth when a claimed player still has maxMatches===0.
   *
   * Counter semantics:
   * - Owner-protected lease clear only (no lastSuccessfulRefreshAt / nextEligibleAt advance).
   * - No finalizeFailure either (not a provider failure; do not backoff/suspend).
   * - Count as playersFailed + budgetExhausted so terminal equality holds and the run is PARTIAL.
   */
  private async releaseZeroBudgetClaim(input: {
    player: TrackedPlayer;
    ownerToken: string;
  }): Promise<PlayerOutcome> {
    const released = await this.trackedPlayers.releaseOwnedLease({
      trackedPlayerId: input.player.id,
      ownerToken: input.ownerToken,
    });
    if (!released.updated) {
      return { kind: 'ownership_lost' };
    }
    return { kind: 'budget_skip' };
  }

  /** Release claim without failure backoff when peers drain under shared 429 cooldown. */
  private async releaseCooldownSkipClaim(input: {
    player: TrackedPlayer;
    ownerToken: string;
  }): Promise<PlayerOutcome> {
    const released = await this.trackedPlayers.releaseOwnedLease({
      trackedPlayerId: input.player.id,
      ownerToken: input.ownerToken,
    });
    if (!released.updated) {
      return { kind: 'ownership_lost' };
    }
    return { kind: 'cooldown_skip' };
  }

  private async finalizeTransientFailure(input: {
    player: TrackedPlayer;
    ownerToken: string;
    runtime: RuntimeConfig;
    failureCode: string;
    rateLimited: boolean;
  }): Promise<PlayerOutcome> {
    const finalized = await this.trackedPlayers.finalizeFailure({
      trackedPlayerId: input.player.id,
      ownerToken: input.ownerToken,
      failureCode: input.failureCode,
      baseBackoffMs: input.runtime.baseBackoffMs,
      maxBackoffMs: input.runtime.maxBackoffMs,
      maxBackoffExponent: input.runtime.maxBackoffExponent,
    });
    if (!finalized.updated) {
      return { kind: 'ownership_lost' };
    }
    return {
      kind: 'failure',
      discovered: 0,
      enqueued: 0,
      skipped: 0,
      rateLimited: input.rateLimited,
    };
  }

  private async finalizeTransientOrPermanentFailure(input: {
    player: TrackedPlayer;
    ownerToken: string;
    runtime: RuntimeConfig;
    failureCode: string;
  }): Promise<PlayerOutcome> {
    const finalized = await this.trackedPlayers.finalizeFailure({
      trackedPlayerId: input.player.id,
      ownerToken: input.ownerToken,
      failureCode: input.failureCode,
      baseBackoffMs: input.runtime.baseBackoffMs,
      maxBackoffMs: input.runtime.maxBackoffMs,
      maxBackoffExponent: input.runtime.maxBackoffExponent,
    });
    if (!finalized.updated) {
      return { kind: 'ownership_lost' };
    }
    return {
      kind: 'failure',
      discovered: 0,
      enqueued: 0,
      skipped: 0,
      rateLimited: false,
    };
  }

  private async ensureNoUnreleasedLeases(ownerToken: string): Promise<void> {
    let remaining = await this.trackedPlayers.countOwnedUnreleasedLeases(ownerToken);
    if (remaining === 0) {
      return;
    }

    this.logger.warn({
      message: 'Collector run has unreleased leases; attempting best-effort release',
      ownerToken,
      remaining,
    });

    await this.trackedPlayers.forceReleaseOwnedLeases(ownerToken);
    remaining = await this.trackedPlayers.countOwnedUnreleasedLeases(ownerToken);

    if (remaining > 0) {
      throw new CollectorRunError(
        'UNRELEASED_LEASES',
        `Run still owns ${remaining} unreleased lease(s) after best-effort release.`,
      );
    }
  }

  private resolveTerminalStatus(input: {
    counters: CollectorRunCounters;
    anyAttempted: boolean;
  }): Exclude<CollectorRunStatus, 'RUNNING'> {
    const { counters, anyAttempted } = input;

    if (!anyAttempted && counters.playersClaimed === 0) {
      return CollectorRunStatus.COMPLETED;
    }

    const hasPartialSignal =
      counters.playersFailed > 0 ||
      counters.ownershipLost > 0 ||
      counters.rateLimitStops > 0 ||
      counters.budgetExhausted;

    if (hasPartialSignal) {
      return CollectorRunStatus.PARTIAL;
    }

    return CollectorRunStatus.COMPLETED;
  }

  private async finalizeRun(input: {
    runId: string;
    ownerToken: string;
    status: Exclude<CollectorRunStatus, 'RUNNING'>;
    counters: CollectorRunCounters;
  }): Promise<CollectorRun> {
    const finalized = await this.runs.finalizeIfRunning({
      id: input.runId,
      ownerToken: input.ownerToken,
      status: input.status,
      counters: input.counters,
    });

    if (!finalized) {
      throw new CollectorRunError(
        'FINALIZATION_CONFLICT',
        `CollectorRun finalization conflict for run ${input.runId}`,
      );
    }
    return finalized;
  }
}
