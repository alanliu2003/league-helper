import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  RankDivisionSchema,
  RankTierSchema,
  ValidationFailureError,
  parsePlatformRoute,
  type PlatformRoute,
  type RankDivision,
  type RankTier,
} from '@league-helper/shared';
import { z } from 'zod';
import type { RiotLeagueEntryDto, RiotLeagueListDto } from './riot-api.schemas';

/** Official league-v4 queue path/query values (string — not match-v5 queueId). */
export const RiotLeagueQueueTypeSchema = z.enum([
  'RANKED_SOLO_5x5',
  'RANKED_FLEX_SR',
  'RANKED_FLEX_TT',
]);

export type RiotLeagueQueueType = z.infer<typeof RiotLeagueQueueTypeSchema>;

export const RIOT_LEAGUE_QUEUE_RANKED_SOLO: RiotLeagueQueueType = 'RANKED_SOLO_5x5';

/**
 * Explicit league-queue-string → match-v5 queueId mapping for queues this repo already models.
 * RANKED_FLEX_TT is a valid league-v4 path value but has no match-queue constant here — refuse to invent one.
 */
const RIOT_LEAGUE_QUEUE_TO_MATCH_QUEUE_ID: Readonly<Partial<Record<RiotLeagueQueueType, number>>> = {
  RANKED_SOLO_5x5: RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_SR: RANKED_FLEX_QUEUE_ID,
};

/** Tiers accepted by GET /lol/league/v4/entries/{queue}/{tier}/{division}. */
export const RiotPaginatedLeagueTierSchema = z.enum([
  'DIAMOND',
  'EMERALD',
  'PLATINUM',
  'GOLD',
  'SILVER',
  'BRONZE',
  'IRON',
]);

export type RiotPaginatedLeagueTier = z.infer<typeof RiotPaginatedLeagueTierSchema>;

export type LadderAcquisitionMode = 'APEX' | 'REPRESENTATIVE';

export type ApexLeagueKind = 'challenger' | 'grandmaster' | 'master';

/**
 * Provider-level ladder candidate (Riot acquisition only).
 * Not a TrackedPlayer / CollectorRun persistence model.
 */
export type LadderCandidate = {
  provider: 'RIOT';
  platformRoute: PlatformRoute;
  /** Riot league-v4 queue string (e.g. RANKED_SOLO_5x5). */
  leagueQueueType: RiotLeagueQueueType;
  /** Explicitly mapped match-v5 queue id (e.g. 420 for ranked solo). */
  matchQueueId: number;
  tier: RankTier;
  division: RankDivision | null;
  /** Canonical external identity for later dedup: provider + puuid. */
  puuid: string;
  /**
   * Current official league-v4 DTOs do not include Riot ID fields.
   * Reserved as null for forward-compat if Riot adds them later.
   */
  riotIdGameName: string | null;
  riotIdTagLine: string | null;
  acquisitionMode: LadderAcquisitionMode;
  /** Present for representative tier pages; null for apex league-lists. */
  page: number | null;
};

export type LadderCandidatesResult = {
  candidates: LadderCandidate[];
  skippedIncompleteIdentity: number;
};

export type LadderEntriesPageResult = LadderCandidatesResult & {
  /**
   * Operational signal for Phase 2: empty page means no further pages for that
   * queue/tier/division. Riot docs do not publish a fixed page size.
   */
  pageExhausted: boolean;
  page: number;
};

export function mapRiotLeagueQueueTypeToMatchQueueId(queueType: string): number {
  const parsed = RiotLeagueQueueTypeSchema.safeParse(queueType);
  if (!parsed.success) {
    throw new ValidationFailureError('Unsupported Riot league queue type.', { queueType });
  }
  const matchQueueId = RIOT_LEAGUE_QUEUE_TO_MATCH_QUEUE_ID[parsed.data];
  if (matchQueueId === undefined) {
    throw new ValidationFailureError(
      'No explicit match queueId mapping for this Riot league queue type.',
      { queueType: parsed.data },
    );
  }
  return matchQueueId;
}

export function parseRiotLeagueQueueType(queueType: string): RiotLeagueQueueType {
  const parsed = RiotLeagueQueueTypeSchema.safeParse(queueType);
  if (!parsed.success) {
    throw new ValidationFailureError('Unsupported Riot league queue type.', { queueType });
  }
  return parsed.data;
}

