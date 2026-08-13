import { classifyItem, type ItemStaticClassificationInput } from './item-classification';
import { toItemTimelineEvents, type ItemTimelineEvent } from './item-reconstruction';

/** Fountain-shop window: minions spawn at 65s; 90s is a deterministic buffer. */
export const STARTING_ITEMS_CUTOFF_MS = 90_000;

function sortStarting(
  ids: number[],
  catalog: Map<number, ItemStaticClassificationInput>,
): number[] {
  return [...ids].sort((left, right) => {
    const leftGold = catalog.get(left)?.goldTotal ?? 0;
    const rightGold = catalog.get(right)?.goldTotal ?? 0;
    if (leftGold !== rightGold) {
      return rightGold - leftGold;
    }
    return left - right;
  });
}

/**
 * Starting items = net purchases before STARTING_ITEMS_CUTOFF_MS.
 * Consumed potions still count. Trinkets are excluded. DESTROYED is ignored
 * so drinking a potion does not drop it from the opening buy.
 */
export function deriveStartingItemIds(
  events: readonly ItemTimelineEvent[],
  catalog: Map<number, ItemStaticClassificationInput>,
): number[] {
  const net: number[] = [];
  const ordered = [...events].sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    return left.eventIndex - right.eventIndex;
  });

  for (const event of ordered) {
    if (event.timestampMs >= STARTING_ITEMS_CUTOFF_MS) {
      continue;
    }
    if (event.type === 'ITEM_PURCHASED' && (event.itemId ?? 0) > 0) {
      net.push(event.itemId!);
      continue;
    }
    if (event.type === 'ITEM_SOLD' && (event.itemId ?? 0) > 0) {
      const index = net.lastIndexOf(event.itemId!);
      if (index >= 0) {
        net.splice(index, 1);
      }
      continue;
    }
    if (event.type === 'ITEM_UNDO') {
      if ((event.beforeItemId ?? 0) > 0) {
        const index = net.lastIndexOf(event.beforeItemId!);
        if (index >= 0) {
          net.splice(index, 1);
        }
      }
      if ((event.afterItemId ?? 0) > 0) {
        net.push(event.afterItemId!);
      }
    }
  }

  const filtered = net.filter((itemId) => {
    const meta = catalog.get(itemId);
    if (!meta) {
      return itemId > 0;
    }
    const kind = classifyItem(meta);
    return kind !== 'TRINKET' && kind !== 'BOOTS';
  });

  return sortStarting(filtered, catalog);
}

export function startingItemsSignature(itemIds: readonly number[]): string {
  return [...itemIds].join('-');
}

export function startingItemsFromSourceEvents(
  events: readonly {
    type: string;
    timestampMs: number;
    eventIndex: number;
    itemId?: number | null;
    beforeItemId?: number | null;
    afterItemId?: number | null;
  }[],
  catalog: Map<number, ItemStaticClassificationInput>,
): number[] {
  return deriveStartingItemIds(toItemTimelineEvents(events), catalog);
}
