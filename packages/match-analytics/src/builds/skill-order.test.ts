import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SKILL_PRIORITY_SIGNATURES,
  deriveFirstLearnedBasicOrder,
  deriveSkillPriority,
  deriveSkillSequence,
  isSkillPriorityEligible,
  resolveSkillLevelSlots,
} from './skill-order';
import type { BuildParticipantSource } from './eligibility';

/** Sylas-like: E first, but W invested first for maxing. */
const SYLAS_LEVEL_SLOTS = [3, 2, 1, 2, 2, 4, 2, 3, 2, 3, 4, 3, 3, 1, 1, 4, 1, 1];

function source(
  overrides: Partial<BuildParticipantSource> = {},
): Pick<BuildParticipantSource, 'skillOrder' | 'timelineEvents'> {
  return {
    skillOrder: [],
    timelineEvents: [],
    ...overrides,
  };
}

describe('skill priority', () => {
  it('maps skill slots to Q/W/E/R and ignores invalid slots', () => {
    expect(deriveSkillSequence([1, 2, 3, 1, 1, 4, 0, 9])).toEqual({
      slots: [1, 2, 3, 1, 1, 4],
      keys: ['Q', 'W', 'E', 'Q', 'Q', 'R'],
      signature: 'Q-W-E-Q-Q-R',
    });
  });

  it('derives W>E>Q when first learned is E>W>Q and final ranks are W5 E3 Q1', () => {
    const slots = [3, 2, 1, 2, 2, 4, 2, 3, 2, 3];
    const firstLearned = deriveFirstLearnedBasicOrder(slots);
    const priority = deriveSkillPriority(slots);
    expect(firstLearned).toEqual({ keys: ['E', 'W', 'Q'], signature: 'E>W>Q' });
    expect(priority).toEqual({ keys: ['W', 'E', 'Q'], signature: 'W>E>Q' });
  });

  it('derives Q>W>E when first learned is W>Q>E and final ranks are Q5 W3 E1', () => {
    const slots = [2, 1, 3, 1, 1, 4, 1, 2, 1, 2];
    expect(deriveFirstLearnedBasicOrder(slots).signature).toBe('W>Q>E');
    expect(deriveSkillPriority(slots)).toEqual({
      keys: ['Q', 'W', 'E'],
      signature: 'Q>W>E',
    });
  });

  it('derives Q>W>E when nobody reaches rank 5 if ranks are Q4 W3 E1', () => {
    expect(deriveSkillPriority([1, 2, 3, 1, 1, 1, 2, 2])).toEqual({
      keys: ['Q', 'W', 'E'],
      signature: 'Q>W>E',
    });
  });

  it('derives W>E>Q from W5 E4 Q2', () => {
    expect(deriveSkillPriority([2, 3, 1, 2, 2, 2, 2, 3, 3, 3, 1])).toEqual({
      keys: ['W', 'E', 'Q'],
      signature: 'W>E>Q',
    });
  });

  it('does not let first-learned order override investment priority', () => {
    const slots = [3, 2, 1, 2, 2, 4, 2, 3, 2];
    expect(deriveFirstLearnedBasicOrder(slots).keys[0]).toBe('E');
    expect(deriveSkillPriority(slots)).toEqual({
      keys: ['W', 'E', 'Q'],
      signature: 'W>E>Q',
    });
  });

  it('ignores R when ranking basic skill priority', () => {
    const withUltFirst = [4, 3, 2, 1, 2, 2, 2, 2, 3, 3, 3, 1, 1];
    expect(deriveSkillPriority(withUltFirst)).toEqual({
      keys: ['W', 'E', 'Q'],
      signature: 'W>E>Q',
    });
  });

  it('is ineligible for a genuinely ambiguous short progression', () => {
    expect(deriveSkillPriority([])).toBeNull();
    expect(deriveSkillPriority([1, 2, 3])).toBeNull();
    expect(deriveSkillPriority([1, 2, 3, 1])).toBeNull();
    expect(isSkillPriorityEligible([1, 2, 3])).toBe(false);
  });

  it('handles missing SKILL_LEVEL_UP events as ineligible', () => {
    expect(deriveSkillSequence([]).keys).toEqual([]);
    expect(deriveSkillPriority([])).toBeNull();
  });

  it('ignores duplicate/malformed slots without inventing a priority', () => {
    expect(deriveSkillPriority([0, 9, 4, 4, 4])).toBeNull();
    expect(deriveSkillSequence([0, 9, 3, 2]).keys).toEqual(['E', 'W']);
  });

  it('emits only canonical three-ability permutations', () => {
    const full = deriveSkillPriority(SYLAS_LEVEL_SLOTS);
    expect(full?.signature).toBe('W>E>Q');
    expect(CANONICAL_SKILL_PRIORITY_SIGNATURES).toContain(full?.signature);
    expect(full?.keys).toHaveLength(3);
  });

  it('prefers timeline SKILL_LEVEL_UP over a truncated stored skillOrder', () => {
    const slots = resolveSkillLevelSlots(
      source({
        skillOrder: [3, 2, 1],
        timelineEvents: SYLAS_LEVEL_SLOTS.map((skillSlot, eventIndex) => ({
          type: 'SKILL_LEVEL_UP',
          timestampMs: eventIndex * 1000,
          eventIndex,
          skillSlot,
        })),
      }),
    );
    expect(deriveFirstLearnedBasicOrder(slots).signature).toBe('E>W>Q');
    expect(deriveSkillPriority(slots)?.signature).toBe('W>E>Q');
  });

  it('prefers a longer stored skillOrder over a truncated timeline', () => {
    const slots = resolveSkillLevelSlots(
      source({
        skillOrder: SYLAS_LEVEL_SLOTS,
        timelineEvents: [{ type: 'SKILL_LEVEL_UP', timestampMs: 0, eventIndex: 0, skillSlot: 3 }],
      }),
    );
    expect(deriveSkillPriority(slots)?.signature).toBe('W>E>Q');
  });
});
