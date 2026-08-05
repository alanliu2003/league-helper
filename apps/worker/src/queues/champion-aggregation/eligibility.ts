import {
  UNKNOWN_RANK_TIER_SENTINEL,
  type ExactChampionDimensions,
  type ExactChampionRankTier,
} from '@league-helper/match-analytics';
import {
  PlatformRouteSchema,
  RankTierSchema,
  RegionalRouteSchema,
  normalizeParticipantPosition,
  type NormalizedPosition,
} from '@league-helper/shared';

export type MatchEligibilityRow = {
  id: string;
  ingestionStatus: string;
  remake: boolean;
  normalizationVersion: string;
  normalizedPatch: string | null;
  platformRoute: string | null;
  regionalRoute: string;
  queueId: number;
  mapId: number | null;
  gameMode: string | null;
  gameCreation: Date;
  gameEndTimestamp: Date | null;
  gameDurationSeconds: number;
};

export type ParticipantEligibilityRow = {
  participantId: number;
  championId: number;
  teamId: number;
  teamPosition: string;
  individualPosition: string;
  lane: string | null;
  role: string | null;
  rankTierAtIngestion: string | null;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalCs: number;
  timePlayedSeconds: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
};

export type PermanentlyIneligibleReason =
  | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_COMPLETED'
  | 'MATCH_REMAKE'
  | 'SOURCE_NORMALIZATION_VERSION_MISMATCH'
  | 'MISSING_NORMALIZED_PATCH'
  | 'MISSING_PLATFORM_ROUTE'
  | 'INVALID_PLATFORM_ROUTE'
  | 'INVALID_REGIONAL_ROUTE'
  | 'INVALID_QUEUE_ID'
  | 'NO_ELIGIBLE_PARTICIPANTS';

export type EligibleContributor = {
  matchId: string;
  participantId: number;
  exact: ExactChampionDimensions;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalCs: number;
  gameSeconds: number;
  damageToChampions: number;
  visionScore: number;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  matchEndedAt: Date | null;
};

export type MatchEligibilityResult =
  | { eligible: false; reason: PermanentlyIneligibleReason }
  | {
      eligible: true;
      match: MatchEligibilityRow;
      contributors: EligibleContributor[];
      invalidRankTierCount: number;
    };

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

function resolveRankTier(
  raw: string | null,
): { tier: ExactChampionRankTier; invalid: boolean } {
  if (raw == null || raw.trim() === '') {
    return { tier: UNKNOWN_RANK_TIER_SENTINEL, invalid: false };
  }
  const parsed = RankTierSchema.safeParse(raw.trim().toUpperCase());
  if (!parsed.success) {
    if (raw === UNKNOWN_RANK_TIER_SENTINEL) {
      return { tier: UNKNOWN_RANK_TIER_SENTINEL, invalid: false };
    }
    return { tier: UNKNOWN_RANK_TIER_SENTINEL, invalid: true };
  }
  return { tier: parsed.data, invalid: false };
}

export function resolveMatchEndedAtFromRow(match: MatchEligibilityRow): Date | null {
  if (match.gameEndTimestamp instanceof Date && Number.isFinite(match.gameEndTimestamp.getTime())) {
    return match.gameEndTimestamp;
  }
  if (
    match.gameCreation instanceof Date &&
    Number.isFinite(match.gameCreation.getTime()) &&
    typeof match.gameDurationSeconds === 'number' &&
    Number.isFinite(match.gameDurationSeconds) &&
    match.gameDurationSeconds > 0
  ) {
    return new Date(match.gameCreation.getTime() + match.gameDurationSeconds * 1000);
  }
  return null;
}

export function normalizeEligiblePosition(
  match: MatchEligibilityRow,
  participant: ParticipantEligibilityRow,
): NormalizedPosition {
  return normalizeParticipantPosition({
    queueId: match.queueId,
    mapId: match.mapId,
    gameMode: match.gameMode,
    remake: match.remake,
    teamPosition: participant.teamPosition,
    individualPosition: participant.individualPosition,
    lane: participant.lane,
    role: participant.role,
  });
}

