import type { Prisma, PrismaClient, StaticDataStatus } from '@prisma/client';
import type { ChampionStaticSyncConfig } from './sync-champion-static.config';
import {
  fetchChampionFullFile,
  fetchChampionStaticFile,
  resolveDataDragonVersion,
  type SyncFetchDeps,
} from './sync-champion-static.fetch';
import {
  mapDataDragonChampionEntry,
  normalizeMajorMinor,
  overlayChampionAbilitySnapshots,
} from './sync-champion-static.mapper';
import type { MappedChampionStaticRow } from './sync-champion-static.types';

export type ChampionStaticSyncResult = {
  ok: boolean;
  dryRun: boolean;
  resolvedVersion: string;
  discovered: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  upsertedCount: number;
  activePatchId: string | null;
  activePatchVersion: string | null;
  championRowCount: number | null;
  distinctChampionKeyCount: number | null;
  error?: string;
};

type ExistingChampionRow = {
  championId: number;
  championKey: string;
  name: string;
  title: string;
  tags: string[];
  baseStats: unknown;
  imageData: unknown;
  passive: unknown;
  spells: unknown;
};

type PatchRow = {
  id: string;
  version: string;
  isActive: boolean;
  staticDataStatus: StaticDataStatus;
  dataDragonVersion: string | null;
  normalizedMajorMinor: string;
};

type TransactionOptions = {
  timeout?: number;
  maxWait?: number;
};

/** Narrow Prisma surface used by sync (for unit tests + PrismaClient). */
export type ChampionStaticSyncPrisma = {
  patch: {
    findUnique: (args: {
      where: { version: string };
      select?: { id?: boolean; version?: boolean; isActive?: boolean };
    }) => Promise<Pick<PatchRow, 'id' | 'version' | 'isActive'> | null>;
    findFirst: (args: {
      where: { isActive: boolean };
      select?: { id?: boolean; version?: boolean };
    }) => Promise<Pick<PatchRow, 'id' | 'version'> | null>;
    upsert: (args: {
      where: { version: string };
      create: {
        version: string;
        normalizedMajorMinor: string;
        dataDragonVersion: string;
        isActive: boolean;
        staticDataStatus: StaticDataStatus;
      };
      update: {
        normalizedMajorMinor: string;
        dataDragonVersion: string;
      };
    }) => Promise<PatchRow>;
    update: (args: {
      where: { id: string };
      data: { isActive?: boolean; staticDataStatus?: StaticDataStatus };
    }) => Promise<PatchRow>;
    updateMany: (args: {
      where: { isActive: boolean; id?: { not: string } };
      data: { isActive: boolean };
    }) => Promise<{ count: number }>;
  };
  championStaticData: {
    findMany: (args: {
      where: { patchId: string };
      select?: {
        championId?: boolean;
        championKey?: boolean;
        name?: boolean;
        title?: boolean;
        tags?: boolean;
        baseStats?: boolean;
        imageData?: boolean;
        passive?: boolean;
        spells?: boolean;
      };
    }) => Promise<ExistingChampionRow[]>;
    upsert: (args: {
      where: { patchId_championId: { patchId: string; championId: number } };
      create: {
        patchId: string;
        championId: number;
        championKey: string;
        name: string;
        title: string;
        tags: string[];
        baseStats: Prisma.InputJsonValue;
        passive: Prisma.InputJsonValue;
        spells: Prisma.InputJsonValue;
        imageData: Prisma.InputJsonValue;
        rawPayload: null;
      };
      update: {
        championKey: string;
        name: string;
        title: string;
        tags: string[];
        baseStats: Prisma.InputJsonValue;
        passive: Prisma.InputJsonValue;
        spells: Prisma.InputJsonValue;
        imageData: Prisma.InputJsonValue;
        rawPayload: null;
      };
    }) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<unknown>;
  };
  $transaction: <T>(
    fn: (tx: ChampionStaticSyncPrisma) => Promise<T>,
    options?: TransactionOptions,
  ) => Promise<T>;
};

export type SyncChampionStaticInput = {
  config: ChampionStaticSyncConfig;
  prisma: ChampionStaticSyncPrisma | PrismaClient;
  dryRun: boolean;
  fetchDeps?: SyncFetchDeps;
  log?: (msg: string) => void;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((tag, index) => tag === right[index]);
}

