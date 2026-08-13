export type ItemKind =
  'BOOTS' | 'TRINKET' | 'CONSUMABLE' | 'COMPLETED_MAJOR' | 'COMPONENT' | 'OTHER';

export type ItemStaticClassificationInput = {
  itemId: number;
  tags: readonly string[];
  goldTotal: number;
  purchasable: boolean;
  fromItemIds: readonly number[];
  intoItemIds: readonly number[];
  consumed: boolean;
};

/** Completed-item gold floor from Data Dragon totals (legendaries / support completes). */
export const COMPLETED_MAJOR_GOLD_FLOOR = 2000;

const TAG = {
  BOOTS: 'Boots',
  TRINKET: 'Trinket',
  CONSUMABLE: 'Consumable',
} as const;

function hasTag(tags: readonly string[], tag: string): boolean {
  return tags.some((value) => value === tag);
}

/**
 * Classify an item using static metadata only.
 *
 * Completed major items are distinguished from components via gold total + `from`/`into`.
 * Items with an Ornn/upgrade `into` target remain completed when gold >= floor.
 */
export function classifyItem(input: ItemStaticClassificationInput): ItemKind {
  if (hasTag(input.tags, TAG.TRINKET)) {
    return 'TRINKET';
  }
  if (hasTag(input.tags, TAG.CONSUMABLE) || input.consumed) {
    return 'CONSUMABLE';
  }
  if (hasTag(input.tags, TAG.BOOTS)) {
    return 'BOOTS';
  }

  const hasFrom = input.fromItemIds.length > 0;
  const hasInto = input.intoItemIds.length > 0;
  const expensiveEnough = input.goldTotal >= COMPLETED_MAJOR_GOLD_FLOOR;
  const starterTag = hasTag(input.tags, 'Lane') || hasTag(input.tags, 'Jungle');

  if (starterTag && !hasFrom) {
    return 'OTHER';
  }

  if (hasFrom && expensiveEnough) {
    return 'COMPLETED_MAJOR';
  }
  if (hasInto || (hasFrom && !expensiveEnough)) {
    return 'COMPONENT';
  }
  return 'OTHER';
}

export function goldTotalFromGoldData(goldData: unknown): number {
  if (!goldData || typeof goldData !== 'object') {
    return 0;
  }
  const total = (goldData as { total?: unknown }).total;
  return typeof total === 'number' && Number.isFinite(total) ? total : 0;
}
