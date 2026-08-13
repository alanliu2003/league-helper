import { classifyItem, type ItemKind, type ItemStaticClassificationInput } from './item-classification';
import { reconstructItemInventory, type ItemTimelineEvent } from './item-reconstruction';

export const CORE_BUILD_MAX_ITEMS = 3;

function kindOf(
  itemId: number,
  catalog: Map<number, ItemStaticClassificationInput>,
): ItemKind | 'UNKNOWN' {
  const meta = catalog.get(itemId);
  if (!meta) {
    return 'UNKNOWN';
  }
  return classifyItem(meta);
}

export function isQualifyingCoreItem(
  itemId: number,
  catalog: Map<number, ItemStaticClassificationInput>,
): boolean {
  return kindOf(itemId, catalog) === 'COMPLETED_MAJOR';
}

function completedMajorCounts(
  inventory: readonly number[],
  catalog: Map<number, ItemStaticClassificationInput>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const itemId of inventory) {
    if (!isQualifyingCoreItem(itemId, catalog)) {
      continue;
    }
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

function removeLast(items: number[], itemId: number): void {
  const index = items.lastIndexOf(itemId);
  if (index >= 0) {
    items.splice(index, 1);
  }
}

/**
 * Qualifying completed-major completions in reconstructed order.
 * ITEM_UNDO reverses a completion; ITEM_SOLD does not.
 * Boots, components, consumables, trinkets, and starters are excluded.
 */
export function listCoreItemCompletions(
  events: readonly ItemTimelineEvent[],
  catalog: Map<number, ItemStaticClassificationInput>,
): number[] {
  const ordered = [...events].sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    return left.eventIndex - right.eventIndex;
  });

  const completed: number[] = [];
  let previousCounts = new Map<number, number>();

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    const inventory = reconstructItemInventory(ordered.slice(0, index + 1));
    const counts = completedMajorCounts(inventory, catalog);

    if (event.type === 'ITEM_UNDO') {
      for (const [itemId, previous] of previousCounts) {
        const next = counts.get(itemId) ?? 0;
        for (let n = 0; n < previous - next; n += 1) {
          removeLast(completed, itemId);
        }
      }
    } else {
      for (const [itemId, count] of counts) {
        const previous = previousCounts.get(itemId) ?? 0;
        for (let n = 0; n < count - previous; n += 1) {
          completed.push(itemId);
        }
      }
    }

    previousCounts = counts;
  }

  return completed;
}

export function isCoreBuildEligible(completions: readonly number[]): boolean {
  return completions.length >= CORE_BUILD_MAX_ITEMS;
}

/**
 * First three qualifying completed major items in completion order.
 * Empty when the participant never reached a 3-item core.
 */
export function deriveCoreBuildItemIds(
  events: readonly ItemTimelineEvent[],
  catalog: Map<number, ItemStaticClassificationInput>,
  maxItems: number = CORE_BUILD_MAX_ITEMS,
): number[] {
  const completions = listCoreItemCompletions(events, catalog);
  if (completions.length < maxItems) {
    return [];
  }
  return completions.slice(0, maxItems);
}

export function deriveBootsItemId(
  finalItemIds: readonly number[],
  catalog: Map<number, ItemStaticClassificationInput>,
): number | null {
  let best: { itemId: number; gold: number } | null = null;
  for (const itemId of finalItemIds) {
    if (itemId <= 0) {
      continue;
    }
    const meta = catalog.get(itemId);
    if (!meta || classifyItem(meta) !== 'BOOTS') {
      continue;
    }
    if (!best || meta.goldTotal > best.gold) {
      best = { itemId, gold: meta.goldTotal };
    }
  }
  return best?.itemId ?? null;
}

export function normalizeFinalItemIds(
  finalItemIds: readonly number[],
  catalog: Map<number, ItemStaticClassificationInput>,
  options: { excludeBoots?: boolean } = {},
): number[] {
  return finalItemIds.filter((itemId) => {
    if (itemId <= 0) {
      return false;
    }
    const kind = kindOf(itemId, catalog);
    if (kind === 'TRINKET') {
      return false;
    }
    if (options.excludeBoots && kind === 'BOOTS') {
      return false;
    }
    return true;
  });
}

export function coreBuildSignature(itemIds: readonly number[]): string {
  return [...itemIds].join('>');
}

export function bootsSignature(itemId: number): string {
  return String(itemId);
}
