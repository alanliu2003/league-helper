import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import {
  loadCollectorConfig,
  readCollectorSchedulerEnabled,
  type CollectorConfig,
} from './collector.config';
import { COLLECTOR_CONFIG } from './collector-enrollment.service';
import { isRateLimitedCollectorFailureCode } from './collector.failure-codes';
import { CollectorSchedulerStateRepository } from './collector-scheduler-state.repository';
import type { CollectorRunOnceResult, SchedulerTickResult } from './collector.types';
import { PopulationCollectorService } from './population-collector.service';

const MIN_RENEWAL_INTERVAL_MS = 1_000;

/**
 * AbortSignal-aware sleep. Resolves early on abort (does not reject).
 * Used between ticks so the outer loop never stacks overlapping work.
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function renewalIntervalMs(leaseMs: number): number {
  // Prefer lease/3 so several renewals fit inside TTL; floor at 1s for short test leases.
  return Math.max(MIN_RENEWAL_INTERVAL_MS, Math.floor(leaseMs / 3));
}

function wasRateLimited(run: CollectorRunOnceResult): boolean {
  if (run.counters.rateLimitStops > 0) {
    return true;
  }
  const code = run.counters.failureCode;
  return typeof code === 'string' && isRateLimitedCollectorFailureCode(code);
}

/**
 * Owner-safe recurring scheduler for PopulationCollectorService.runOnce.
 *
 * Does NOT start on construction or Nest module init — CLI (Task 10) owns the loop.
 */
@Injectable()
export class CollectorSchedulerService {
  private readonly logger = new Logger(CollectorSchedulerService.name);
  private readonly config: CollectorConfig;

