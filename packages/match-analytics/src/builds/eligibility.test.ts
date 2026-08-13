import { describe, expect, it } from 'vitest';
import { assessBuildSourceEligibility, type BuildParticipantSource } from './eligibility';

function source(overrides: Partial<BuildParticipantSource> = {}): BuildParticipantSource {
  return {
    itemIds: [1056, 2003, 0, 0, 0, 0, 3340],
    perkIds: [8112, 8126, 8138, 8135, 8226, 8233],
    statPerkIds: [5008, 5008, 5001],
    primaryPerkStyleId: 8100,
    secondaryPerkStyleId: 8200,
    summonerSpell1Id: 4,
    summonerSpell2Id: 12,
    skillOrder: [1, 2, 3, 1, 1, 4],
    timelineEvents: [
      { type: 'ITEM_PURCHASED', timestampMs: 0, eventIndex: 0, participantId: 1, itemId: 1056 },
    ],
    ...overrides,
  };
}

describe('assessBuildSourceEligibility', () => {
  it('marks complete 7-slot inventory as ITEM_FINAL_STATE_ELIGIBLE and COMPLETE', () => {
    const result = assessBuildSourceEligibility(source());
    expect(result.itemFinalStateEligible).toBe(true);
    expect(result.itemFinalStateComplete).toBe(true);
    expect(result.sourceCompleteness).toBe('BUILD_SOURCE_COMPLETE');
  });

  it('treats collapsed historical itemIds as final-state eligible but not complete', () => {
    const result = assessBuildSourceEligibility(
      source({
        itemIds: [1056, 3040, 3089],
        timelineEvents: [],
        primaryPerkStyleId: null,
        secondaryPerkStyleId: null,
      }),
    );
    expect(result.itemFinalStateEligible).toBe(true);
    expect(result.itemFinalStateComplete).toBe(false);
    expect(result.itemTimelineEligible).toBe(false);
    expect(result.sourceCompleteness).toBe('BUILD_SOURCE_PARTIAL');
  });

  it('does not treat missing timeline as an empty build', () => {
    const result = assessBuildSourceEligibility(source({ timelineEvents: [] }));
    expect(result.itemTimelineEligible).toBe(false);
    expect(result.itemFinalStateEligible).toBe(true);
    expect(result.missingTimeline).toBe(true);
  });

  it('requires an ITEM_PURCHASED event for ITEM_TIMELINE_ELIGIBLE', () => {
    const withoutPurchase = assessBuildSourceEligibility(
      source({
        timelineEvents: [
          { type: 'SKILL_LEVEL_UP', timestampMs: 0, eventIndex: 0, participantId: 1, skillSlot: 1 },
        ],
      }),
    );
    expect(withoutPurchase.itemTimelineEligible).toBe(false);
    expect(withoutPurchase.skillOrderEligible).toBe(true);

    const withPurchase = assessBuildSourceEligibility(source());
    expect(withPurchase.itemTimelineEligible).toBe(true);
  });

  it('is RUNE_ELIGIBLE from perk selections even when style IDs are missing', () => {
    const result = assessBuildSourceEligibility(
      source({ primaryPerkStyleId: null, secondaryPerkStyleId: null }),
    );
    expect(result.runeEligible).toBe(true);
    expect(result.runeStylesComplete).toBe(false);
  });

  it('is not RUNE_ELIGIBLE when perk selections are missing', () => {
    const result = assessBuildSourceEligibility(source({ perkIds: [], statPerkIds: [] }));
    expect(result.runeEligible).toBe(false);
  });

  it('is SPELL_ELIGIBLE only when both summoner spell IDs are present', () => {
    expect(assessBuildSourceEligibility(source()).spellEligible).toBe(true);
    expect(assessBuildSourceEligibility(source({ summonerSpell2Id: 0 })).spellEligible).toBe(false);
  });

  it('is SKILL_SEQUENCE eligible from persisted skillOrder without timeline events', () => {
    const result = assessBuildSourceEligibility(source({ timelineEvents: [] }));
    expect(result.skillSequenceEligible).toBe(true);
    expect(result.skillPriorityEligible).toBe(false);
    expect(result.skillOrderEligible).toBe(true);
  });

  it('is SKILL_SEQUENCE eligible from SKILL_LEVEL_UP events when skillOrder is empty', () => {
    const result = assessBuildSourceEligibility(
      source({
        skillOrder: [],
        timelineEvents: [
          {
            type: 'SKILL_LEVEL_UP',
            timestampMs: 10,
            eventIndex: 0,
            participantId: 1,
            skillSlot: 1,
          },
        ],
      }),
    );
    expect(result.skillSequenceEligible).toBe(true);
    expect(result.skillPriorityEligible).toBe(false);
  });

  it('is not skill eligible when SKILL_LEVEL_UP events and skillOrder are missing', () => {
    const result = assessBuildSourceEligibility(source({ skillOrder: [], timelineEvents: [] }));
    expect(result.skillSequenceEligible).toBe(false);
    expect(result.skillPriorityEligible).toBe(false);
  });

  it('is SKILL_PRIORITY eligible from W5 E3 Q1 even when E was learned first', () => {
    const slots = [3, 2, 1, 2, 2, 4, 2, 3, 2, 3];
    const result = assessBuildSourceEligibility(
      source({
        skillOrder: [],
        timelineEvents: slots.map((skillSlot, eventIndex) => ({
          type: 'SKILL_LEVEL_UP',
          timestampMs: eventIndex * 1000,
          eventIndex,
          skillSlot,
        })),
      }),
    );
    expect(result.skillSequenceEligible).toBe(true);
    expect(result.skillPriorityEligible).toBe(true);
  });

  it('is not SKILL_PRIORITY eligible when Q/W/E ranks are ambiguous', () => {
    const result = assessBuildSourceEligibility(
      source({ skillOrder: [1, 2, 3], timelineEvents: [] }),
    );
    expect(result.skillPriorityEligible).toBe(false);
  });

  it('does not treat source-unavailable zeros as a real inventory', () => {
    const result = assessBuildSourceEligibility(
      source({
        itemIds: [0, 0, 0, 0, 0, 0, 0],
        timelineEvents: [],
      }),
    );
    expect(result.itemFinalStateEligible).toBe(false);
  });
});
