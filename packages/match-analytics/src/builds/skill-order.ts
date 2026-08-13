export const SKILL_SLOT_KEYS = ['Q', 'W', 'E', 'R'] as const;
export type SkillKey = (typeof SKILL_SLOT_KEYS)[number];
export type BasicSkillKey = Exclude<SkillKey, 'R'>;

export const CANONICAL_SKILL_PRIORITY_SIGNATURES = [
  'Q>W>E',
  'Q>E>W',
  'W>Q>E',
  'W>E>Q',
  'E>Q>W',
  'E>W>Q',
] as const;
export type SkillPrioritySignature = (typeof CANONICAL_SKILL_PRIORITY_SIGNATURES)[number];

export type SkillSequence = {
  slots: number[];
  keys: SkillKey[];
  signature: string;
};

export type SkillPriority = {
  keys: [BasicSkillKey, BasicSkillKey, BasicSkillKey];
  signature: SkillPrioritySignature;
};

/** @deprecated Use SkillPriority. Kept as a compatible shape for first-learned order. */
export type AbilityMaxOrder = {
  keys: BasicSkillKey[];
  signature: string;
};

const SLOT_TO_KEY: Readonly<Record<number, SkillKey>> = {
  1: 'Q',
  2: 'W',
  3: 'E',
  4: 'R',
};

const BASIC_SLOTS = [1, 2, 3] as const;
const BASIC_MAX_RANK = 5;
const PRIORITY_RANK_FLOOR = 2;

function isBasicSlot(slot: number): slot is (typeof BASIC_SLOTS)[number] {
  return slot === 1 || slot === 2 || slot === 3;
}

function basicKey(slot: number): BasicSkillKey | null {
  const key = SLOT_TO_KEY[slot];
  return key === 'Q' || key === 'W' || key === 'E' ? key : null;
}

export function skillSlotToKey(slot: number): SkillKey | null {
  return SLOT_TO_KEY[slot] ?? null;
}

export function deriveSkillSequence(skillSlots: readonly number[]): SkillSequence {
  const slots = skillSlots.filter((slot) => skillSlotToKey(slot) !== null);
  const keys = slots.map((slot) => skillSlotToKey(slot)!);
  return {
    slots,
    keys,
    signature: keys.join('-'),
  };
}

/**
 * First time each basic ability is learned. Not max priority.
 * E W Q at levels 1–3 is first-learned, even if W is prioritized for maxing.
 */
export function deriveFirstLearnedBasicOrder(skillSlots: readonly number[]): AbilityMaxOrder {
  const seen = new Set<number>();
  const keys: BasicSkillKey[] = [];
  for (const slot of skillSlots) {
    if (!isBasicSlot(slot) || seen.has(slot)) {
      continue;
    }
    const key = basicKey(slot);
    if (key) {
      seen.add(slot);
      keys.push(key);
    }
  }
  return {
    keys,
    signature: keys.join('>'),
  };
}

type RankProgress = {
  finalRank: Map<number, number>;
  firstReached: Map<string, number>;
};

function rankProgress(skillSlots: readonly number[]): RankProgress {
  const finalRank = new Map<number, number>(BASIC_SLOTS.map((slot) => [slot, 0]));
  const firstReached = new Map<string, number>();

  skillSlots.forEach((slot, index) => {
    if (!isBasicSlot(slot)) {
      return;
    }
    const next = (finalRank.get(slot) ?? 0) + 1;
    finalRank.set(slot, next);
    const key = `${slot}:${next}`;
    if (!firstReached.has(key)) {
      firstReached.set(key, index);
    }
  });

  return { finalRank, firstReached };
}

function reachedIndex(progress: RankProgress, slot: number, rank: number): number {
  return progress.firstReached.get(`${slot}:${rank}`) ?? Number.POSITIVE_INFINITY;
}

/**
 * Higher investment first. Rank-1 unlock timing does not break ties.
 * 0 = indistinguishable.
 */
