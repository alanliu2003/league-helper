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
import { parseCollectorAuditArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import { CollectorAuditService } from '../collector-audit.service';
import type { CollectorAuditReport } from '../collector.types';

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
  'collector:audit — read-only invariant findings for discovery/enqueue orchestration',
  '',
  'Usage:',
  '  pnpm collector:audit [--json]',
  '',
  'Options:',
  '  --json   Emit JSON on stdout',
  '  --help   Show this help',
  '',
  'Exit codes: 0 when no findings; 1 when findings exist or audit execution fails.',
  'Does not auto-repair, clear leases, mutate runs, or enqueue work.',
];

function formatAuditText(report: CollectorAuditReport): string[] {
  const lines = [
    'collector:audit (read-only discovery/enqueue orchestration invariants)',
    `generatedAt=${report.generatedAt}`,
    `findingCount=${report.findingCount}`,
  ];

  if (report.findings.length === 0) {
    lines.push('ok — no findings');
    return lines;
  }

  for (const finding of report.findings) {
    lines.push(
      `finding code=${finding.code} severity=${finding.severity} safeId=${finding.safeId} message=${finding.message}`,
    );
  }

  return lines;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    // Validate collector config early (timing invariants) before Nest boot.
    loadCollectorConfig(process.env);
    const args = parseCollectorAuditArgs(argv);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorAuditCli'),
    });

    const auditService = app.get(CollectorAuditService);
    const report = await auditService.audit();

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout(formatAuditText(report));
    }
    process.exitCode = report.findingCount === 0 ? 0 : 1;
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
