import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ProviderRateLimitedError,
  UnsupportedPlatformRouteError,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
} from '@league-helper/shared';
import { Prisma, type PrismaClient, type TrackedPlayer, type TrackedPlayerEnrollmentSource } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import { loadCollectorConfig, type CollectorConfig } from '../collector.config';
import { COLLECTOR_CONFIG } from '../collector.tokens';
import {
  AlreadyTrackedRollbackError,
  ensureTrackedPlayerBudgetSingleton,
  reserveLadderTrackedCreate,
} from './ladder-enrollment.budget';

export const LADDER_ACCOUNT_RESOLVER = Symbol('LADDER_ACCOUNT_RESOLVER');

export type LadderEnrollmentOutcome =
  | 'created'
  | 'alreadyTracked'
  | 'skippedIdentity'
  | 'skippedPlatform'
  | 'skippedLadderCap'
  | 'skippedTotalCap'
  | 'error';

export type EnrollLadderCandidateInput = {
  platformRoute: string;
  puuid: string;
  riotIdGameName?: string | null;
  riotIdTagLine?: string | null;
  /** Default 0; Phase 3 may boost later. */
  priority?: number;
};

export type EnrollLadderCandidateResult = {
  outcome: LadderEnrollmentOutcome;
  trackedPlayerId?: string;
  playerAccountId?: string;
  enrollmentSource?: TrackedPlayerEnrollmentSource;
  discoveryDepth?: number;
  message?: string;
};

/** Bounded Account-v1-style resolver; return null for normal resolve miss. */
export type LadderAccountResolver = (input: {
  puuid: string;
  platformRoute: string;
}) => Promise<{
  gameName: string;
  tagLine: string;
  regionalRoute?: string;
} | null>;

export type ReserveAndCreateLadderInput = {
  playerAccountId: string;
  provider: string;
  platformRoute: string;
  totalCap: number;
  ladderCap: number;
  priority?: number;
};

export type ReserveAndCreateLadderResult =
  | { outcome: 'created'; trackedPlayer: TrackedPlayer }
  | { outcome: 'alreadyTracked'; trackedPlayer: TrackedPlayer }
  | { outcome: 'skippedTotalCap' }
  | { outcome: 'skippedLadderCap' };

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

function hasUsableRiotNames(
  gameName: string | null | undefined,
  tagLine: string | null | undefined,
): boolean {
  return Boolean(gameName?.trim() && tagLine?.trim());
}

/**
 * Race-safe LADDER create: reserve ladder+total slots then INSERT TrackedPlayer.
 * Lock order: CollectorTrackedPlayerBudget → TrackedPlayer INSERT.
 * Unique conflict aborts the TX so reservations roll back.
 */