function compareSkillPriority(progress: RankProgress, left: number, right: number): number {
  const rankLeft = progress.finalRank.get(left) ?? 0;
  const rankRight = progress.finalRank.get(right) ?? 0;
  if (rankLeft !== rankRight) {
    return rankRight - rankLeft;
  }
  if (rankLeft < PRIORITY_RANK_FLOOR) {
    return 0;
  }
  for (
    let target = Math.min(rankLeft, BASIC_MAX_RANK);
    target >= PRIORITY_RANK_FLOOR;
    target -= 1
  ) {
    const leftIndex = reachedIndex(progress, left, target);
    const rightIndex = reachedIndex(progress, right, target);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
  }
  return 0;
}

function isCanonicalPrioritySignature(value: string): value is SkillPrioritySignature {
  return (CANONICAL_SKILL_PRIORITY_SIGNATURES as readonly string[]).includes(value);
}

/**
 * Basic ability max priority for Q/W/E. R is ignored.
 * Eligible only when investment produces a strict total order of all three.
 */
export function deriveSkillPriority(skillSlots: readonly number[]): SkillPriority | null {
  const progress = rankProgress(skillSlots);

  for (let i = 0; i < BASIC_SLOTS.length; i += 1) {
    for (let j = i + 1; j < BASIC_SLOTS.length; j += 1) {
      if (compareSkillPriority(progress, BASIC_SLOTS[i]!, BASIC_SLOTS[j]!) === 0) {
        return null;
      }
    }
  }

  const orderedSlots = [...BASIC_SLOTS].sort((left, right) =>
    compareSkillPriority(progress, left, right),
  );
  const keys = orderedSlots
    .map((slot) => basicKey(slot))
    .filter((key): key is BasicSkillKey => key !== null);
  if (keys.length !== 3) {
    return null;
  }

  const signature = keys.join('>');
  if (!isCanonicalPrioritySignature(signature)) {
    return null;
  }

  return {
    keys: [keys[0]!, keys[1]!, keys[2]!],
    signature,
  };
}

export function isSkillPriorityEligible(skillSlots: readonly number[]): boolean {
  return deriveSkillPriority(skillSlots) !== null;
}

/** @deprecated Use deriveSkillPriority. */
export function deriveAbilityMaxOrder(skillSlots: readonly number[]): AbilityMaxOrder {
  const priority = deriveSkillPriority(skillSlots);
  if (!priority) {
    return { keys: [], signature: '' };
  }
  return { keys: [...priority.keys], signature: priority.signature };
}

/** @deprecated Use isSkillPriorityEligible. */
export function isSkillMaxOrderEligible(skillSlots: readonly number[]): boolean {
  return isSkillPriorityEligible(skillSlots);
}

export function skillSlotsFromTimeline(
  events: readonly {
    type: string;
    timestampMs: number;
    eventIndex: number;
    skillSlot?: number | null;
  }[],
): number[] {
  return [...events]
    .filter((event) => event.type === 'SKILL_LEVEL_UP' && typeof event.skillSlot === 'number')
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }
      return left.eventIndex - right.eventIndex;
    })
    .map((event) => event.skillSlot!)
    .filter((slot) => skillSlotToKey(slot) !== null);
}

/**
 * Prefer the longer of timeline SKILL_LEVEL_UP vs persisted skillOrder.
 * Equal length prefers timeline so a truncated first-learned array cannot
 * starve priority reconstruction. A truncated timeline cannot starve a
 * longer stored sequence.
 */
export function resolveSkillLevelSlots(source: {
  skillOrder: readonly number[];
  timelineEvents: readonly {
    type: string;
    timestampMs: number;
    eventIndex: number;
    skillSlot?: number | null;
  }[];
}): number[] {
  const fromTimeline = skillSlotsFromTimeline(source.timelineEvents);
  const fromStored = source.skillOrder.filter((slot) => skillSlotToKey(slot) !== null);
  if (fromTimeline.length >= fromStored.length && fromTimeline.length > 0) {
    return fromTimeline;
  }
  if (fromStored.length > 0) {
    return fromStored;
  }
  return fromTimeline;
}