export function buildApexLeaguePath(kind: ApexLeagueKind, leagueQueueType: string): string {
  const queue = parseRiotLeagueQueueType(leagueQueueType);
  const segment =
    kind === 'challenger'
      ? 'challengerleagues'
      : kind === 'grandmaster'
        ? 'grandmasterleagues'
        : 'masterleagues';
  return `/lol/league/v4/${segment}/by-queue/${encodeURIComponent(queue)}`;
}

export function buildLeagueEntriesByTierDivisionPath(input: {
  queue: string;
  tier: string;
  division: string;
}): string {
  const queue = parseRiotLeagueQueueType(input.queue);
  const tier = RiotPaginatedLeagueTierSchema.parse(input.tier);
  const division = RankDivisionSchema.parse(input.division);
  return `/lol/league/v4/entries/${encodeURIComponent(queue)}/${encodeURIComponent(tier)}/${encodeURIComponent(division)}`;
}

export function mapLeagueListToLadderCandidates(input: {
  list: RiotLeagueListDto;
  platformRoute: PlatformRoute;
  acquisitionMode: LadderAcquisitionMode;
}): LadderCandidatesResult {
  const platformRoute = parsePlatformRoute(input.platformRoute);
  const leagueQueueType = parseRiotLeagueQueueType(input.list.queue);
  const matchQueueId = mapRiotLeagueQueueTypeToMatchQueueId(leagueQueueType);
  const tierParsed = RankTierSchema.safeParse(input.list.tier?.toUpperCase());
  if (!tierParsed.success) {
    throw new ValidationFailureError('Apex league list returned an unsupported tier.', {
      tier: input.list.tier,
    });
  }
  const tier = tierParsed.data;

  const candidates: LadderCandidate[] = [];
  let skippedIncompleteIdentity = 0;

  for (const entry of input.list.entries) {
    const puuid = normalizePuuid(entry.puuid);
    if (!puuid) {
      skippedIncompleteIdentity += 1;
      continue;
    }

    const divisionParsed = RankDivisionSchema.safeParse(entry.rank);
    candidates.push({
      provider: 'RIOT',
      platformRoute,
      leagueQueueType,
      matchQueueId,
      tier,
      division: divisionParsed.success ? divisionParsed.data : null,
      puuid,
      riotIdGameName: null,
      riotIdTagLine: null,
      acquisitionMode: input.acquisitionMode,
      page: null,
    });
  }

  return { candidates, skippedIncompleteIdentity };
}

export function mapLeagueEntriesToLadderCandidates(input: {
  entries: RiotLeagueEntryDto[];
  platformRoute: PlatformRoute;
  acquisitionMode: LadderAcquisitionMode;
  page: number;
}): LadderCandidatesResult {
  const platformRoute = parsePlatformRoute(input.platformRoute);
  const candidates: LadderCandidate[] = [];
  let skippedIncompleteIdentity = 0;

  for (const entry of input.entries) {
    const puuid = normalizePuuid(entry.puuid);
    if (!puuid) {
      skippedIncompleteIdentity += 1;
      continue;
    }

    let leagueQueueType: RiotLeagueQueueType;
    try {
      leagueQueueType = parseRiotLeagueQueueType(entry.queueType);
    } catch {
      skippedIncompleteIdentity += 1;
      continue;
    }

    const tierParsed = RankTierSchema.safeParse(entry.tier?.toUpperCase());
    if (!tierParsed.success) {
      skippedIncompleteIdentity += 1;
      continue;
    }

    const divisionParsed = RankDivisionSchema.safeParse(entry.rank);
    candidates.push({
      provider: 'RIOT',
      platformRoute,
      leagueQueueType,
      matchQueueId: mapRiotLeagueQueueTypeToMatchQueueId(leagueQueueType),
      tier: tierParsed.data,
      division: divisionParsed.success ? divisionParsed.data : null,
      puuid,
      riotIdGameName: null,
      riotIdTagLine: null,
      acquisitionMode: input.acquisitionMode,
      page: input.page,
    });
  }

  return { candidates, skippedIncompleteIdentity };
}

function normalizePuuid(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
