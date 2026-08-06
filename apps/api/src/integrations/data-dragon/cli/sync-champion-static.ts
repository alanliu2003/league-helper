import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadChampionStaticSyncConfig } from '../sync/sync-champion-static.config';
import { parseSyncArgs } from '../sync/sync-champion-static.args';
import { syncChampionStatic } from '../sync/sync-champion-static-core';
import {
  cliLog,
  reportCliFailure,
  writeJsonStdout,
  writeTextStdout,
} from '../sync/cli-output';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let prisma: PrismaClient | undefined;

  try {
    const args = parseSyncArgs(argv);
    const config = loadChampionStaticSyncConfig(process.env);
    prisma = new PrismaClient();

    const result = await syncChampionStatic({
      config,
      prisma,
      dryRun: args.dryRun,
      log: cliLog,
    });

    if (args.json) {
      writeJsonStdout(result);
    } else {
      writeTextStdout([
        `ok=${result.ok} dryRun=${result.dryRun} version=${result.resolvedVersion}`,
        `discovered=${result.discovered} new=${result.newCount} changed=${result.changedCount} unchanged=${result.unchangedCount}`,
        `upserted=${result.upsertedCount} activePatch=${result.activePatchVersion ?? 'n/a'} activePatchId=${result.activePatchId ?? 'n/a'}`,
        `championRowCount=${result.championRowCount ?? 'n/a'} distinctChampionKeyCount=${result.distinctChampionKeyCount ?? 'n/a'}`,
        ...(result.error ? [`error=${result.error}`] : []),
      ]);
    }

    process.exitCode = result.ok ? 0 : 1;
  } catch (error: unknown) {
    reportCliFailure({
      argv: process.argv,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((error: unknown) => {
  reportCliFailure({
    argv: process.argv,
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
});
