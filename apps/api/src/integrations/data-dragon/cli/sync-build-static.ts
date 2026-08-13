import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadChampionStaticSyncConfig } from '../sync/sync-champion-static.config';
import { syncBuildStatic } from '../sync/sync-build-static-core';
import { cliLog, reportCliFailure, writeJsonStdout, writeTextStdout } from '../sync/cli-output';

export type SyncBuildStaticArgs = {
  dryRun: boolean;
  json: boolean;
  version?: string;
};

export function parseBuildStaticSyncArgs(argv: string[]): SyncBuildStaticArgs {
  const args: SyncBuildStaticArgs = { dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--version') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--version requires a Data Dragon version like 16.15.1');
      }
      args.version = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let prisma: PrismaClient | undefined;
  try {
    const args = parseBuildStaticSyncArgs(argv);
    const config = loadChampionStaticSyncConfig({
      ...process.env,
      ...(args.version ? { DATA_DRAGON_VERSION: args.version } : {}),
    });
    prisma = new PrismaClient();
    const result = await syncBuildStatic({
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
        `items=${result.itemCount} runes=${result.runeCount} spells=${result.spellCount}`,
        `upserted items=${result.upsertedItems} runes=${result.upsertedRunes} spells=${result.upsertedSpells}`,
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
