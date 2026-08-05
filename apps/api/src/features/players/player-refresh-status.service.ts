import { Inject, Injectable } from '@nestjs/common';
import { IngestionJobStatus, type PlayerAccount } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_NORMALIZATION_VERSION,
  PlayerRefreshStatusSchema,
  buildMatchIngestionBullMqJobId,
  type PlayerRefreshState,
  type PlayerRefreshStatus,
  type PlayerSafeWarning,
} from '@league-helper/shared';
import type { Redis } from 'ioredis';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../config/player-refresh.config';
import { IngestionJobRepository } from '../../persistence/ingestion-job.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';

type RefreshMeta = {
  lastRefreshStartedAt: string | null;
  lastRefreshCompletedAt: string | null;
  lastRefreshedAt: string | null;
  lastDiscoveredMatchIds: string[];
  lastRequestedMatchCount: number;
};

export type ComputeRefreshStatusInput = {
  account: PlayerAccount;
  discoveredMatchIds: string[];
  requestedMatchCount: number;
  warnings?: PlayerSafeWarning[];
};

@Injectable()
export class PlayerRefreshStatusService {
  constructor(
    @Inject(MatchRepository) private readonly matchRepository: MatchRepository,
    @Inject(IngestionJobRepository) private readonly ingestionJobs: IngestionJobRepository,
    @Inject(MatchIngestionProducer) private readonly producer: MatchIngestionProducer,
    @Inject(PLAYER_REFRESH_CONFIG) private readonly config: PlayerRefreshConfig,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
  ) {}

  private metaKey(accountId: string): string {
    return `player-refresh-meta:${accountId}`;
  }

  async recordRefreshStarted(accountId: string): Promise<void> {
    try {
      const meta = await this.readMeta(accountId);
      const now = new Date().toISOString();
      await this.redis.set(
        this.metaKey(accountId),
        JSON.stringify({
          ...meta,
          lastRefreshStartedAt: now,
        } satisfies RefreshMeta),
        'EX',
        this.config.profileCacheTtlSeconds * 10,
      );
    } catch {
      // fail-open
    }
  }

  async recordRefreshCompleted(accountId: string): Promise<void> {
    try {
      const meta = await this.readMeta(accountId);
      const now = new Date().toISOString();
      await this.redis.set(
        this.metaKey(accountId),
        JSON.stringify({
          ...meta,
          lastRefreshCompletedAt: now,
          lastRefreshedAt: now,
        } satisfies RefreshMeta),
        'EX',
        this.config.profileCacheTtlSeconds * 10,
      );
    } catch {
      // fail-open
    }
  }

  async recordDiscoveredMatches(
    accountId: string,
    discoveredMatchIds: string[],
    requestedMatchCount: number,
  ): Promise<void> {
    try {
      const meta = await this.readMeta(accountId);
      await this.redis.set(
        this.metaKey(accountId),
        JSON.stringify({
          ...meta,
          lastDiscoveredMatchIds: discoveredMatchIds,
          lastRequestedMatchCount: requestedMatchCount,
        } satisfies RefreshMeta),
        'EX',
        this.config.profileCacheTtlSeconds * 10,
      );
    } catch {
      // fail-open
    }
  }

