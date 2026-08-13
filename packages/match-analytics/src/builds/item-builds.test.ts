import { describe, expect, it } from 'vitest';
import {
  CORE_BUILD_MAX_ITEMS,
  deriveCoreBuildItemIds,
  deriveBootsItemId,
  isCoreBuildEligible,
  listCoreItemCompletions,
  normalizeFinalItemIds,
} from './item-builds';
import type { ItemStaticClassificationInput } from './item-classification';
import type { ItemTimelineEvent } from './item-reconstruction';

function item(
  itemId: number,
  kind: 'BOOTS' | 'TRINKET' | 'CONSUMABLE' | 'COMPLETED_MAJOR' | 'COMPONENT' | 'OTHER',
  goldTotal = 0,
): ItemStaticClassificationInput {
  const tags =
    kind === 'BOOTS'
      ? ['Boots']
      : kind === 'TRINKET'
        ? ['Trinket']
        : kind === 'CONSUMABLE'
          ? ['Consumable']
          : kind === 'OTHER'
            ? ['Lane']
            : [];
  return {
    itemId,
    tags,
    goldTotal:
      goldTotal ||
      (kind === 'COMPLETED_MAJOR'
        ? 3200
        : kind === 'COMPONENT'
          ? 1100
          : kind === 'BOOTS'
            ? 1100
            : 400),
    purchasable: true,
    fromItemIds: kind === 'COMPLETED_MAJOR' || kind === 'COMPONENT' ? [1000] : [],
    intoItemIds: kind === 'COMPONENT' ? [itemId + 1000] : [],
    consumed: false,
  };
}

function catalog(): Map<number, ItemStaticClassificationInput> {
  return new Map([
    [3006, item(3006, 'BOOTS')],
    [3340, item(3340, 'TRINKET')],
    [2003, item(2003, 'CONSUMABLE')],
    [1056, item(1056, 'OTHER')],
    [1038, item(1038, 'COMPONENT')],
    [3031, item(3031, 'COMPLETED_MAJOR', 3600)],
    [3089, item(3089, 'COMPLETED_MAJOR', 3600)],
    [3135, item(3135, 'COMPLETED_MAJOR', 3000)],
    [3116, item(3116, 'COMPLETED_MAJOR', 2600)],
  ]);
}

function purchased(itemId: number, timestampMs: number, eventIndex: number): ItemTimelineEvent {
  return {
    type: 'ITEM_PURCHASED',
    timestampMs,
    eventIndex,
    itemId,
    beforeItemId: null,
    afterItemId: null,
  };
}

function sold(itemId: number, timestampMs: number, eventIndex: number): ItemTimelineEvent {
  return {
    type: 'ITEM_SOLD',
    timestampMs,
    eventIndex,
    itemId,
    beforeItemId: null,
    afterItemId: null,
  };
}

function undoPurchase(itemId: number, timestampMs: number, eventIndex: number): ItemTimelineEvent {
  return {
    type: 'ITEM_UNDO',
    timestampMs,
    eventIndex,
    itemId: null,
    beforeItemId: itemId,
    afterItemId: 0,
  };
}

function destroyed(itemId: number, timestampMs: number, eventIndex: number): ItemTimelineEvent {
  return {
    type: 'ITEM_DESTROYED',
    timestampMs,
    eventIndex,
    itemId,
    beforeItemId: null,
    afterItemId: null,
  };
}

