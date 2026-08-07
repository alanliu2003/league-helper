import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import {
  cliLog,
  reportCliFailure,
  writeTextStdout,
} from '../../players/bootstrap/cli-output';
import { parseCollectorSchedulerArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
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
  'collector:scheduler — long-running owner-safe PopulationCollector schedule loop',
  '',
  'Usage:',
  '  pnpm collector:scheduler',
  '',
  'Options:',
  '  --help   Show this help',
  '',
  'Behavior:',
  '  - Bootstraps Nest application context (no HTTP server).',
  '  - Runs CollectorSchedulerService.runLoop until SIGINT/SIGTERM.',
  '  - Each tick respects COLLECTOR_SCHEDULER_ENABLED, lease, cooldown, and backpressure.',
  '  - Does not start from AppModule / normal API boot.',
  '',
  'Shutdown:',
  '  - Aborts future loop waits; allows in-flight tick to settle when possible.',
  '  - Owner-protected lease release happens inside tick() finally.',
  '',
  'Exit codes: 0 on clean shutdown; 1 on bootstrap/runtime failure.',
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  const controller = new AbortController();

  const onSignal = (): void => {
    controller.abort();
  };

  try {
    // Validate collector config (including lease TTL invariants) before Nest boot.
    loadCollectorConfig(process.env);
    const args = parseCollectorSchedulerArgs(argv);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorSchedulerCli'),
    });

    const scheduler = app.get(CollectorSchedulerService);

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    await scheduler.runLoop(controller.signal);
    process.exitCode = 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reportCliFailure({ argv, message });
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
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
