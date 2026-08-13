import type { Prisma, PrismaClient } from '@prisma/client';
import type { ChampionStaticSyncConfig } from './sync-champion-static.config';
import { normalizeMajorMinor } from './sync-champion-static.mapper';
import {
  fetchItemStaticFile,
  fetchRuneStaticFile,
  fetchSummonerSpellStaticFile,
  resolveBuildStaticVersion,
  type BuildStaticFetchDeps,
} from './sync-build-static.fetch';
import {
  mapDataDragonItemEntry,
  mapDataDragonRuneTrees,
  mapDataDragonSummonerSpellEntry,
} from './sync-build-static.mapper';

export type BuildStaticSyncResult = {
  ok: boolean;
  dryRun: boolean;
  resolvedVersion: string;
  itemCount: number;
  runeCount: number;
  spellCount: number;
  upsertedItems: number;
  upsertedRunes: number;
  upsertedSpells: number;
  patchId: string | null;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export async function syncBuildStatic(input: {
  config: ChampionStaticSyncConfig;
  prisma: PrismaClient;
  dryRun: boolean;
  log: (message: string) => void;
  fetchDeps?: BuildStaticFetchDeps;
}): Promise<BuildStaticSyncResult> {
  const { config, prisma, dryRun, log, fetchDeps } = input;
  let resolvedVersion = config.version;

  try {
    resolvedVersion = await resolveBuildStaticVersion(config, fetchDeps);
    const [itemFile, runeFile, spellFile] = await Promise.all([
      fetchItemStaticFile(config, resolvedVersion, fetchDeps),
      fetchRuneStaticFile(config, resolvedVersion, fetchDeps),
      fetchSummonerSpellStaticFile(config, resolvedVersion, fetchDeps),
    ]);

    const itemData = asRecord(asRecord(itemFile).data);
    const items = Object.entries(itemData).map(([id, entry]) =>
      mapDataDragonItemEntry(id, asRecord(entry)),
    );
    const runes = mapDataDragonRuneTrees(runeFile);
    const spellData = asRecord(asRecord(spellFile).data);
    const spells = Object.entries(spellData).map(([key, entry]) =>
      mapDataDragonSummonerSpellEntry(key, asRecord(entry)),
    );

    log(
      `Discovered items=${items.length} runes=${runes.length} spells=${spells.length} version=${resolvedVersion}`,
    );

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        resolvedVersion,
        itemCount: items.length,
        runeCount: runes.length,
        spellCount: spells.length,
        upsertedItems: 0,
        upsertedRunes: 0,
        upsertedSpells: 0,
        patchId: null,
      };
    }

    const normalizedMajorMinor = normalizeMajorMinor(resolvedVersion);
    const applied = await prisma.$transaction(
      async (tx) => {
        const patch = await tx.patch.upsert({
          where: { version: resolvedVersion },
          create: {
            version: resolvedVersion,
            normalizedMajorMinor,
            dataDragonVersion: resolvedVersion,
            isActive: false,
            staticDataStatus: 'READY',
          },
          update: {
            normalizedMajorMinor,
            dataDragonVersion: resolvedVersion,
          },
        });

        for (const row of items) {
          await tx.itemStaticData.upsert({
            where: { patchId_itemId: { patchId: patch.id, itemId: row.itemId } },
            create: {
              patchId: patch.id,
              itemId: row.itemId,
              name: row.name,
              description: row.description,
              plaintext: row.plaintext,
              goldData: row.goldData as Prisma.InputJsonValue,
              stats: row.stats as Prisma.InputJsonValue,
              tags: row.tags,
              imageData: row.imageData as Prisma.InputJsonValue,
              purchasable: row.purchasable,
              fromItemIds: row.fromItemIds,
              intoItemIds: row.intoItemIds,
              consumed: row.consumed,
            },
            update: {
              name: row.name,
              description: row.description,
              plaintext: row.plaintext,
              goldData: row.goldData as Prisma.InputJsonValue,
              stats: row.stats as Prisma.InputJsonValue,
              tags: row.tags,
              imageData: row.imageData as Prisma.InputJsonValue,
              purchasable: row.purchasable,
              fromItemIds: row.fromItemIds,
              intoItemIds: row.intoItemIds,
              consumed: row.consumed,
            },
          });
        }

        for (const row of runes) {
          await tx.runeStaticData.upsert({
            where: { patchId_runeId: { patchId: patch.id, runeId: row.runeId } },
            create: {
              patchId: patch.id,
              runeId: row.runeId,
              runeKey: row.runeKey,
              name: row.name,
              shortDescription: row.shortDescription,
              longDescription: row.longDescription,
              icon: row.icon,
              treeId: row.treeId,
              treeName: row.treeName,
              slotIndex: row.slotIndex,
            },
            update: {
              runeKey: row.runeKey,
              name: row.name,
              shortDescription: row.shortDescription,
              longDescription: row.longDescription,
              icon: row.icon,
              treeId: row.treeId,
              treeName: row.treeName,
              slotIndex: row.slotIndex,
            },
          });
        }

        for (const row of spells) {
          await tx.summonerSpellStaticData.upsert({
            where: { patchId_spellId: { patchId: patch.id, spellId: row.spellId } },
            create: {
              patchId: patch.id,
              spellId: row.spellId,
              spellKey: row.spellKey,
              name: row.name,
              description: row.description,
              imageData: row.imageData as Prisma.InputJsonValue,
            },
            update: {
              spellKey: row.spellKey,
              name: row.name,
              description: row.description,
              imageData: row.imageData as Prisma.InputJsonValue,
            },
          });
        }

        return patch.id;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    log(`Upserted build static onto patch ${resolvedVersion} without changing champion isActive`);
    return {
      ok: true,
      dryRun: false,
      resolvedVersion,
      itemCount: items.length,
      runeCount: runes.length,
      spellCount: spells.length,
      upsertedItems: items.length,
      upsertedRunes: runes.length,
      upsertedSpells: spells.length,
      patchId: applied,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    log(message);
    return {
      ok: false,
      dryRun,
      resolvedVersion,
      itemCount: 0,
      runeCount: 0,
      spellCount: 0,
      upsertedItems: 0,
      upsertedRunes: 0,
      upsertedSpells: 0,
      patchId: null,
      error: message,
    };
  }
}