export function isStructurallyValidParticipant(participant: ParticipantEligibilityRow): boolean {
  if (!(participant.championId > 0) || !Number.isInteger(participant.championId)) {
    return false;
  }
  if (typeof participant.win !== 'boolean') {
    return false;
  }
  return (
    isNonNegativeInteger(participant.kills) &&
    isNonNegativeInteger(participant.deaths) &&
    isNonNegativeInteger(participant.assists) &&
    isNonNegativeInteger(participant.totalCs) &&
    isNonNegativeInteger(participant.timePlayedSeconds) &&
    isNonNegativeInteger(participant.totalDamageDealtToChampions) &&
    isNonNegativeInteger(participant.visionScore)
  );
}

/**
 * Match-level permanent ineligibility (no processing marker required).
 * Version mismatch / remake / incomplete / missing structural match dims.
 */
export function evaluateMatchEligibility(
  match: MatchEligibilityRow | null,
  participants: ParticipantEligibilityRow[],
  versions: { sourceNormalizationVersion: string; aggregationVersion: string },
): MatchEligibilityResult {
  if (!match) {
    return { eligible: false, reason: 'MATCH_NOT_FOUND' };
  }
  if (match.ingestionStatus !== 'COMPLETED') {
    return { eligible: false, reason: 'MATCH_NOT_COMPLETED' };
  }
  if (match.remake) {
    return { eligible: false, reason: 'MATCH_REMAKE' };
  }
  if (match.normalizationVersion !== versions.sourceNormalizationVersion) {
    return { eligible: false, reason: 'SOURCE_NORMALIZATION_VERSION_MISMATCH' };
  }
  if (!match.normalizedPatch || match.normalizedPatch.trim() === '') {
    return { eligible: false, reason: 'MISSING_NORMALIZED_PATCH' };
  }
  if (!match.platformRoute || match.platformRoute.trim() === '') {
    return { eligible: false, reason: 'MISSING_PLATFORM_ROUTE' };
  }
  const platform = PlatformRouteSchema.safeParse(match.platformRoute);
  if (!platform.success) {
    return { eligible: false, reason: 'INVALID_PLATFORM_ROUTE' };
  }
  const regional = RegionalRouteSchema.safeParse(match.regionalRoute);
  if (!regional.success) {
    return { eligible: false, reason: 'INVALID_REGIONAL_ROUTE' };
  }
  if (!Number.isInteger(match.queueId) || match.queueId < 0) {
    return { eligible: false, reason: 'INVALID_QUEUE_ID' };
  }

  const matchEndedAt = resolveMatchEndedAtFromRow(match);
  const contributors: EligibleContributor[] = [];
  let invalidRankTierCount = 0;

  for (const participant of participants) {
    if (!isStructurallyValidParticipant(participant)) {
      continue;
    }
    const rank = resolveRankTier(participant.rankTierAtIngestion);
    if (rank.invalid) {
      invalidRankTierCount += 1;
    }
    const position = normalizeEligiblePosition(match, participant);
    contributors.push({
      matchId: match.id,
      participantId: participant.participantId,
      exact: {
        patch: match.normalizedPatch,
        platformRoute: platform.data,
        regionalRoute: regional.data,
        queueId: match.queueId,
        rankTier: rank.tier,
        position,
        championId: participant.championId,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
      },
      won: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      totalCs: participant.totalCs,
      gameSeconds: participant.timePlayedSeconds,
      damageToChampions: participant.totalDamageDealtToChampions,
      visionScore: participant.visionScore,
      goldDifferenceAt10: participant.goldDifferenceAt10,
      goldDifferenceAt15: participant.goldDifferenceAt15,
      csDifferenceAt10: participant.csDifferenceAt10,
      csDifferenceAt15: participant.csDifferenceAt15,
      matchEndedAt,
    });
  }

  if (contributors.length === 0) {
    return { eligible: false, reason: 'NO_ELIGIBLE_PARTICIPANTS' };
  }

  return {
    eligible: true,
    match,
    contributors,
    invalidRankTierCount,
  };
}