  async compute(input: ComputeRefreshStatusInput): Promise<PlayerRefreshStatus> {
    const warnings = [...(input.warnings ?? [])];
    const meta = await this.readMeta(input.account.id);
    const discoveredMatchIds =
      input.discoveredMatchIds.length > 0 ? input.discoveredMatchIds : meta.lastDiscoveredMatchIds;
    const requestedMatchCount =
      input.requestedMatchCount > 0 ? input.requestedMatchCount : meta.lastRequestedMatchCount;
    const provider = input.account.provider;

    const [existingMatches, linkedCompletedIds, durableJobs] = await Promise.all([
      this.matchRepository.findExistingByExternalIds(provider, discoveredMatchIds),
      this.matchRepository.findLinkedCompletedExternalIds(input.account.id, discoveredMatchIds),
      this.ingestionJobs.findByExternalResourceIds(
        MATCH_INGESTION_JOB_NAME,
        provider,
        discoveredMatchIds,
      ),
    ]);

    const knownFromDiscovery = existingMatches.length;
    const linkedCompletedSet = new Set(linkedCompletedIds);
    const completedMatchCount = linkedCompletedIds.length;

    const durableByExternal = new Map(
      durableJobs.map((job) => [job.externalResourceId ?? '', job] as const),
    );

    const jobIdsByExternal = new Map<string, string>();
    for (const externalMatchId of discoveredMatchIds) {
      jobIdsByExternal.set(
        externalMatchId,
        buildMatchIngestionBullMqJobId({
          provider,
          regionalRoute: input.account.regionalRoute,
          externalMatchId,
          normalizationVersion: MATCH_INGESTION_NORMALIZATION_VERSION,
        }),
      );
    }
    const states =
      discoveredMatchIds.length > 0
        ? await this.producer.getJobStates([...jobIdsByExternal.values()])
        : new Map<string, string | null>();

    let queuedMatchCount = 0;
    let activeMatchCount = 0;
    let delayedMatchCount = 0;
    let failedMatchCount = 0;
    let durableMissingRedis = 0;
    let unresolvedMissing = 0;

    for (const externalMatchId of discoveredMatchIds) {
      if (linkedCompletedSet.has(externalMatchId)) {
        continue;
      }

      const bullJobId = jobIdsByExternal.get(externalMatchId);
      const bullState = bullJobId ? (states.get(bullJobId) ?? null) : null;
      const durable = durableByExternal.get(externalMatchId);

      if (bullState === 'active' || durable?.status === IngestionJobStatus.RUNNING) {
        activeMatchCount += 1;
        continue;
      }
      if (bullState === 'delayed') {
        delayedMatchCount += 1;
        continue;
      }
      if (bullState === 'waiting') {
        queuedMatchCount += 1;
        continue;
      }
      if (
        durable?.status === IngestionJobStatus.FAILED ||
        durable?.status === IngestionJobStatus.DEAD_LETTERED
      ) {
        failedMatchCount += 1;
        continue;
      }
      // BullMQ "failed" without durable dead-letter still counts as failed work.
      if (bullState === 'failed') {
        failedMatchCount += 1;
        continue;
      }

      // Completed BullMQ jobs without a linked Match are stranded — count as queued repair work.
      if (
        durable &&
        (durable.status === IngestionJobStatus.PENDING ||
          durable.status === IngestionJobStatus.QUEUED) &&
        (bullState === null || bullState === undefined || bullState === 'completed')
      ) {
        durableMissingRedis += 1;
        queuedMatchCount += 1;
        continue;
      }

      if (
        durable?.status === IngestionJobStatus.PENDING ||
        durable?.status === IngestionJobStatus.QUEUED
      ) {
        queuedMatchCount += 1;
        continue;
      }

      // Discovered but not linked-complete and no in-flight job classification.
      unresolvedMissing += 1;
    }

    if (durableMissingRedis > 0) {
      warnings.push({
        code: 'INGESTION_STATE_INCONSISTENT',
        message:
          'Some durable ingestion jobs are marked queued but missing from Redis. Reconciliation can repair them.',
      });
    }

    const waitingOrActive = queuedMatchCount + activeMatchCount;

    const rateLimitedWarning = warnings.some((w) => w.code === 'PROVIDER_RATE_LIMITED');
    const retryAfterSeconds = warnings.find(
      (w) => w.retryAfterSeconds !== undefined,
    )?.retryAfterSeconds;

    const staleThresholdMs = this.config.profileCacheTtlSeconds * 1000 * 2;
    const lastResolvedAt = input.account.lastResolvedAt;
    const isStale =
      lastResolvedAt === null || Date.now() - lastResolvedAt.getTime() > staleThresholdMs;

    const state = this.resolveState({
      discoveredCount: discoveredMatchIds.length,
      linkedCompletedCount: completedMatchCount,
      waitingOrActive,
      delayedCount: delayedMatchCount,
      failedCount: failedMatchCount,
      unresolvedMissing,
      rateLimited: rateLimitedWarning || (delayedMatchCount > 0 && waitingOrActive === 0),
      isStale,
    });

    return PlayerRefreshStatusSchema.parse({
      state,
      requestedMatchCount,
      discoveredMatchCount: discoveredMatchIds.length,
      knownMatchCount: knownFromDiscovery,
      queuedMatchCount,
      activeMatchCount,
      delayedMatchCount,
      completedMatchCount,
      failedMatchCount,
      lastResolvedAt: lastResolvedAt?.toISOString() ?? null,
      lastRefreshStartedAt: meta.lastRefreshStartedAt,
      lastRefreshCompletedAt: meta.lastRefreshCompletedAt,
      lastRefreshedAt: meta.lastRefreshedAt,
      isStale,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      warnings,
    });
  }

