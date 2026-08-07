import { readFile } from 'node:fs/promises';
import type { MatchBootstrapConfig } from './bootstrap-player.config';
import {
  parseBootstrapArgs,
  parseBootstrapPlayersFile,
} from './bootstrap-player.args';
import type { BootstrapCliArgs, BootstrapPlayerTarget } from './bootstrap-player.types';
import type { PlayerMatchDiscoveryService } from '../discovery/player-match-discovery.service';
import {
  bootstrapPlayers,
  type BootstrapCoreDeps,
  type BootstrapCoreLogger,
  type BootstrapDiscoveryCoreDeps,
} from './bootstrap-player-core';
import {
  finalizeBootstrapReport,
  formatBootstrapTextReport,
  resolveBootstrapExitCode,
  type BootstrapCliReport,
} from './bootstrap-report';
import {
  checkAggregateSmoke,
  createWaitDepsFromPrisma,
  resolveAggregateSmokeForRun,
  waitForMatchIngestion,
  type AggregateSmokeLookup,
  type WaitForMatchIngestionDeps,
  type WaitSummary,
} from './bootstrap-verify';
import {
  cliLog,
  reportCliFailure,
  writeJsonStdout,
  writeTextStdout,
} from './cli-output';

export type BootstrapCliIo = {
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  log: (message: string) => void;
  writeJson: (payload: unknown) => void;
  writeText: (lines: string[]) => void;
  reportFailure: (input: { argv: string[]; message: string }) => void;
};

const defaultIo: BootstrapCliIo = {
  readFile: (path, encoding) => readFile(path, encoding),
  log: cliLog,
  writeJson: writeJsonStdout,
  writeText: writeTextStdout,
  reportFailure: reportCliFailure,
};

export async function resolveBootstrapPlayers(
  args: BootstrapCliArgs,
  config: MatchBootstrapConfig,
  io: Pick<BootstrapCliIo, 'readFile'> = defaultIo,
): Promise<BootstrapPlayerTarget[]> {
  if (args.mode === 'file') {
    if (!args.filePath) {
      throw new Error('File mode requires --file <path>.');
    }
    const rawText = await io.readFile(args.filePath, 'utf8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error(`Invalid JSON in players file: ${args.filePath}`);
    }
    return parseBootstrapPlayersFile(parsedJson, config);
  }
  return args.players;
}

export type BootstrapCliRunDeps = {
  config: MatchBootstrapConfig;
  coreDeps: BootstrapCoreDeps;
  waitDeps: WaitForMatchIngestionDeps;
  checkSmoke: () => Promise<AggregateSmokeLookup>;
  now?: () => number;
};

/**
 * Nest-only bootstrap core deps for the live CLI path.
 * Unit tests may still compose low-level `BootstrapCoreDeps` without Nest discovery.
 */
export function createDiscoveryBootstrapCoreDeps(input: {
  config: MatchBootstrapConfig;
  logger: BootstrapCoreLogger;
  discovery: Pick<PlayerMatchDiscoveryService, 'discoverAndEnqueue'>;
  afterSuccessfulUpsert?: BootstrapDiscoveryCoreDeps['afterSuccessfulUpsert'];
}): BootstrapDiscoveryCoreDeps {
  return {
    config: input.config,
    logger: input.logger,
    discoverAndEnqueue: (discoveryInput) =>
      input.discovery.discoverAndEnqueue(discoveryInput, {
        pageSize: input.config.pageSize,
      }),
    ...(input.afterSuccessfulUpsert
      ? { afterSuccessfulUpsert: input.afterSuccessfulUpsert }
      : {}),
  };
}

/**
 * Orchestrate bootstrap CLI: parse → validate file → core → optional wait/smoke → report.
 * Discovery/enqueue stay in core; this layer only wires ops verification.
 */
export async function executeBootstrapCli(input: {
  argv: string[];
  deps: BootstrapCliRunDeps;
  io?: BootstrapCliIo;
}): Promise<{ report: BootstrapCliReport; exitCode: 0 | 1 }> {
  const io = input.io ?? defaultIo;
  const args = parseBootstrapArgs(input.argv, input.deps.config);
  const players = await resolveBootstrapPlayers(args, input.deps.config, io);

  const correlationId = `bootstrap-${(input.deps.now ?? Date.now)()}`;
  const run = await bootstrapPlayers(input.deps.coreDeps, {
    players,
    queueId: args.queueId,
    maxMatches: args.maxMatches,
    dryRun: args.dryRun,
    concurrency: args.concurrency,
    correlationId,
  });

  let waitSummary: WaitSummary | undefined;
  if (args.wait && !args.dryRun) {
    const externalMatchIds = run.players.flatMap((p) => p.externalMatchIds);
    waitSummary = await waitForMatchIngestion(input.deps.waitDeps, {
      provider: 'RIOT',
      externalMatchIds,
      timeoutMs: input.deps.config.waitTimeoutMs,
      pollIntervalMs: input.deps.config.waitPollIntervalMs,
    });
  }

  let smokeLookup: AggregateSmokeLookup = { ok: false };
  if (!args.dryRun && args.wait) {
    smokeLookup = await input.deps.checkSmoke();
  }

  const aggregateSmoke = resolveAggregateSmokeForRun({
    dryRun: args.dryRun,
    waitEnabled: args.wait,
    waitSummary,
    smokeLookup,
  });

  const report = finalizeBootstrapReport({ run, waitSummary, aggregateSmoke });
  const exitCode = resolveBootstrapExitCode(report);

  if (args.json) {
    io.writeJson(report);
  } else {
    io.writeText(formatBootstrapTextReport(report));
  }

  return { report, exitCode };
}

export async function runBootstrapCliMain(input: {
  argv: string[];
  createDeps: () => Promise<{
    deps: BootstrapCliRunDeps;
    close: () => Promise<void>;
  }>;
  io?: BootstrapCliIo;
}): Promise<number> {
  const io = input.io ?? defaultIo;
  let close: (() => Promise<void>) | undefined;

  try {
    const created = await input.createDeps();
    close = created.close;
    const { exitCode } = await executeBootstrapCli({
      argv: input.argv,
      deps: created.deps,
      io,
    });
    return exitCode;
  } catch (error: unknown) {
    io.reportFailure({
      argv: input.argv,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return 1;
  } finally {
    if (close) {
      await Promise.race([
        close(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1_500);
        }),
      ]);
    }
  }
}

/** Re-export for Nest CLI wiring. */
export { createWaitDepsFromPrisma, checkAggregateSmoke };