describe('deriveCoreBuildItemIds', () => {
  it('is ineligible with only one completed major item', () => {
    const completions = listCoreItemCompletions([purchased(3031, 300_000, 0)], catalog());
    expect(completions).toEqual([3031]);
    expect(isCoreBuildEligible(completions)).toBe(false);
    expect(deriveCoreBuildItemIds([purchased(3031, 300_000, 0)], catalog())).toEqual([]);
  });

  it('is ineligible with only two completed major items', () => {
    const events = [purchased(3031, 300_000, 0), purchased(3089, 600_000, 1)];
    expect(listCoreItemCompletions(events, catalog())).toEqual([3031, 3089]);
    expect(isCoreBuildEligible(listCoreItemCompletions(events, catalog()))).toBe(false);
    expect(deriveCoreBuildItemIds(events, catalog())).toEqual([]);
  });

  it('returns the first three completed major items in completion order', () => {
    const ids = deriveCoreBuildItemIds(
      [
        purchased(1038, 0, 0),
        purchased(3031, 300_000, 1),
        purchased(3089, 600_000, 2),
        purchased(3135, 900_000, 3),
        purchased(3006, 200_000, 4),
      ],
      catalog(),
    );
    expect(ids).toEqual([3031, 3089, 3135]);
    expect(ids).toHaveLength(CORE_BUILD_MAX_ITEMS);
    expect(isCoreBuildEligible(ids)).toBe(true);
  });

  it('uses only the first three when four completed majors exist', () => {
    const ids = deriveCoreBuildItemIds(
      [
        purchased(3031, 300_000, 0),
        purchased(3089, 600_000, 1),
        purchased(3135, 900_000, 2),
        purchased(3116, 1_200_000, 3),
      ],
      catalog(),
    );
    expect(ids).toEqual([3031, 3089, 3135]);
  });

  it('ignores boots purchased between core items', () => {
    const ids = deriveCoreBuildItemIds(
      [
        purchased(3031, 300_000, 0),
        purchased(3006, 400_000, 1),
        purchased(3089, 600_000, 2),
        purchased(3135, 900_000, 3),
      ],
      catalog(),
    );
    expect(ids).toEqual([3031, 3089, 3135]);
  });

  it('does not count components or boots as core items', () => {
    const ids = deriveCoreBuildItemIds([purchased(1038, 0, 0), purchased(3006, 1, 1)], catalog());
    expect(ids).toEqual([]);
  });

  it('does not count a component purchase plus upgrade as two core items', () => {
    const events = [
      purchased(1038, 0, 0),
      destroyed(1038, 300_000, 1),
      purchased(3031, 300_000, 2),
      purchased(3089, 600_000, 3),
      purchased(3135, 900_000, 4),
    ];
    expect(listCoreItemCompletions(events, catalog())).toEqual([3031, 3089, 3135]);
    expect(deriveCoreBuildItemIds(events, catalog())).toEqual([3031, 3089, 3135]);
  });

  it('does not count an undone purchase as a completed core item', () => {
    const events = [
      purchased(3031, 300_000, 0),
      undoPurchase(3031, 301_000, 1),
      purchased(3089, 600_000, 2),
      purchased(3135, 900_000, 3),
      purchased(3116, 1_200_000, 4),
    ];
    expect(listCoreItemCompletions(events, catalog())).toEqual([3089, 3135, 3116]);
    expect(deriveCoreBuildItemIds(events, catalog())).toEqual([3089, 3135, 3116]);
  });

  it('keeps a sold completed item as a prior completion', () => {
    const events = [
      purchased(3031, 300_000, 0),
      sold(3031, 400_000, 1),
      purchased(3089, 600_000, 2),
      purchased(3135, 900_000, 3),
    ];
    expect(deriveCoreBuildItemIds(events, catalog())).toEqual([3031, 3089, 3135]);
  });

  it('allows a duplicate completed item when purchased twice', () => {
    const events = [
      purchased(3031, 300_000, 0),
      purchased(3031, 600_000, 1),
      purchased(3089, 900_000, 2),
    ];
    expect(deriveCoreBuildItemIds(events, catalog())).toEqual([3031, 3031, 3089]);
  });
});

describe('deriveBootsItemId', () => {
  it('picks the boots item from final inventory', () => {
    expect(deriveBootsItemId([3031, 3006, 3340, 0], catalog())).toBe(3006);
  });

  it('returns null when no boots are present', () => {
    expect(deriveBootsItemId([3031, 3089], catalog())).toBeNull();
  });
});

describe('normalizeFinalItemIds', () => {
  it('removes zeros and trinkets, keeps duplicates, and can exclude boots', () => {
    expect(
      normalizeFinalItemIds([3031, 0, 3006, 3340, 3031], catalog(), { excludeBoots: true }),
    ).toEqual([3031, 3031]);
  });
});