export function classifyChampionDiff(
  mapped: MappedChampionStaticRow[],
  existing: ExistingChampionRow[],
): { newCount: number; changedCount: number; unchangedCount: number } {
  const byId = new Map(existing.map((row) => [row.championId, row]));
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const row of mapped) {
    const prior = byId.get(row.championId);
    if (!prior) {
      newCount += 1;
      continue;
    }
    const changed =
      prior.championKey !== row.championKey ||
      prior.name !== row.name ||
      prior.title !== row.title ||
      !tagsEqual(prior.tags, row.tags) ||
      stableJson(prior.imageData) !== stableJson(row.imageData) ||
      stableJson(prior.baseStats) !== stableJson(row.baseStats) ||
      stableJson(prior.passive ?? {}) !== stableJson(row.passive ?? {}) ||
      stableJson(prior.spells ?? []) !== stableJson(row.spells ?? []);
    if (changed) {
      changedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }

  return { newCount, changedCount, unchangedCount };
}

/** Reject duplicate identities before dry-run or DB writes. */
export function findDuplicateChampionIdentities(mapped: MappedChampionStaticRow[]): string | null {
  const seenIds = new Map<number, string>();
  const seenKeys = new Map<string, number>();

  for (const row of mapped) {
    const priorKey = seenIds.get(row.championId);
    if (priorKey !== undefined) {
      return `Duplicate championId ${row.championId} in mapped payload (keys: ${priorKey}, ${row.championKey})`;
    }
    const priorId = seenKeys.get(row.championKey);
    if (priorId !== undefined) {
      return `Duplicate championKey ${row.championKey} in mapped payload (ids: ${priorId}, ${row.championId})`;
    }
    seenIds.set(row.championId, row.championKey);
    seenKeys.set(row.championKey, row.championId);
  }

  return null;
}

function failureResult(
  partial: Omit<ChampionStaticSyncResult, 'ok'> & { error: string },
): ChampionStaticSyncResult {
  return { ...partial, ok: false };
}

