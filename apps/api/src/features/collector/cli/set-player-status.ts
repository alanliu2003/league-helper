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
import { parseCollectorSetStatusArgs } from '../collector.args';
import { CollectorEnrollmentService } from '../collector-enrollment.service';

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const args = parseCollectorSetStatusArgs(argv);

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorSetPlayerStatusCli'),
    });

    const enrollment = app.get(CollectorEnrollmentService);
    const result = await enrollment.setPlayerStatus({
      trackedPlayerId: args.trackedPlayerId,
      status: args.status,
      force: args.force,
      resetFailures: args.resetFailures,
    });

    if (args.json) {
      writeJsonStdout(result);
    } else if (result.ok) {
      writeTextStdout([
        `collector:set-player-status ok trackedPlayerId=${result.trackedPlayerId} status=${result.status} leaseCleared=${result.leaseCleared} failuresReset=${result.failuresReset}`,
      ]);
    } else {
      cliLog(`${result.code}: ${result.message}`);
    }

    process.exitCode = result.ok ? 0 : 1;
  } catch (error: unknown) {
    reportCliFailure({
      argv,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
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
