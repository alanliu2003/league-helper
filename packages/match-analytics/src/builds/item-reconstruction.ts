export type ItemTimelineEvent = {
  type: string;
  timestampMs: number;
  eventIndex: number;
  itemId: number | null;
  beforeItemId: number | null;
  afterItemId: number | null;
};

export type ReconstructItemInventoryOptions = {
  untilTimestampMs?: number;
};

function sortEvents(events: readonly ItemTimelineEvent[]): ItemTimelineEvent[] {
  return [...events].sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    return left.eventIndex - right.eventIndex;
  });
}

function addItem(inventory: number[], itemId: number): void {
  if (itemId > 0) {
    inventory.push(itemId);
  }
}

function removeItem(inventory: number[], itemId: number): void {
  if (itemId <= 0) {
    return;
  }
  const index = inventory.lastIndexOf(itemId);
  if (index >= 0) {
    inventory.splice(index, 1);
  }
}

/**
 * Reconstruct a participant's item multiset from preserved timeline events.
 *
 * ITEM_UNDO uses beforeItemId (removed) and afterItemId (restored).
 * Do not count raw ITEM_PURCHASED events as the final path.
 */
export function reconstructItemInventory(
  events: readonly ItemTimelineEvent[],
  options: ReconstructItemInventoryOptions = {},
): number[] {
  const inventory: number[] = [];
  const cutoff = options.untilTimestampMs;

  for (const event of sortEvents(events)) {
    if (cutoff !== undefined && event.timestampMs >= cutoff) {
      continue;
    }
    switch (event.type) {
      case 'ITEM_PURCHASED':
        addItem(inventory, event.itemId ?? 0);
        break;
      case 'ITEM_SOLD':
      case 'ITEM_DESTROYED':
        removeItem(inventory, event.itemId ?? 0);
        break;
      case 'ITEM_UNDO':
        removeItem(inventory, event.beforeItemId ?? 0);
        addItem(inventory, event.afterItemId ?? 0);
        break;
      default:
        break;
    }
  }

  return inventory;
}

export function toItemTimelineEvents(
  events: readonly {
    type: string;
    timestampMs: number;
    eventIndex: number;
    itemId?: number | null;
    beforeItemId?: number | null;
    afterItemId?: number | null;
  }[],
): ItemTimelineEvent[] {
  return events.map((event) => ({
    type: event.type,
    timestampMs: event.timestampMs,
    eventIndex: event.eventIndex,
    itemId: event.itemId ?? null,
    beforeItemId: event.beforeItemId ?? null,
    afterItemId: event.afterItemId ?? null,
  }));
}
