import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import {
  cliLog,
  reportCliFailure,
  writeJsonStdout,
  writeTextStdout,
} from '../../players/bootstrap/cli-output';
import { parseCollectorSchedulerStatusArgs } from '../collector.args';
import {
  loadCollectorConfig,
  readCollectorSchedulerEnabled,
} from '../collector.config';
import {
  buildCollectorSchedulerStatusReport,
  formatSchedulerStatusText,
} from '../collector-cli.output';
import { CollectorSchedulerStateRepository } from '../collector-scheduler-state.repository';

class StderrConsoleLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal',
    writeStreamType?: 'stdout' | 'stderr',
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType ?? 'stderr');
  }
}

const HELP_LINES = [
  'collector:scheduler-status — read-only focused scheduler config + singleton state',
  '',
  'Usage:',
  '  pnpm collector:scheduler-status [--json]',
  '',
  'Options:',
  '  --json   Emit JSON on stdout',
  '  --help   Show this help',
  '',
  'Shows config enable (not inferred from lastOutcome), schedule knobs, lease presence',
  '(PRESENT/ABSENT — no owner UUID), outcomes, and cooldown activity.',
  '',
  'Exit codes: 0 when report produced; 1 when report cannot be produced.',
  'Does not mutate runs, leases, players, or enqueue work.',
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const config = loadCollectorConfig(process.env);
    const args = parseCollectorSchedulerStatusArgs(argv);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorSchedulerStatusCli'),
    });

    const schedulerState = app.get(CollectorSchedulerStateRepository);
    // Read-only: do not seed/repair the singleton here (migration owns seed).
    const state = await schedulerState.readState();
    if (state == null) {
      throw new Error(
        'CollectorSchedulerState singleton row is missing (id=singleton). Apply Task 4 migrations.',
      );
    }
    const enabled = readCollectorSchedulerEnabled(process.env);

    const report = buildCollectorSchedulerStatusReport({
      config,
      enabled,
      state,
    });

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout(formatSchedulerStatusText(report));
    }
    process.exitCode = 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reportCliFailure({ argv, message });
    process.exitCode = 1;
  } finally {
    if (app) {
      await Promise.race([
        app.close(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1_500);
        }),
      ]);
    }
  }

  process.exit(process.exitCode ?? 1);
}

void main().catch((error: unknown) => {
  cliLog(error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
