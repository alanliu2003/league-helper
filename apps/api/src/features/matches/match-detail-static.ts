import type { ChampionBuildStaticIdentity } from '@league-helper/shared';
import type { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import type { PrismaService } from '../../prisma/prisma.service';

export type MatchStaticLookups = {
  dataDragonVersion: string | null;
  items: Map<number, { name: string }>;
  runes: Map<
    number,
    { name: string; icon: string; treeId: number | null; treeName: string | null }
  >;
  spells: Map<number, { name: string; imageFull: string | null }>;
  styleNames: Map<number, string>;
};

export type MatchStaticIcons = {
  itemIcon: (id: number, version: string) => string | null;
  runeIcon: (path: string) => string | null;
  spellIcon: (imageFull: string, version: string) => string | null;
};

function imageFullFromJson(imageData: unknown): string | null {
  if (!imageData || typeof imageData !== 'object') {
    return null;
  }
  const full = (imageData as { full?: unknown }).full;
  return typeof full === 'string' && full.length > 0 ? full : null;
}

export async function loadMatchStaticLookups(
  prisma: PrismaService,
  staticRepo: ChampionStaticRepository,
  normalizedPatch: string | null,
): Promise<MatchStaticLookups> {
  const patchRow = normalizedPatch
    ? await prisma.patch.findFirst({
        where: { normalizedMajorMinor: normalizedPatch },
        orderBy: { version: 'desc' },
      })
    : null;
  const fallback = patchRow ?? (await staticRepo.resolveStaticPatch());
  if (!fallback) {
    return {
      dataDragonVersion: null,
      items: new Map(),
      runes: new Map(),
      spells: new Map(),
      styleNames: new Map(),
    };
  }

  const [items, runes, spells] = await Promise.all([
    prisma.itemStaticData.findMany({
      where: { patchId: fallback.id },
      select: { itemId: true, name: true },
    }),
    prisma.runeStaticData.findMany({
      where: { patchId: fallback.id },
      select: { runeId: true, name: true, icon: true, treeId: true, treeName: true },
    }),
    prisma.summonerSpellStaticData.findMany({
      where: { patchId: fallback.id },
      select: { spellId: true, name: true, imageData: true },
    }),
  ]);

  const styleNames = new Map<number, string>();
  for (const rune of runes) {
    if (rune.treeId && rune.treeName && !styleNames.has(rune.treeId)) {
      styleNames.set(rune.treeId, rune.treeName);
    }
  }

  return {
    dataDragonVersion: fallback.dataDragonVersion,
    items: new Map(items.map((row) => [row.itemId, { name: row.name }])),
    runes: new Map(
      runes.map((row) => [
        row.runeId,
        { name: row.name, icon: row.icon, treeId: row.treeId, treeName: row.treeName },
      ]),
    ),
    spells: new Map(
      spells.map((row) => [
        row.spellId,
        {
          name: row.name,
          imageFull: imageFullFromJson(row.imageData),
        },
      ]),
    ),
    styleNames,
  };
}

export function identityFromItem(
  itemId: number,
  lookups: MatchStaticLookups,
  icons: Pick<MatchStaticIcons, 'itemIcon'>,
): { name: string | null; iconUrl: string | null } {
  if (itemId <= 0) return { name: null, iconUrl: null };
  const version = lookups.dataDragonVersion ?? '';
  const name = lookups.items.get(itemId)?.name ?? `Item ${itemId}`;
  return { name, iconUrl: version ? icons.itemIcon(itemId, version) : null };
}

export function identityFromRune(
  runeId: number,
  lookups: MatchStaticLookups,
  icons: Pick<MatchStaticIcons, 'runeIcon'>,
): ChampionBuildStaticIdentity | null {
  if (runeId <= 0) return null;
  const meta = lookups.runes.get(runeId);
  return {
    id: runeId,
    name: meta?.name ?? `Rune ${runeId}`,
    iconUrl: meta?.icon ? icons.runeIcon(meta.icon) : null,
  };
}

export function identityFromStyle(
  styleId: number,
  lookups: MatchStaticLookups,
  icons: Pick<MatchStaticIcons, 'runeIcon'>,
): ChampionBuildStaticIdentity | null {
  if (styleId <= 0) return null;
  const name = lookups.styleNames.get(styleId) ?? `Rune ${styleId}`;
  let iconUrl: string | null = null;
  for (const rune of lookups.runes.values()) {
    if (rune.treeId === styleId && rune.icon) {
      iconUrl = icons.runeIcon(rune.icon);
      break;
    }
  }
  return { id: styleId, name, iconUrl };
}

export function identityFromSpell(
  spellId: number,
  lookups: MatchStaticLookups,
  icons: Pick<MatchStaticIcons, 'spellIcon'>,
): ChampionBuildStaticIdentity | null {
  if (spellId <= 0) return null;
  const meta = lookups.spells.get(spellId);
  const version = lookups.dataDragonVersion ?? '';
  return {
    id: spellId,
    name: meta?.name ?? `Spell ${spellId}`,
    iconUrl: meta?.imageFull && version ? icons.spellIcon(meta.imageFull, version) : null,
  };
}
