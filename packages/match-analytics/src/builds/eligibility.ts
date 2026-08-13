/**
 * Per-participant build-source eligibility.
 *
 * Missing timeline is not an empty build. Source-unavailable zeros are not inventory.
 * A participant may be eligible for one category and ineligible for another.
 */

import { isSkillPriorityEligible, resolveSkillLevelSlots } from './skill-order';

export const BUILD_SOURCE_COMPLETE = 'BUILD_SOURCE_COMPLETE';
export const BUILD_SOURCE_PARTIAL = 'BUILD_SOURCE_PARTIAL';

export type BuildSourceCompleteness = typeof BUILD_SOURCE_COMPLETE | typeof BUILD_SOURCE_PARTIAL;

export type BuildTimelineEventInput = {
  type: string;
  timestampMs: number;
  eventIndex: number;
  participantId?: number | null;
  itemId?: number | null;
  beforeItemId?: number | null;
  afterItemId?: number | null;
  skillSlot?: number | null;
  levelUpType?: string | null;
};

export type BuildParticipantSource = {
  itemIds: readonly number[];
  perkIds: readonly number[];
  statPerkIds: readonly number[];
  primaryPerkStyleId: number | null;
  secondaryPerkStyleId: number | null;
  summonerSpell1Id: number;
  summonerSpell2Id: number;
  skillOrder: readonly number[];
  timelineEvents: readonly BuildTimelineEventInput[];
};

export type BuildSourceEligibility = {
  itemFinalStateEligible: boolean;
  itemFinalStateComplete: boolean;
  itemTimelineEligible: boolean;
  runeEligible: boolean;
  runeStylesComplete: boolean;
  spellEligible: boolean;
  skillSequenceEligible: boolean;
  skillPriorityEligible: boolean;
  skillOrderEligible: boolean;
  missingTimeline: boolean;
  sourceCompleteness: BuildSourceCompleteness;
};

function hasPositiveItem(itemIds: readonly number[]): boolean {
  return itemIds.some((id) => id > 0);
}

function hasItemPurchase(events: readonly BuildTimelineEventInput[]): boolean {
  return events.some((event) => event.type === 'ITEM_PURCHASED' && (event.itemId ?? 0) > 0);
}

export function assessBuildSourceEligibility(
  source: BuildParticipantSource,
): BuildSourceEligibility {
  const itemFinalStateEligible = hasPositiveItem(source.itemIds);
  const itemFinalStateComplete = source.itemIds.length === 7 && itemFinalStateEligible;
  const itemTimelineEligible = hasItemPurchase(source.timelineEvents);
  const missingTimeline = !itemTimelineEligible;
  const runeEligible = source.perkIds.filter((id) => id > 0).length >= 4;
  const runeStylesComplete =
    source.primaryPerkStyleId !== null &&
    source.primaryPerkStyleId > 0 &&
    source.secondaryPerkStyleId !== null &&
    source.secondaryPerkStyleId > 0;
  const spellEligible = source.summonerSpell1Id > 0 && source.summonerSpell2Id > 0;
  const skillSlots = resolveSkillLevelSlots(source);
  const skillSequenceEligible = skillSlots.length > 0;
  const skillPriorityEligible = isSkillPriorityEligible(skillSlots);
  const skillOrderEligible = skillSequenceEligible;

  const fullyPreserved =
    itemFinalStateComplete &&
    itemTimelineEligible &&
    runeEligible &&
    runeStylesComplete &&
    spellEligible &&
    skillSequenceEligible;

  return {
    itemFinalStateEligible,
    itemFinalStateComplete,
    itemTimelineEligible,
    runeEligible,
    runeStylesComplete,
    spellEligible,
    skillSequenceEligible,
    skillPriorityEligible,
    skillOrderEligible,
    missingTimeline,
    sourceCompleteness: fullyPreserved ? BUILD_SOURCE_COMPLETE : BUILD_SOURCE_PARTIAL,
  };
}