export async function syncChampionStatic(
  input: SyncChampionStaticInput,
): Promise<ChampionStaticSyncResult> {
  const log = input.log ?? (() => undefined);
  const prisma = input.prisma as ChampionStaticSyncPrisma;

  let resolvedVersion = '';
  let discovered = 0;
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let upsertedCount = 0;
  let activePatchId: string | null = null;
  let activePatchVersion: string | null = null;
  let championRowCount: number | null = null;
  let distinctChampionKeyCount: number | null = null;

  try {
    resolvedVersion = await resolveDataDragonVersion(input.config, input.fetchDeps);
    log(`Resolved Data Dragon version: ${resolvedVersion}`);

    const file = await fetchChampionStaticFile(input.config, resolvedVersion, input.fetchDeps);
    const mapped = Object.values(file.data).map((entry) => mapDataDragonChampionEntry(entry));
    discovered = mapped.length;

    try {
      const fullFile = await fetchChampionFullFile(input.config, resolvedVersion, input.fetchDeps);
      overlayChampionAbilitySnapshots(mapped, fullFile);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      log(`Champion ability overlay skipped: ${detail}`);
    }

    if (discovered < input.config.minChampions) {
      return failureResult({
        dryRun: input.dryRun,
        resolvedVersion,
        discovered,
        newCount: 0,
        changedCount: 0,
        unchangedCount: 0,
        upsertedCount: 0,
        activePatchId: null,
        activePatchVersion: null,
        championRowCount: null,
        distinctChampionKeyCount: null,
        error: `Champion count ${discovered} is below minimum ${input.config.minChampions}`,
      });
    }

    const duplicateError = findDuplicateChampionIdentities(mapped);
    if (duplicateError) {
      return failureResult({
        dryRun: input.dryRun,
        resolvedVersion,
        discovered,
        newCount: 0,
        changedCount: 0,
        unchangedCount: 0,
        upsertedCount: 0,
        activePatchId: null,
        activePatchVersion: null,
        championRowCount: null,
        distinctChampionKeyCount: null,
        error: duplicateError,
      });
    }

    const existingPatch = await prisma.patch.findUnique({
      where: { version: resolvedVersion },
      select: { id: true, version: true, isActive: true },
    });

    const existingRows: ExistingChampionRow[] = existingPatch
      ? await prisma.championStaticData.findMany({
          where: { patchId: existingPatch.id },
          select: {
            championId: true,
            championKey: true,
            name: true,
            title: true,
            tags: true,
            baseStats: true,
            imageData: true,
            passive: true,
            spells: true,
          },
        })
      : [];

    ({ newCount, changedCount, unchangedCount } = classifyChampionDiff(mapped, existingRows));

    if (input.dryRun) {
      log(
        `Dry-run: discovered=${discovered} new=${newCount} changed=${changedCount} unchanged=${unchangedCount}`,
      );
      return {
        ok: true,
        dryRun: true,
        resolvedVersion,
        discovered,
        newCount,
        changedCount,
        unchangedCount,
        upsertedCount: 0,
        activePatchId: null,
        activePatchVersion: null,
        championRowCount: null,
        distinctChampionKeyCount: null,
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

        for (const row of mapped) {
          await tx.championStaticData.upsert({
            where: {
              patchId_championId: { patchId: patch.id, championId: row.championId },
            },
            create: {
              patchId: patch.id,
              championId: row.championId,
              championKey: row.championKey,
              name: row.name,
              title: row.title,
              tags: row.tags,
              baseStats: row.baseStats as Prisma.InputJsonValue,
              passive: row.passive as Prisma.InputJsonValue,
              spells: row.spells as Prisma.InputJsonValue,
              imageData: row.imageData as Prisma.InputJsonValue,
              rawPayload: null,
            },
            update: {
              championKey: row.championKey,
              name: row.name,
              title: row.title,
              tags: row.tags,
              baseStats: row.baseStats as Prisma.InputJsonValue,
              passive: row.passive as Prisma.InputJsonValue,
              spells: row.spells as Prisma.InputJsonValue,
              imageData: row.imageData as Prisma.InputJsonValue,
              rawPayload: null,
            },
          });
        }

        await tx.patch.updateMany({
          where: { isActive: true, id: { not: patch.id } },
          data: { isActive: false },
        });

        const activated = await tx.patch.update({
          where: { id: patch.id },
          data: { isActive: true, staticDataStatus: 'READY' },
        });

        return { patch: activated, upsertedCount: mapped.length };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    upsertedCount = applied.upsertedCount;
    activePatchId = applied.patch.id;
    activePatchVersion = applied.patch.version;

    const verificationRows = await prisma.championStaticData.findMany({
      where: { patchId: applied.patch.id },
      select: { championKey: true },
    });
    championRowCount = verificationRows.length;
    distinctChampionKeyCount = new Set(verificationRows.map((row) => row.championKey)).size;

    if (
      championRowCount < input.config.minChampions ||
      distinctChampionKeyCount !== championRowCount
    ) {
      return failureResult({
        dryRun: false,
        resolvedVersion,
        discovered,
        newCount,
        changedCount,
        unchangedCount,
        upsertedCount,
        activePatchId,
        activePatchVersion,
        championRowCount,
        distinctChampionKeyCount,
        error: `Post-sync verification failed after activation already committed: rows=${championRowCount} distinctKeys=${distinctChampionKeyCount} min=${input.config.minChampions}`,
      });
    }

    log(
      `Synced ${upsertedCount} champions for ${resolvedVersion}; verification rows=${championRowCount}`,
    );

    return {
      ok: true,
      dryRun: false,
      resolvedVersion,
      discovered,
      newCount,
      changedCount,
      unchangedCount,
      upsertedCount,
      activePatchId,
      activePatchVersion,
      championRowCount,
      distinctChampionKeyCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    log(message);
    return failureResult({
      dryRun: input.dryRun,
      resolvedVersion,
      discovered,
      newCount,
      changedCount,
      unchangedCount,
      upsertedCount,
      activePatchId,
      activePatchVersion,
      championRowCount,
      distinctChampionKeyCount,
      error: message,
    });
  }
}
