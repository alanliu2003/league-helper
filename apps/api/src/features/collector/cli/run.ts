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
import { parseCollectorRunArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import { CollectorCoverageService } from '../collector-coverage.service';
import {
  buildCollectorApplyReport,
  formatCoverageTextLines,
  resolveCollectorRunExitCode,
} from '../collector-cli.output';
import { CollectorRunError, PopulationCollectorService } from '../population-collector.service';

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

/**
 * Thin collector:run CLI.
 * --dry-run → preview() (optional --sample-discovery)
 * apply → runOnce() then read-only coverage snapshot (Task 9).
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const config = loadCollectorConfig(process.env);
    const args = parseCollectorRunArgs(argv, config);

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorRunCli'),
    });

    const collector = app.get(PopulationCollectorService);

    if (args.dryRun) {
      const preview = await collector.preview({
        platformFilter: args.platformFilter,
        queueId: args.queueId,
        candidateLimit: args.batchSize,
        ...(args.sampleDiscovery !== undefined
          ? { sampleDiscovery: args.sampleDiscovery, maxMatches: args.maxMatches }
          : {}),
      });

      const report = {
        ok: true,
        mode: 'dry-run' as const,
        ...preview,
        candidates: preview.candidates.map((c) => ({
          trackedPlayerId: c.trackedPlayerId,
          playerAccountId: c.playerAccountId,
          platformRoute: c.platformRoute,
          priority: c.priority,
          nextEligibleAt: c.nextEligibleAt.toISOString(),
          lastSuccessfulRefreshAt: c.lastSuccessfulRefreshAt?.toISOString() ?? null,
        })),
      };

      if (args.json) {
        writeJsonStdout(report);
      } else {
        writeTextStdout([
          'collector:run mode=dry-run (read-only eligibility preview; discovery/enqueue orchestration only)',
          `preview eligibility eligibleCount=${preview.eligibleCount} platforms=${preview.effectivePlatforms.join(',')} queue=${preview.queueId}`,
          ...preview.candidates.map(
            (c) =>
              `preview candidate trackedPlayerId=${c.trackedPlayerId} priority=${c.priority} platform=${c.platformRoute}`,
          ),
          ...(preview.sampleDiscovery === undefined
            ? []
            : [
                `sample-discovery estimates count=${preview.sampleDiscovery.length} (read-only Riot match-ID discovery; no enqueue)`,
                ...preview.sampleDiscovery.map(
                  (s) =>
                    `sample-discovery trackedPlayerId=${s.trackedPlayerId} discovered=${s.discoveredMatchCount} wouldEnqueue=${s.wouldEnqueueCount}`,
                ),
              ]),
        ]);
      }
      process.exitCode = 0;
      return;
    }

    const result = await collector.runOnce({
      platformFilter: args.platformFilter,
      queueId: args.queueId,
      batchLimit: args.batchSize,
      concurrency: args.concurrency,
      matchesPerPlayer: args.maxMatches,
      maxMatchIdsPerRun: args.maxMatchIds,
      maxEnqueuePerRun: args.maxEnqueue,
    });

    const coverageService = app.get(CollectorCoverageService);
    const coverage = await coverageService.snapshotSafe({
      effectivePlatforms: result.effectivePlatforms,
      queueId: result.queueId,
    });

    const report = buildCollectorApplyReport(result, coverage);

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout([
        'collector:run mode=apply (discovery/enqueue orchestration; not ingestion/aggregation completion)',
        `CollectorRun status=${result.status} runId=${result.runId} durationMs=${result.durationMs} platforms=${result.effectivePlatforms.join(',')} queue=${result.queueId}`,
        `players claimed=${result.counters.playersClaimed} attempted=${result.counters.playersAttempted} succeeded=${result.counters.playersSucceeded} failed=${result.counters.playersFailed} ownershipLost=${result.counters.ownershipLost}`,
        `matchIds discovered=${result.counters.matchIdsDiscovered} matches enqueued=${result.counters.matchesEnqueued} skippedAlreadyComplete=${result.counters.matchesSkippedComplete}`,
        `rateLimitStops=${result.counters.rateLimitStops} budgetExhausted=${result.counters.budgetExhausted}${result.counters.failureCode ? ` failureCode=${result.counters.failureCode}` : ''}`,
        ...formatCoverageTextLines(coverage),
      ]);
    }

    process.exitCode = resolveCollectorRunExitCode(result.status);
  } catch (error: unknown) {
    const message =
      error instanceof CollectorRunError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown error';
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
