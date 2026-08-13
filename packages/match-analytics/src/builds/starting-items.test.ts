import { describe, expect, it } from 'vitest';
import { deriveStartingItemIds } from './starting-items';
import type { ItemStaticClassificationInput } from './item-classification';
import type { ItemTimelineEvent } from './item-reconstruction';

function catalog(): Map<number, ItemStaticClassificationInput> {
  return new Map([
    [
      1056,
      {
        itemId: 1056,
        tags: ['Lane'],
        goldTotal: 450,
        purchasable: true,
        fromItemIds: [],
        intoItemIds: [],
        consumed: false,
      },
    ],
    [
      2003,
      {
        itemId: 2003,
        tags: ['Consumable'],
        goldTotal: 50,
        purchasable: true,
        fromItemIds: [],
        intoItemIds: [],
        consumed: false,
      },
    ],
    [
      3340,
      {
        itemId: 3340,
        tags: ['Trinket'],
        goldTotal: 0,
        purchasable: true,
        fromItemIds: [],
        intoItemIds: [],
        consumed: false,
      },
    ],
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

describe('deriveStartingItemIds', () => {
  it('keeps starter items and consumables purchased before the 90s cutoff', () => {
    const ids = deriveStartingItemIds(
      [
        purchased(1056, 0, 0),
        purchased(2003, 0, 1),
        purchased(2003, 0, 2),
        purchased(3340, 0, 3),
        purchased(3031, 120_000, 4),
      ],
      catalog(),
    );
    expect(ids).toEqual([1056, 2003, 2003]);
  });

  it('excludes a purchase undone inside the window', () => {
    const ids = deriveStartingItemIds(
      [
        purchased(1056, 0, 0),
        purchased(2003, 0, 1),
        {
          type: 'ITEM_UNDO',
          timestampMs: 500,
          eventIndex: 2,
          itemId: null,
          beforeItemId: 2003,
          afterItemId: 0,
        },
      ],
      catalog(),
    );
    expect(ids).toEqual([1056]);
  });

  it('does not drop consumed potions from the starting set', () => {
    const ids = deriveStartingItemIds(
      [
        purchased(1056, 0, 0),
        purchased(2003, 0, 1),
        {
          type: 'ITEM_DESTROYED',
          timestampMs: 30_000,
          eventIndex: 2,
          itemId: 2003,
          beforeItemId: null,
          afterItemId: null,
        },
      ],
      catalog(),
    );
    expect(ids).toEqual([1056, 2003]);
  });
});
