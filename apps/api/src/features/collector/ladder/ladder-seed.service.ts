import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ProviderRateLimitedError,
  parsePlatformRoute,
  type PlatformRoute,
  type RankDivision,
  type RankTier,
} from '@league-helper/shared';
import type {
  LadderCandidate,
  LadderCandidatesResult,
  LadderEntriesPageResult,
  RiotLeagueQueueType,
  RiotSharedCooldownStore,
} from '@league-helper/server-riot';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import { GAME_DATA_PROVIDER } from '../../../integrations/riot/riot.tokens';
import { loadCollectorConfig, type CollectorConfig } from '../collector.config';
import { COLLECTOR_CONFIG, RIOT_SHARED_COOLDOWN_STORE } from '../collector.tokens';
import { retryAfterMsFromProviderRateLimited } from '../riot-shared-cooldown.util';
import {
  LadderEnrollmentService,
  type EnrollLadderCandidateResult,
  type LadderEnrollmentOutcome,
} from './ladder-enrollment.service';

/** Duck-typed Riot ladder surface (not on shared GameDataProvider). */
export type LadderSeedProvider = {
  getChallengerLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult>;
  getGrandmasterLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult>;
  getMasterLeague(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }): Promise<LadderCandidatesResult>;
  getLeagueEntriesByTierDivision(input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
    tier: string;
    division: string;
    page: number;
  }): Promise<LadderEntriesPageResult>;
};

export type LadderSeedMode = 'apex' | 'representative';

export type LadderSeedInput = {
  platform: string;
  mode: LadderSeedMode;
  tiers: RankTier[];
  dryRun: boolean;
  /** Representative: required when paging a specific page. */
  division?: RankDivision;
  /** Representative: fetch exactly this page (requires division). */
  page?: number;
  /**
   * Representative: fetch pages 1..N for the selected division.
   * Capped by config.ladderMaxPagesPerTierDivision.
   */
  maxPagesPerDivision?: number;
  leagueQueueType?: RiotLeagueQueueType;
};

export type LadderSeedCounters = {
  fetched: number;
  eligible: number;
  scanned: number;
  created: number;
  alreadyTracked: number;
  skippedIdentity: number;
  skippedPlatform: number;
  skippedLadderCap: number;
  skippedTotalCap: number;
  errors: number;
  /**
   * Apply mode: candidates without usable Riot ID that enrolled as created
   * after enrollment's Account-v1 path. Dry-run always 0 (no Account-v1).
   */
  identityResolved: number;
  identityResolveFailed: number;
  /**
   * Dry-run only: candidates that would need Account-v1 (riotId missing +
   * no existing PlayerAccount with usable names). Apply mode: 0.
   */
  wouldNeedIdentityResolve: number;
  apexCandidates: number;
  representativeCandidates: number;
  byTier: Record<string, number>;
  providerCalls: number;
};

export type LadderSeedResult = {
  ok: boolean;
  dryRun: boolean;
  mode: LadderSeedMode;
  platform: PlatformRoute;
  tiers: RankTier[];
  leagueQueueType: RiotLeagueQueueType;
  division: RankDivision | null;
  pagesRequested: number[];
  counters: LadderSeedCounters;
  stoppedReason:
    | null
    | 'create_cap'
    | 'scan_ceiling'
    | 'ladder_cap'
    | 'total_cap'
    | 'rate_limited'
    | 'skipped_cooldown'
    | 'provider_error';
  errorMessage?: string;
};

function emptyCounters(): LadderSeedCounters {
  return {
    fetched: 0,
    eligible: 0,
    scanned: 0,
    created: 0,
    alreadyTracked: 0,
    skippedIdentity: 0,
    skippedPlatform: 0,
    skippedLadderCap: 0,
    skippedTotalCap: 0,
    errors: 0,
    identityResolved: 0,
    identityResolveFailed: 0,
    wouldNeedIdentityResolve: 0,
    apexCandidates: 0,
    representativeCandidates: 0,
    byTier: {},
    providerCalls: 0,
  };
}

function hasUsableRiotNames(
  gameName: string | null | undefined,
  tagLine: string | null | undefined,
): boolean {
  return Boolean(gameName?.trim() && tagLine?.trim());
}

function isLadderProvider(value: unknown): value is LadderSeedProvider {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const p = value as Record<string, unknown>;
  return (
    typeof p.getChallengerLeague === 'function' &&
    typeof p.getGrandmasterLeague === 'function' &&
    typeof p.getMasterLeague === 'function' &&
    typeof p.getLeagueEntriesByTierDivision === 'function'
  );
}

