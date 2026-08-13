export type MappedItemStaticRow = {
  itemId: number;
  name: string;
  description: string;
  plaintext: string | null;
  goldData: Record<string, unknown>;
  stats: Record<string, unknown>;
  tags: string[];
  imageData: Record<string, unknown>;
  purchasable: boolean;
  fromItemIds: number[];
  intoItemIds: number[];
  consumed: boolean;
};

export type MappedRuneStaticRow = {
  runeId: number;
  runeKey: string;
  name: string;
  shortDescription: string | null;
  longDescription: string | null;
  icon: string;
  treeId: number | null;
  treeName: string | null;
  slotIndex: number | null;
};

export type MappedSummonerSpellRow = {
  spellId: number;
  spellKey: string;
  name: string;
  description: string;
  imageData: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: number[] = [];
  for (const entry of value) {
    const parsed = typeof entry === 'string' ? Number.parseInt(entry, 10) : Number(entry);
    if (Number.isInteger(parsed) && parsed > 0) {
      ids.push(parsed);
    }
  }
  return ids;
}

export function mapDataDragonItemEntry(
  idKey: string,
  entry: Record<string, unknown>,
): MappedItemStaticRow {
  const itemId = Number.parseInt(idKey, 10);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error(`Invalid Data Dragon item id ${idKey}`);
  }
  const gold = asRecord(entry.gold);
  return {
    itemId,
    name: asString(entry.name, `Item ${itemId}`),
    description: asString(entry.description),
    plaintext: typeof entry.plaintext === 'string' ? entry.plaintext : null,
    goldData: gold,
    stats: asRecord(entry.stats),
    tags: Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    imageData: asRecord(entry.image),
    purchasable: asBoolean(gold.purchasable, true),
    fromItemIds: parseIdList(entry.from),
    intoItemIds: parseIdList(entry.into),
    consumed: asBoolean(entry.consumed, false),
  };
}

export function mapDataDragonRuneTrees(trees: unknown): MappedRuneStaticRow[] {
  if (!Array.isArray(trees)) {
    return [];
  }
  const rows: MappedRuneStaticRow[] = [];
  for (const tree of trees) {
    const treeRecord = asRecord(tree);
    const treeId = typeof treeRecord.id === 'number' ? treeRecord.id : null;
    const treeName = asString(treeRecord.name) || null;
    const slots = Array.isArray(treeRecord.slots) ? treeRecord.slots : [];
    slots.forEach((slot, slotIndex) => {
      const runes = Array.isArray(asRecord(slot).runes) ? (asRecord(slot).runes as unknown[]) : [];
      for (const rune of runes) {
        const record = asRecord(rune);
        const runeId = typeof record.id === 'number' ? record.id : null;
        if (runeId === null || runeId <= 0) {
          continue;
        }
        rows.push({
          runeId,
          runeKey: asString(record.key, String(runeId)),
          name: asString(record.name, `Rune ${runeId}`),
          shortDescription: typeof record.shortDesc === 'string' ? record.shortDesc : null,
          longDescription: typeof record.longDesc === 'string' ? record.longDesc : null,
          icon: asString(record.icon),
          treeId,
          treeName,
          slotIndex,
        });
      }
    });
  }
  return rows;
}

export function mapDataDragonSummonerSpellEntry(
  spellKey: string,
  entry: Record<string, unknown>,
): MappedSummonerSpellRow {
  const spellId = Number.parseInt(asString(entry.key), 10);
  if (!Number.isInteger(spellId) || spellId <= 0) {
    throw new Error(`Invalid Data Dragon summoner spell key for ${spellKey}`);
  }
  return {
    spellId,
    spellKey,
    name: asString(entry.name, spellKey),
    description: asString(entry.description),
    imageData: asRecord(entry.image),
  };
}