export async function reserveAndCreateLadderTrackedPlayer(
  prisma: PrismaClient,
  input: ReserveAndCreateLadderInput,
): Promise<ReserveAndCreateLadderResult> {
  await ensureTrackedPlayerBudgetSingleton(prisma);

  try {
    const trackedPlayer = await prisma.$transaction(async (tx) => {
      const reserved = await reserveLadderTrackedCreate(tx, {
        totalCap: input.totalCap,
        ladderCap: input.ladderCap,
      });
      if (reserved.outcome === 'skipped_total_cap') {
        throw new LadderCapRejectedError('skippedTotalCap');
      }
      if (reserved.outcome === 'skipped_ladder_cap') {
        throw new LadderCapRejectedError('skippedLadderCap');
      }

      try {
        return await tx.trackedPlayer.create({
          data: {
            id: randomUUID(),
            playerAccountId: input.playerAccountId,
            provider: input.provider,
            platformRoute: input.platformRoute,
            enrollmentSource: 'LADDER',
            discoveryDepth: 0,
            status: 'ACTIVE',
            priority: input.priority ?? 0,
            nextEligibleAt: new Date(),
            consecutiveFailureCount: 0,
          },
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new AlreadyTrackedRollbackError();
        }
        throw error;
      }
    });

    return { outcome: 'created', trackedPlayer };
  } catch (error: unknown) {
    if (error instanceof LadderCapRejectedError) {
      return { outcome: error.outcome };
    }
    if (error instanceof AlreadyTrackedRollbackError) {
      const existing = await prisma.trackedPlayer.findUnique({
        where: { playerAccountId: input.playerAccountId },
      });
      if (!existing) {
        throw new Error('Unique conflict without existing TrackedPlayer row');
      }
      return { outcome: 'alreadyTracked', trackedPlayer: existing };
    }
    throw error;
  }
}

class LadderCapRejectedError extends Error {
  readonly outcome: 'skippedTotalCap' | 'skippedLadderCap';

  constructor(outcome: 'skippedTotalCap' | 'skippedLadderCap') {
    super(`Ladder enrollment cap rejected: ${outcome}`);
    this.name = 'LadderCapRejectedError';
    this.outcome = outcome;
  }
}

/**
 * Apply rediscovery: preserve enrollmentSource; discoveryDepth = LEAST(existing, 0).
 * Does not consume ladder/total capacity.
 */
export async function applyLadderRediscovery(
  prisma: PrismaClient,
  playerAccountId: string,
): Promise<TrackedPlayer | null> {
  const rows = await prisma.$queryRaw<TrackedPlayer[]>`
    UPDATE "TrackedPlayer"
    SET
      "discoveryDepth" = LEAST("discoveryDepth", 0),
      "updatedAt" = now()
    WHERE "playerAccountId" = ${playerAccountId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

@Injectable()
export class LadderEnrollmentService {
  private readonly config: CollectorConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
    @Optional() @Inject(LADDER_ACCOUNT_RESOLVER) private readonly resolveAccount?: LadderAccountResolver,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /** Test / CLI factory with explicit deps. */
  static create(deps: {
    prisma: PrismaService | PrismaClient;
    playerAccounts: PlayerAccountRepository;
    config: CollectorConfig;
    resolveAccount?: LadderAccountResolver;
  }): LadderEnrollmentService {
    return new LadderEnrollmentService(
      deps.prisma as PrismaService,
      deps.playerAccounts,
      deps.config,
      deps.resolveAccount,
    );
  }

  /**
   * Enroll a ladder candidate under LADDER + total hard caps.
   * Cheap identity/presence checks run before optional Account-v1 resolve.
   */
  async enrollLadderCandidate(
    input: EnrollLadderCandidateInput,
  ): Promise<EnrollLadderCandidateResult> {
    const puuid = input.puuid.trim();
    if (!puuid) {
      return { outcome: 'skippedIdentity', message: 'puuid is required' };
    }

    let platformRoute: string;
    try {
      platformRoute = parsePlatformRoute(input.platformRoute);
    } catch (error: unknown) {
      const message =
        error instanceof UnsupportedPlatformRouteError
          ? error.message
          : `Unsupported platform route: ${input.platformRoute}`;
      return { outcome: 'skippedPlatform', message };
    }

    if (!this.config.platformAllowlist.includes(platformRoute)) {
      return {
        outcome: 'skippedPlatform',
        message: `Platform ${platformRoute} is outside COLLECTOR_PLATFORM_ALLOWLIST.`,
      };
    }

    if (this.config.ladderPlatform != null && platformRoute !== this.config.ladderPlatform) {
      return {
        outcome: 'skippedPlatform',
        message: `Platform ${platformRoute} is outside COLLECTOR_LADDER_PLATFORM.`,
      };
    }

    try {
      const existingAccount = await this.playerAccounts.findByProviderExternalId('RIOT', puuid);
      if (existingAccount) {
        const existingTracked = await this.prisma.trackedPlayer.findUnique({
          where: { playerAccountId: existingAccount.id },
        });
        if (existingTracked) {
          const updated = await applyLadderRediscovery(this.prisma, existingAccount.id);
          const tracked = updated ?? existingTracked;
          return {
            outcome: 'alreadyTracked',
            trackedPlayerId: tracked.id,
            playerAccountId: tracked.playerAccountId,
            enrollmentSource: tracked.enrollmentSource,
            discoveryDepth: tracked.discoveryDepth,
          };
        }
      }

      let gameName = input.riotIdGameName?.trim() || null;
      let tagLine = input.riotIdTagLine?.trim() || null;

      if (
        !hasUsableRiotNames(gameName, tagLine) &&
        existingAccount &&
        hasUsableRiotNames(existingAccount.currentGameName, existingAccount.currentTagLine)
      ) {
        gameName = existingAccount.currentGameName;
        tagLine = existingAccount.currentTagLine;
      }

      if (!hasUsableRiotNames(gameName, tagLine)) {
        if (!this.resolveAccount) {
          return {
            outcome: 'skippedIdentity',
            message: 'Riot ID names missing and no Account-v1 resolver configured.',
          };
        }
        let resolved: Awaited<ReturnType<LadderAccountResolver>>;
        try {
          resolved = await this.resolveAccount({ puuid, platformRoute });
        } catch (error: unknown) {
          // Rethrow so ladder seed can publish shared 429 cooldown.
          if (error instanceof ProviderRateLimitedError) {
            throw error;
          }
          return {
            outcome: 'error',
            message: 'Account-v1 resolve failed.',
          };
        }
        if (!resolved || !hasUsableRiotNames(resolved.gameName, resolved.tagLine)) {
          return {
            outcome: 'skippedIdentity',
            message: 'Account-v1 did not return usable Riot ID names.',
          };
        }
        gameName = resolved.gameName.trim();
        tagLine = resolved.tagLine.trim();
      }

      const regionalRoute =
        existingAccount?.regionalRoute ?? getRegionalRouteForPlatform(platformRoute as never);

      const account = await this.playerAccounts.upsertPlayerAccount({
        provider: 'RIOT',
        externalAccountId: puuid,
        platformRoute,
        regionalRoute,
        gameName: gameName!,
        tagLine: tagLine!,
      });

      // Re-check after upsert (another enroll may have won the race).
      const raced = await this.prisma.trackedPlayer.findUnique({
        where: { playerAccountId: account.id },
      });
      if (raced) {
        const updated = await applyLadderRediscovery(this.prisma, account.id);
        const tracked = updated ?? raced;
        return {
          outcome: 'alreadyTracked',
          trackedPlayerId: tracked.id,
          playerAccountId: tracked.playerAccountId,
          enrollmentSource: tracked.enrollmentSource,
          discoveryDepth: tracked.discoveryDepth,
        };
      }

      const priority =
        input.priority !== undefined && Number.isInteger(input.priority)
          ? Math.min(
              this.config.priorityMax,
              Math.max(this.config.priorityMin, input.priority),
            )
          : Math.min(
              this.config.priorityMax,
              Math.max(this.config.priorityMin, this.config.ladderInitialPriority),
            );

      const created = await reserveAndCreateLadderTrackedPlayer(this.prisma, {
        playerAccountId: account.id,
        provider: 'RIOT',
        platformRoute,
        totalCap: this.config.totalTrackedPlayersHardCap,
        ladderCap: this.config.ladderMaxTotal,
        priority,
      });

      if (created.outcome === 'skippedTotalCap') {
        return { outcome: 'skippedTotalCap', playerAccountId: account.id };
      }
      if (created.outcome === 'skippedLadderCap') {
        return { outcome: 'skippedLadderCap', playerAccountId: account.id };
      }
      if (created.outcome === 'alreadyTracked') {
        const updated = await applyLadderRediscovery(this.prisma, account.id);
        const tracked = updated ?? created.trackedPlayer;
        return {
          outcome: 'alreadyTracked',
          trackedPlayerId: tracked.id,
          playerAccountId: tracked.playerAccountId,
          enrollmentSource: tracked.enrollmentSource,
          discoveryDepth: tracked.discoveryDepth,
        };
      }

      return {
        outcome: 'created',
        trackedPlayerId: created.trackedPlayer.id,
        playerAccountId: created.trackedPlayer.playerAccountId,
        enrollmentSource: created.trackedPlayer.enrollmentSource,
        discoveryDepth: created.trackedPlayer.discoveryDepth,
      };
    } catch (error: unknown) {
      if (error instanceof ProviderRateLimitedError) {
        throw error;
      }
      return {
        outcome: 'error',
        message: error instanceof Error ? error.message : 'Ladder enrollment failed.',
      };
    }
  }
}