function bumpOutcome(counters: LadderSeedCounters, outcome: LadderEnrollmentOutcome): void {
  switch (outcome) {
    case 'created':
      counters.created += 1;
      break;
    case 'alreadyTracked':
      counters.alreadyTracked += 1;
      break;
    case 'skippedIdentity':
      counters.skippedIdentity += 1;
      break;
    case 'skippedPlatform':
      counters.skippedPlatform += 1;
      break;
    case 'skippedLadderCap':
      counters.skippedLadderCap += 1;
      break;
    case 'skippedTotalCap':
      counters.skippedTotalCap += 1;
      break;
    case 'error':
      counters.errors += 1;
      break;
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      counters.errors += 1;
    }
  }
}

/**
 * Operator ladder-root seeder.
 *
 * Dry-run semantics:
 * - MAY call Riot ladder endpoints (bounded).
 * - Performs read-only assessment (candidate counts + already-tracked lookups).
 * - Does NOT call Account-v1 (identityResolved stays 0; wouldNeedIdentityResolve reports need).
 * - Does NOT create Player / PlayerAccount / TrackedPlayer or increment budget counters.
 *
 * Apply mode enrolls roots ONLY via LadderEnrollmentService — never discovers match IDs
 * or enqueues match-ingestion jobs.
 */
