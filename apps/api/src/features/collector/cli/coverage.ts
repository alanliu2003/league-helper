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
import { parseCollectorCoverageArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import { formatCoverageReportText } from '../collector-cli.output';
import { computeEffectivePlatforms } from '../collector-eligibility.service';
import { CollectorCoverageService } from '../collector-coverage.service';

/** Keep Nest boot/ops logs off stdout so `--json` remains JSON-only. */
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
  'collector:coverage — read-only population / champion coverage observability',
  '',
  'Usage:',
  '  pnpm collector:coverage [--platform <route>] [--queue <id>] [--json]',
  '',
  'Options:',
  '  --platform   Limit platforms (must be in COLLECTOR_PLATFORM_ALLOWLIST)',
  '  --queue      Queue id for coverage (default 420)',
  '  --json       Emit JSON on stdout',
  '  --help       Show this help',
  '',
  'Read-only guarantees:',
  '  - never calls Riot',
  '  - never creates DB rows / CollectorRun / leases',
  '  - never mutates refresh state, priority, nextEligibleAt, or budgets',
  '  - never mutates Redis cooldown',
  '',
  'Exit codes: 0 when report produced; 1 only when report cannot be produced.',
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const config = loadCollectorConfig(process.env);
    const args = parseCollectorCoverageArgs(argv, config);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorCoverageCli'),
    });

    const coverageService = app.get(CollectorCoverageService);
    const effectivePlatforms = computeEffectivePlatforms(
      config.platformAllowlist,
      args.platformFilter,
    );
    const report = await coverageService.report({
      effectivePlatforms,
      queueId: args.queueId,
    });

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout(formatCoverageReportText(report));
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
