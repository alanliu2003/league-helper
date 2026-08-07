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
import { parseCollectorSchedulerTriggerArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import {
  buildSchedulerTriggerReport,
  resolveSchedulerTriggerExitCode,
} from '../collector-cli.output';
import { CollectorSchedulerService } from '../collector-scheduler.service';

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
  'collector:scheduler-trigger — one-shot CollectorSchedulerService.tick()',
  '',
  'Usage:',
  '  pnpm collector:scheduler-trigger [--json]',
  '',
  'Options:',
  '  --json   Emit JSON on stdout',
  '  --help   Show this help',
  '',
  'Uses the same owner-safe guards as the long-running scheduler',
  '(enabled / lease / cooldown / backpressure / runOnce). Does not bypass safety.',
  '',
  'Exit codes:',
  '  0  TRIGGERED, SKIPPED_DISABLED, SKIPPED_OVERLAP, SKIPPED_BACKPRESSURE, SKIPPED_COOLDOWN',
  '  1  FAILED_TO_START or CLI/bootstrap failure',
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    loadCollectorConfig(process.env);
    const args = parseCollectorSchedulerTriggerArgs(argv);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorSchedulerTriggerCli'),
    });

    const scheduler = app.get(CollectorSchedulerService);
    const result = await scheduler.tick();
    const report = buildSchedulerTriggerReport(result);

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout([
        'collector:scheduler-trigger (one-shot owner-safe tick)',
        `outcome=${report.outcome}`,
        ...(report.collectorRunId
          ? [`collectorRunId=${report.collectorRunId}`]
          : []),
        ...(report.errorCode ? [`errorCode=${report.errorCode}`] : []),
      ]);
    }

    process.exitCode = resolveSchedulerTriggerExitCode(result.outcome);
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
