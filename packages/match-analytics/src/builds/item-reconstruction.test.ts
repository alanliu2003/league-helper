import { describe, expect, it } from 'vitest';
import { reconstructItemInventory, type ItemTimelineEvent } from './item-reconstruction';

function event(
  partial: Partial<ItemTimelineEvent> & Pick<ItemTimelineEvent, 'type'>,
): ItemTimelineEvent {
  return {
    timestampMs: 0,
    eventIndex: 0,
    itemId: null,
    beforeItemId: null,
    afterItemId: null,
    ...partial,
  };
}

describe('reconstructItemInventory', () => {
  it('applies purchases in timestamp then eventIndex order', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 1036, timestampMs: 10, eventIndex: 1 }),
      event({ type: 'ITEM_PURCHASED', itemId: 1001, timestampMs: 0, eventIndex: 0 }),
    ]);
    expect(inventory).toEqual([1001, 1036]);
  });

  it('removes a sold item', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 1001, eventIndex: 0 }),
      event({ type: 'ITEM_SOLD', itemId: 1001, timestampMs: 1, eventIndex: 1 }),
    ]);
    expect(inventory).toEqual([]);
  });

  it('undoes a purchase using beforeItemId', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 1001, eventIndex: 0 }),
      event({
        type: 'ITEM_UNDO',
        beforeItemId: 1001,
        afterItemId: 0,
        timestampMs: 1,
        eventIndex: 1,
      }),
    ]);
    expect(inventory).toEqual([]);
  });

  it('undoes a sell using afterItemId', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 1001, eventIndex: 0 }),
      event({ type: 'ITEM_SOLD', itemId: 1001, timestampMs: 1, eventIndex: 1 }),
      event({
        type: 'ITEM_UNDO',
        beforeItemId: 0,
        afterItemId: 1001,
        timestampMs: 2,
        eventIndex: 2,
      }),
    ]);
    expect(inventory).toEqual([1001]);
  });

  it('removes destroyed or consumed items', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 2003, eventIndex: 0 }),
      event({ type: 'ITEM_DESTROYED', itemId: 2003, timestampMs: 1, eventIndex: 1 }),
    ]);
    expect(inventory).toEqual([]);
  });

  it('replaces components with a completed item', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 1036, eventIndex: 0 }),
      event({ type: 'ITEM_PURCHASED', itemId: 1036, eventIndex: 1 }),
      event({ type: 'ITEM_DESTROYED', itemId: 1036, timestampMs: 2, eventIndex: 2 }),
      event({ type: 'ITEM_DESTROYED', itemId: 1036, timestampMs: 2, eventIndex: 3 }),
      event({ type: 'ITEM_PURCHASED', itemId: 3031, timestampMs: 2, eventIndex: 4 }),
    ]);
    expect(inventory).toEqual([3031]);
  });

  it('keeps duplicate purchases', () => {
    const inventory = reconstructItemInventory([
      event({ type: 'ITEM_PURCHASED', itemId: 2003, eventIndex: 0 }),
      event({ type: 'ITEM_PURCHASED', itemId: 2003, eventIndex: 1 }),
    ]);
    expect(inventory).toEqual([2003, 2003]);
  });

  it('ignores events after a cutoff', () => {
    const inventory = reconstructItemInventory(
      [
        event({ type: 'ITEM_PURCHASED', itemId: 1056, timestampMs: 0, eventIndex: 0 }),
        event({ type: 'ITEM_PURCHASED', itemId: 3031, timestampMs: 100_000, eventIndex: 1 }),
      ],
      { untilTimestampMs: 90_000 },
    );
    expect(inventory).toEqual([1056]);
  });
});