  constructor(
    @Inject(CollectorSchedulerStateRepository)
    private readonly schedulerState: CollectorSchedulerStateRepository,
    @Inject(PopulationCollectorService)
    private readonly populationCollector: PopulationCollectorService,
    @Inject(MatchIngestionProducer)
    private readonly matchIngestion: MatchIngestionProducer,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /**
   * One owner-safe scheduling attempt.
   * Enable flag is re-read from process.env each tick; other knobs use bootstrap config.
   */
  async tick(): Promise<SchedulerTickResult> {
    let enabled: boolean;
    try {
      enabled = readCollectorSchedulerEnabled(process.env);
    } catch {
      // Invalid enable value — fail clearly without shared-state mutation (not yet acquired).
      this.logger.error('Scheduler tick failed: invalid COLLECTOR_SCHEDULER_ENABLED');
      return { outcome: 'FAILED_TO_START', errorCode: 'INVALID_SCHEDULER_ENABLED' };
    }

    if (!enabled) {
      // Quiet: disabled ticks are the steady-state emergency-stop path.
      this.logger.debug('Scheduler tick skipped: disabled');
      return { outcome: 'SKIPPED_DISABLED' };
    }

    const owner = randomUUID();
    const leaseMs = this.config.schedulerLeaseMs;
    const acquired = await this.schedulerState.tryAcquireLease(owner, leaseMs);
    if (!acquired) {
      this.logger.log('Scheduler tick skipped: overlap (lease not acquired)');
      return { outcome: 'SKIPPED_OVERLAP' };
    }

    this.logger.log('Scheduler lease acquired');

    try {
      return await this.runOwnedTick(owner);
    } finally {
      const released = await this.schedulerState.releaseLease(owner);
      if (!released) {
        this.logger.error('Scheduler lease release failed; ownership already lost');
      } else {
        this.logger.log('Scheduler lease released');
      }
    }
  }

  /**
   * Long-running loop: first tick is immediate, then sleep scheduleIntervalMs.
   * Awaits each tick fully (no local overlap, no catch-up backlog).
   */
  async runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.tick();
      if (signal.aborted) {
        break;
      }
      await abortableSleep(this.config.scheduleIntervalMs, signal);
    }
  }

  private async runOwnedTick(owner: string): Promise<SchedulerTickResult> {
    let renewal: { stop: () => void } | undefined;
    try {
      const state = await this.schedulerState.readState();
      const now = new Date();
      if (state?.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) {
        const recorded = await this.schedulerState.recordOutcome(owner, 'SKIPPED_COOLDOWN');
        if (!recorded) {
          this.logger.error('Scheduler ownership lost while recording SKIPPED_COOLDOWN');
        }
        this.logger.log(
          `Scheduler tick skipped: cooldown until=${state.cooldownUntil.toISOString()} leaseRecorded=${recorded}`,
        );
        return { outcome: 'SKIPPED_COOLDOWN' };
      }

      let pending: number;
      try {
        const counts = await this.matchIngestion.getQueueCounts();
        pending = counts.waiting + counts.active + counts.delayed;
      } catch {
        // Fail-safe: never treat probe failure as empty queue.
        const recorded = await this.schedulerState.recordOutcome(
          owner,
          'SKIPPED_BACKPRESSURE',
          'QUEUE_PROBE_FAILED',
        );
        if (!recorded) {
          this.logger.error('Scheduler ownership lost while recording QUEUE_PROBE_FAILED');
        }
        this.logger.log(
          `Scheduler tick skipped: queue probe failed leaseRecorded=${recorded}`,
        );
        return {
          outcome: 'SKIPPED_BACKPRESSURE',
          errorCode: 'QUEUE_PROBE_FAILED',
        };
      }

      const maxPending = this.config.maxPendingIngestionJobs;
      // pending === threshold is ALLOWED; only strictly greater skips.
      if (pending > maxPending) {
        const recorded = await this.schedulerState.recordOutcome(owner, 'SKIPPED_BACKPRESSURE');
        if (!recorded) {
          this.logger.error('Scheduler ownership lost while recording SKIPPED_BACKPRESSURE');
        }
        this.logger.log(
          `Scheduler tick skipped: backpressure pending=${pending} max=${maxPending} leaseRecorded=${recorded}`,
        );
        return { outcome: 'SKIPPED_BACKPRESSURE' };
      }

      this.logger.log(`Scheduler backpressure ok pending=${pending} max=${maxPending}`);

      renewal = this.startLeaseRenewal(owner);
      const run = await this.populationCollector.runOnce(this.buildScheduleInput());
      return await this.recordTriggered(owner, run);
    } catch {
      // Covers runOnce throw and unexpected owned-path failures before a normal return.
      const recorded = await this.schedulerState.recordOutcome(
        owner,
        'FAILED_TO_START',
        'RUN_ONCE_START_FAILED',
      );
      if (!recorded) {
        this.logger.error('Scheduler ownership lost while recording FAILED_TO_START');
      }
      this.logger.error(`Scheduler tick failed to start leaseRecorded=${recorded}`);
      return { outcome: 'FAILED_TO_START', errorCode: 'RUN_ONCE_START_FAILED' };
    } finally {
      renewal?.stop();
    }
  }

  private buildScheduleInput() {
    return {
      platformFilter: this.config.schedulePlatform,
      queueId: this.config.scheduleQueueId,
      batchLimit: this.config.scheduleBatchSize,
      concurrency: this.config.scheduleConcurrency,
      matchesPerPlayer: this.config.scheduleMaxMatchesPerPlayer,
      maxMatchIdsPerRun: this.config.scheduleMaxMatchIds,
      maxEnqueuePerRun: this.config.scheduleMaxEnqueue,
    };
  }

  private async recordTriggered(
    owner: string,
    run: CollectorRunOnceResult,
  ): Promise<SchedulerTickResult> {
    // CollectorRun.status PARTIAL/FAILED still means scheduler TRIGGERED (invocation succeeded).
    const triggerOk = await this.schedulerState.recordTrigger(owner, run.runId);
    if (!triggerOk) {
      this.logger.error(
        `Scheduler ownership lost after runOnce; cannot record trigger runId=${run.runId}`,
      );
      return {
        outcome: 'TRIGGERED',
        collectorRunId: run.runId,
        errorCode: 'OWNERSHIP_LOST',
      };
    }

    const outcomeOk = await this.schedulerState.recordOutcome(owner, 'TRIGGERED');
    if (!outcomeOk) {
      this.logger.error(
        `Scheduler ownership lost after runOnce; cannot record TRIGGERED runId=${run.runId}`,
      );
      return {
        outcome: 'TRIGGERED',
        collectorRunId: run.runId,
        errorCode: 'OWNERSHIP_LOST',
      };
    }

    if (wasRateLimited(run)) {
      // CollectorRunOnceResult does not expose observed Retry-After; use configured cooldown only.
      const cooldownUntil = new Date(Date.now() + this.config.schedulerRateLimitCooldownMs);
      const cooldownOk = await this.schedulerState.setCooldown(owner, cooldownUntil);
      if (!cooldownOk) {
        this.logger.error(
          `Scheduler ownership lost while setting rate-limit cooldown runId=${run.runId}`,
        );
        return {
          outcome: 'TRIGGERED',
          collectorRunId: run.runId,
          errorCode: 'OWNERSHIP_LOST',
        };
      }
      this.logger.log(
        `Scheduler triggered runId=${run.runId} status=${run.status} cooldownUntil=${cooldownUntil.toISOString()}`,
      );
    } else {
      this.logger.log(`Scheduler triggered runId=${run.runId} status=${run.status}`);
    }

    return { outcome: 'TRIGGERED', collectorRunId: run.runId };
  }

  private startLeaseRenewal(owner: string): { stop: () => void } {
    const leaseMs = this.config.schedulerLeaseMs;
    const intervalMs = renewalIntervalMs(leaseMs);
    const handle = setInterval(() => {
      void this.schedulerState.renewLease(owner, leaseMs).then((ok) => {
        if (!ok) {
          // Do not kill the process or cancel Riot/BullMQ work — ownership loss is soft.
          this.logger.error('Scheduler lease renewal failed; ownership lost');
        }
      });
    }, intervalMs);

    if (typeof handle.unref === 'function') {
      handle.unref();
    }

    return {
      stop: () => {
        clearInterval(handle);
      },
    };
  }
}
