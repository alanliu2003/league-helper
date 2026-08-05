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
    const warnings = input.warnings ?? [];
    const meta = await this.readMeta(input.account.id);
    const discoveredMatchIds =
      input.discoveredMatchIds.length > 0 ? input.discoveredMatchIds : meta.lastDiscoveredMatchIds;
    const requestedMatchCount =
      input.requestedMatchCount > 0 ? input.requestedMatchCount : meta.lastRequestedMatchCount;
    const provider = input.account.provider;

    const [existingMatches, statusCounts, completedCount] = await Promise.all([
      this.matchRepository.findExistingByExternalIds(provider, discoveredMatchIds),
      this.ingestionJobs.countByStatuses(MATCH_INGESTION_JOB_NAME, provider, discoveredMatchIds),
      this.matchRepository.countCompletedForPlayerAccount(input.account.id),
    ]);

    const knownFromDiscovery = existingMatches.length;
    const countByStatus = new Map(statusCounts.map((row) => [row.status, row.count]));

    const durablePending = countByStatus.get(IngestionJobStatus.PENDING) ?? 0;
    const durableQueued = countByStatus.get(IngestionJobStatus.QUEUED) ?? 0;
    const durableRunning = countByStatus.get(IngestionJobStatus.RUNNING) ?? 0;
    const durableCompleted = countByStatus.get(IngestionJobStatus.COMPLETED) ?? 0;
    const durableFailed =
      (countByStatus.get(IngestionJobStatus.FAILED) ?? 0) +
      (countByStatus.get(IngestionJobStatus.DEAD_LETTERED) ?? 0);

    let bullWaiting = 0;
    let bullActive = 0;
    let bullDelayed = 0;
    let bullFailed = 0;

    if (discoveredMatchIds.length > 0) {
      const jobIds = discoveredMatchIds.map((externalMatchId) =>
        buildMatchIngestionBullMqJobId({
          provider,
          regionalRoute: input.account.regionalRoute,
          externalMatchId,
          normalizationVersion: MATCH_INGESTION_NORMALIZATION_VERSION,
        }),
      );
      const states = await this.producer.getJobStates(jobIds);
      for (const state of states.values()) {
        if (state === 'waiting') {
          bullWaiting += 1;
        } else if (state === 'active') {
          bullActive += 1;
        } else if (state === 'delayed') {
          bullDelayed += 1;
        } else if (state === 'failed') {
          bullFailed += 1;
        }
      }
    }

    const queuedMatchCount = durablePending + durableQueued + bullWaiting;
    const activeMatchCount = durableRunning + bullActive;
    const delayedMatchCount = bullDelayed;
    const failedMatchCount = durableFailed + bullFailed;
    const completedMatchCount = Math.max(completedCount, knownFromDiscovery + durableCompleted);

    const inFlight = queuedMatchCount + activeMatchCount + delayedMatchCount;
    const rateLimited = warnings.some((w) => w.code === 'PROVIDER_RATE_LIMITED');
    const retryAfterSeconds = warnings.find(
      (w) => w.retryAfterSeconds !== undefined,
    )?.retryAfterSeconds;

    const staleThresholdMs = this.config.profileCacheTtlSeconds * 1000 * 2;
    const lastResolvedAt = input.account.lastResolvedAt;
    const isStale =
      lastResolvedAt === null || Date.now() - lastResolvedAt.getTime() > staleThresholdMs;

    const state = this.resolveState({
      discoveredCount: discoveredMatchIds.length,
      knownCount: knownFromDiscovery,
      inFlight,
      failedCount: failedMatchCount,
      rateLimited,
      isStale,
      requestedMatchCount,
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

  private resolveState(input: {
    discoveredCount: number;
    knownCount: number;
    inFlight: number;
    failedCount: number;
    rateLimited: boolean;
    isStale: boolean;
    requestedMatchCount: number;
  }): PlayerRefreshState {
    if (input.rateLimited) {
      return 'RATE_LIMITED';
    }
    if (input.inFlight > 0) {
      return 'PROCESSING';
    }
    if (input.discoveredCount === 0) {
      return input.isStale ? 'STALE' : 'IDLE';
    }
    if (input.knownCount >= input.discoveredCount) {
      return input.isStale ? 'STALE' : 'COMPLETE';
    }
    if (input.failedCount > 0 && input.knownCount > 0) {
      return 'PARTIAL';
    }
    if (input.failedCount > 0 && input.knownCount === 0) {
      return 'FAILED';
    }
    if (input.isStale && input.knownCount < input.requestedMatchCount) {
      return 'STALE';
    }
    return 'IDLE';
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