@Injectable()
export class LadderSeedService {
  private readonly config: CollectorConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Inject(LadderEnrollmentService) private readonly enrollment: LadderEnrollmentService,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
    @Optional() @Inject(GAME_DATA_PROVIDER) private readonly gameData?: unknown,
    @Optional()
    @Inject(RIOT_SHARED_COOLDOWN_STORE)
    private readonly sharedCooldown?: RiotSharedCooldownStore | null,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
  }

  /** Test / CLI factory with explicit deps. */
  static create(deps: {
    prisma: PrismaService;
    playerAccounts: PlayerAccountRepository;
    enrollment: LadderEnrollmentService;
    config: CollectorConfig;
    gameData?: unknown;
    sharedCooldown?: RiotSharedCooldownStore | null;
  }): LadderSeedService {
    return new LadderSeedService(
      deps.prisma,
      deps.playerAccounts,
      deps.enrollment,
      deps.config,
      deps.gameData,
      deps.sharedCooldown,
    );
  }

  async seed(
    input: LadderSeedInput,
    providerOverride?: LadderSeedProvider,
  ): Promise<LadderSeedResult> {
    const platform = parsePlatformRoute(input.platform);
    const leagueQueueType = input.leagueQueueType ?? this.config.ladderQueueType;
    const counters = emptyCounters();
    const provider = this.resolveProvider(providerOverride);

    const pagesRequested =
      input.mode === 'representative' ? this.resolveRepresentativePages(input) : [];
    const division = input.mode === 'representative' ? (input.division ?? 'I') : null;

    const resultBase = {
      dryRun: input.dryRun,
      mode: input.mode,
      platform,
      tiers: input.tiers,
      leagueQueueType,
      division,
      pagesRequested,
      counters,
    } as const;

    // Dry-run and apply both obey the shared Riot cooldown precheck.
    if (this.sharedCooldown && (await this.sharedCooldown.isCoolingDown(Date.now()))) {
      return {
        ...resultBase,
        ok: true,
        stoppedReason: 'skipped_cooldown',
      };
    }

    let candidates: LadderCandidate[];
    try {
      candidates =
        input.mode === 'apex'
          ? await this.fetchApexCandidates({
              provider,
              platform,
              leagueQueueType,
              tiers: input.tiers,
              counters,
            })
          : await this.fetchRepresentativeCandidates({
              provider,
              platform,
              leagueQueueType,
              tiers: input.tiers,
              division: division!,
              pages: pagesRequested,
              counters,
            });
    } catch (error: unknown) {
      if (error instanceof ProviderRateLimitedError) {
        await this.publishSharedCooldown(error);
        return {
          ...resultBase,
          ok: false,
          stoppedReason: 'rate_limited',
          errorMessage: error.message,
        };
      }
      return {
        ...resultBase,
        ok: false,
        stoppedReason: 'provider_error',
        errorMessage: error instanceof Error ? error.message : 'Ladder provider fetch failed.',
      };
    }

    const processed = await this.processCandidates({
      candidates,
      platform,
      dryRun: input.dryRun,
      counters,
    });

    return {
      ...resultBase,
      ok: processed.stoppedReason !== 'rate_limited' && processed.stoppedReason !== 'provider_error',
      stoppedReason: processed.stoppedReason,
      ...(processed.errorMessage !== undefined ? { errorMessage: processed.errorMessage } : {}),
    };
  }

  private resolveProvider(override?: LadderSeedProvider): LadderSeedProvider {
    if (override) {
      return override;
    }
    if (isLadderProvider(this.gameData)) {
      return this.gameData;
    }
    throw new Error(
      'Ladder seed requires a provider with league-v4 ladder methods (RiotGameDataProvider / MockRiotGameDataProvider).',
    );
  }

  private resolveRepresentativePages(input: LadderSeedInput): number[] {
    const hardMax = this.config.ladderMaxPagesPerTierDivision;
    if (input.page !== undefined) {
      if (!Number.isInteger(input.page) || input.page < 1) {
        throw new Error('--page must be an integer >= 1.');
      }
      if (input.page > hardMax) {
        throw new Error(
          `--page ${input.page} exceeds COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION (${hardMax}).`,
        );
      }
      return [input.page];
    }

    const maxPages = input.maxPagesPerDivision ?? hardMax;
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      throw new Error('--max-pages-per-division must be an integer >= 1.');
    }
    const capped = Math.min(maxPages, hardMax);
    return Array.from({ length: capped }, (_, i) => i + 1);
  }

  private async fetchApexCandidates(input: {
    provider: LadderSeedProvider;
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType;
    tiers: RankTier[];
    counters: LadderSeedCounters;
  }): Promise<LadderCandidate[]> {
    const out: LadderCandidate[] = [];
    for (const tier of input.tiers) {
      const fetchOne = this.apexFetcher(input.provider, tier);
      input.counters.providerCalls += 1;
      const page = await fetchOne({
        platform: input.platform,
        leagueQueueType: input.leagueQueueType,
      });
      out.push(...page.candidates);
      input.counters.fetched += page.candidates.length;
      input.counters.apexCandidates += page.candidates.length;
      input.counters.byTier[tier] = (input.counters.byTier[tier] ?? 0) + page.candidates.length;
    }
    return out;
  }

  private apexFetcher(
    provider: LadderSeedProvider,
    tier: RankTier,
  ): (input: {
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType | string;
  }) => Promise<LadderCandidatesResult> {
    switch (tier) {
      case 'CHALLENGER':
        return (i) => provider.getChallengerLeague(i);
      case 'GRANDMASTER':
        return (i) => provider.getGrandmasterLeague(i);
      case 'MASTER':
        return (i) => provider.getMasterLeague(i);
      default:
        throw new Error(`Apex mode does not support tier ${tier}.`);
    }
  }

  /**
   * Bounded representative fetch: one getLeagueEntriesByTierDivision call per
   * tier × division × selected page. Stops paging a tier/division when
   * pageExhausted OR the finite page list is exhausted. Never pages until
   * create capacity is filled.
   */
  private async fetchRepresentativeCandidates(input: {
    provider: LadderSeedProvider;
    platform: PlatformRoute;
    leagueQueueType: RiotLeagueQueueType;
    tiers: RankTier[];
    division: RankDivision;
    pages: number[];
    counters: LadderSeedCounters;
  }): Promise<LadderCandidate[]> {
    const out: LadderCandidate[] = [];
    for (const tier of input.tiers) {
      for (const page of input.pages) {
        input.counters.providerCalls += 1;
        const result = await input.provider.getLeagueEntriesByTierDivision({
          platform: input.platform,
          leagueQueueType: input.leagueQueueType,
          tier,
          division: input.division,
          page,
        });
        out.push(...result.candidates);
        input.counters.fetched += result.candidates.length;
        input.counters.representativeCandidates += result.candidates.length;
        input.counters.byTier[tier] = (input.counters.byTier[tier] ?? 0) + result.candidates.length;
        if (result.pageExhausted) {
          break;
        }
      }
    }
    return out;
  }

  private async processCandidates(input: {
    candidates: LadderCandidate[];
    platform: PlatformRoute;
    dryRun: boolean;
    counters: LadderSeedCounters;
  }): Promise<{
    stoppedReason: LadderSeedResult['stoppedReason'];
    errorMessage?: string;
  }> {
    const seen = new Set<string>();
    const createCap = this.config.ladderMaxNewPerRun;
    const scanCeiling = this.config.ladderMaxCandidatesScanned;

    for (const candidate of input.candidates) {
      if (input.counters.created >= createCap) {
        return { stoppedReason: 'create_cap' };
      }
      if (input.counters.scanned >= scanCeiling) {
        return { stoppedReason: 'scan_ceiling' };
      }

      // 1) Platform filter (cheap)
      if (candidate.platformRoute !== input.platform) {
        input.counters.skippedPlatform += 1;
        continue;
      }
      if (!this.config.platformAllowlist.includes(candidate.platformRoute)) {
        input.counters.skippedPlatform += 1;
        continue;
      }
      if (
        this.config.ladderPlatform != null &&
        candidate.platformRoute !== this.config.ladderPlatform
      ) {
        input.counters.skippedPlatform += 1;
        continue;
      }

      // 2) Dedup PUUIDs within the run (duplicates do not consume create capacity)
      if (seen.has(candidate.puuid)) {
        continue;
      }
      seen.add(candidate.puuid);

      input.counters.eligible += 1;
      input.counters.scanned += 1;

      const needsResolve = await this.candidateNeedsIdentityResolve(candidate);

      if (input.dryRun) {
        // Read-only: already-tracked lookups OK. No Account-v1, no creates, no budget.
        const tracked = await this.findExistingTracked(candidate.puuid);
        if (tracked) {
          input.counters.alreadyTracked += 1;
          continue;
        }
        if (needsResolve) {
          input.counters.wouldNeedIdentityResolve += 1;
        }
        continue;
      }

      // 3) Enroll (may Account-v1 resolve). Stop when create cap reached —
      // do not keep resolving duplicates hoping for more creates.
      let enrollResult: EnrollLadderCandidateResult;
      try {
        enrollResult = await this.enrollment.enrollLadderCandidate({
          platformRoute: candidate.platformRoute,
          puuid: candidate.puuid,
          riotIdGameName: candidate.riotIdGameName,
          riotIdTagLine: candidate.riotIdTagLine,
        });
      } catch (error: unknown) {
        if (error instanceof ProviderRateLimitedError) {
          input.counters.errors += 1;
          await this.publishSharedCooldown(error);
          return {
            stoppedReason: 'rate_limited',
            errorMessage: error.message,
          };
        }
        input.counters.errors += 1;
        return {
          stoppedReason: 'provider_error',
          errorMessage: error instanceof Error ? error.message : 'Enrollment failed.',
        };
      }

      bumpOutcome(input.counters, enrollResult.outcome);

      if (needsResolve) {
        if (enrollResult.outcome === 'created') {
          input.counters.identityResolved += 1;
        } else if (
          enrollResult.outcome === 'skippedIdentity' ||
          enrollResult.outcome === 'error'
        ) {
          input.counters.identityResolveFailed += 1;
        }
      }

      if (enrollResult.outcome === 'created' && input.counters.created >= createCap) {
        return { stoppedReason: 'create_cap' };
      }
      if (enrollResult.outcome === 'skippedLadderCap') {
        return { stoppedReason: 'ladder_cap' };
      }
      if (enrollResult.outcome === 'skippedTotalCap') {
        return { stoppedReason: 'total_cap' };
      }
    }

    if (input.counters.created >= createCap) {
      return { stoppedReason: 'create_cap' };
    }
    if (input.counters.scanned >= scanCeiling) {
      return { stoppedReason: 'scan_ceiling' };
    }
    return { stoppedReason: null };
  }

  private async publishSharedCooldown(error: ProviderRateLimitedError): Promise<void> {
    if (!this.sharedCooldown) {
      return;
    }
    await this.sharedCooldown.extendCooldown({
      now: Date.now(),
      configuredFloorMs: this.config.riotShared429CooldownMinMs,
      retryAfterMs: retryAfterMsFromProviderRateLimited(error),
      source: 'ladder',
    });
  }

  private async candidateNeedsIdentityResolve(candidate: LadderCandidate): Promise<boolean> {
    if (hasUsableRiotNames(candidate.riotIdGameName, candidate.riotIdTagLine)) {
      return false;
    }
    const existing = await this.playerAccounts.findByProviderExternalId('RIOT', candidate.puuid);
    if (
      existing &&
      hasUsableRiotNames(existing.currentGameName, existing.currentTagLine)
    ) {
      return false;
    }
    return true;
  }

  private async findExistingTracked(puuid: string): Promise<boolean> {
    const existing = await this.playerAccounts.findByProviderExternalId('RIOT', puuid);
    if (!existing) {
      return false;
    }
    const tracked = await this.prisma.trackedPlayer.findUnique({
      where: { playerAccountId: existing.id },
    });
    return tracked != null;
  }
}
