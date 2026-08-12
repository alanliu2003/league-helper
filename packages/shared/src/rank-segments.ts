import { RankTierSchema, type RankTier } from './ranks';

/**
 * Coverage / representation segment vocabulary (M12-v2).
 *
 * Goal: representation exists per segment — not equal sampling.
 * Apex must mean Challenger + Grandmaster + Master (never Challenger-only).
 */
export const RANK_SEGMENT_IDS = ['APEX', 'HIGH', 'MID', 'LOW'] as const;

export type RankSegmentId = (typeof RANK_SEGMENT_IDS)[number];

export const RANK_SEGMENTS = {
  APEX: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
  HIGH: ['DIAMOND', 'EMERALD', 'PLATINUM'],
  MID: ['GOLD'],
  LOW: ['SILVER', 'BRONZE', 'IRON'],
} as const satisfies Record<RankSegmentId, readonly RankTier[]>;

export type RankSegmentTiers<S extends RankSegmentId> = (typeof RANK_SEGMENTS)[S][number];

/** Flat Apex tier list for ladder / coverage allowlists. */
export const APEX_RANK_TIERS = RANK_SEGMENTS.APEX;

/** Flat High tier list (Diamond / Emerald / Platinum). */
export const HIGH_RANK_TIERS = RANK_SEGMENTS.HIGH;

/** Flat Mid tier list (Gold). */
export const MID_RANK_TIERS = RANK_SEGMENTS.MID;

/** Flat Low tier list (Silver / Bronze / Iron). */
export const LOW_RANK_TIERS = RANK_SEGMENTS.LOW;

const TIER_TO_SEGMENT: Readonly<Record<RankTier, RankSegmentId>> = {
  CHALLENGER: 'APEX',
  GRANDMASTER: 'APEX',
  MASTER: 'APEX',
  DIAMOND: 'HIGH',
  EMERALD: 'HIGH',
  PLATINUM: 'HIGH',
  GOLD: 'MID',
  SILVER: 'LOW',
  BRONZE: 'LOW',
  IRON: 'LOW',
};

export function rankSegmentForTier(tier: RankTier): RankSegmentId {
  return TIER_TO_SEGMENT[tier];
}

export function parseRankSegmentId(raw: string): RankSegmentId {
  const normalized = raw.trim().toUpperCase();
  if ((RANK_SEGMENT_IDS as readonly string[]).includes(normalized)) {
    return normalized as RankSegmentId;
  }
  throw new Error(`Unsupported rank segment "${raw}". Allowed: ${RANK_SEGMENT_IDS.join(', ')}.`);
}

/** True when every Apex tier is present with a positive count. */
export function hasCompleteApexRepresentation(
  countsByTier: Readonly<Partial<Record<RankTier, number>>>,
): boolean {
  return APEX_RANK_TIERS.every((tier) => (countsByTier[tier] ?? 0) > 0);
}

/** Validate a tier belongs to the expected segment. */
export function assertTierInSegment(tier: RankTier, segment: RankSegmentId): void {
  const parsed = RankTierSchema.parse(tier);
  if (rankSegmentForTier(parsed) !== segment) {
    throw new Error(`Tier ${parsed} is not in segment ${segment}.`);
  }
}