  /**
   * Ingestion-aware refresh state. Profile sync success alone must never yield COMPLETE.
   */
  private resolveState(input: {
    discoveredCount: number;
    linkedCompletedCount: number;
    waitingOrActive: number;
    delayedCount: number;
    failedCount: number;
    unresolvedMissing: number;
    rateLimited: boolean;
    isStale: boolean;
  }): PlayerRefreshState {
    if (input.discoveredCount === 0) {
      return input.isStale ? 'STALE' : 'IDLE';
    }

    const remainingWork =
      input.waitingOrActive + input.delayedCount + input.unresolvedMissing + input.failedCount;

    if (input.rateLimited && input.delayedCount > 0 && input.waitingOrActive === 0) {
      return 'RATE_LIMITED';
    }

    if (input.waitingOrActive > 0) {
      return input.linkedCompletedCount > 0 ? 'PARTIAL' : 'PROCESSING';
    }

    if (input.linkedCompletedCount > 0 && remainingWork > 0) {
      return 'PARTIAL';
    }

    if (
      input.linkedCompletedCount >= input.discoveredCount &&
      input.waitingOrActive === 0 &&
      input.delayedCount === 0 &&
      input.failedCount === 0 &&
      input.unresolvedMissing === 0
    ) {
      return input.isStale ? 'STALE' : 'COMPLETE';
    }

    if (input.failedCount > 0 && input.linkedCompletedCount === 0) {
      return 'FAILED';
    }

    if (input.unresolvedMissing > 0 || input.delayedCount > 0) {
      return input.linkedCompletedCount > 0 ? 'PARTIAL' : 'PROCESSING';
    }

    if (input.isStale) {
      return 'STALE';
    }

    return input.linkedCompletedCount > 0 ? 'PARTIAL' : 'PROCESSING';
  }

  private async readMeta(accountId: string): Promise<RefreshMeta> {
    const empty: RefreshMeta = {
      lastRefreshStartedAt: null,
      lastRefreshCompletedAt: null,
      lastRefreshedAt: null,
      lastDiscoveredMatchIds: [],
      lastRequestedMatchCount: this.config.defaultMatchCount,
    };
    try {
      const raw = await this.redis.get(this.metaKey(accountId));
      if (!raw) {
        return empty;
      }
      const parsed = JSON.parse(raw) as Partial<RefreshMeta>;
      return {
        lastRefreshStartedAt: parsed.lastRefreshStartedAt ?? null,
        lastRefreshCompletedAt: parsed.lastRefreshCompletedAt ?? null,
        lastRefreshedAt: parsed.lastRefreshedAt ?? null,
        lastDiscoveredMatchIds: parsed.lastDiscoveredMatchIds ?? [],
        lastRequestedMatchCount: parsed.lastRequestedMatchCount ?? this.config.defaultMatchCount,
      };
    } catch {
      return empty;
    }
  }
}
