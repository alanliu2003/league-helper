import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PlatformRoute } from '@league-helper/shared';
import { AppModule } from '../../../app.module';
import { GAME_DATA_PROVIDER } from '../../../integrations/riot/riot.tokens';
import {
  cliLog,
  reportCliFailure,
  writeJsonStdout,
  writeTextStdout,
} from '../../players/bootstrap/cli-output';
import { parseCollectorLadderSeedArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import {
  LadderSeedService,
  type LadderSeedProvider,
  type LadderSeedResult,
} from '../ladder/ladder-seed.service';

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
  'collector:ladder-seed — enroll bounded ladder roots (enrollmentSource=LADDER, depth 0)',
  '',
  'Does NOT discover match IDs, enqueue INGEST_MATCH, or run PopulationCollectorService.',
  '',
  'Examples:',
  '  pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers CHALLENGER,GRANDMASTER --dry-run',
  '  pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers CHALLENGER,GRANDMASTER,MASTER --dry-run',
  '  pnpm collector:ladder-seed -- --platform na1 --mode representative --tiers DIAMOND,EMERALD --division I --page 1 --dry-run',
  '  pnpm collector:ladder-seed -- --platform na1 --mode representative --tiers SILVER --division I --page 1 --dry-run',
  '  pnpm collector:ladder-seed -- --platform na1 --mode representative --tiers DIAMOND --max-pages-per-division 1 --dry-run',
  '',
  'Flags:',
  '  --platform <route>                 required (must be allowlisted)',
  '  --mode apex|representative         default: apex',
  '  --tiers <CSV>                      apex default from config; MASTER must be explicit in --tiers',
  '  --division I|II|III|IV             representative (default I with max-pages)',
  '  --page <n>                         representative single page (requires --division)',
  '  --max-pages-per-division <n>       representative pages 1..N (capped by config)',
  '  --dry-run                          ladder fetch + read-only assessment; no creates / Account-v1',
  '  --json                             machine-readable stdout',
  '  --help',
];

function isLadderProvider(value: unknown): value is LadderSeedProvider {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const p = value as Record<string, unknown>;
  return (
    typeof p.getChallengerLeague === 'function' &&
    typeof p.getGrandmasterLeague === 'function' &&
    typeof p.getMasterLeague === 'function' &&
    typeof p.getLeagueEntriesByTierDivision === 'function'
  );
}

function formatReportLines(result: LadderSeedResult): string[] {
  const c = result.counters;
  const byTier = Object.entries(c.byTier)
    .map(([tier, count]) => `${tier}=${count}`)
    .join(',') || 'none';
  return [
    `collector:ladder-seed mode=${result.mode} dryRun=${result.dryRun} platform=${result.platform} queue=${result.leagueQueueType}`,
    `tiers=${result.tiers.join(',')} division=${result.division ?? 'n/a'} pages=${result.pagesRequested.join(',') || 'n/a'}`,
    `fetched=${c.fetched} eligible=${c.eligible} scanned=${c.scanned} created=${c.created} alreadyTracked=${c.alreadyTracked}`,
    `skippedIdentity=${c.skippedIdentity} skippedPlatform=${c.skippedPlatform} skippedLadderCap=${c.skippedLadderCap} skippedTotalCap=${c.skippedTotalCap} errors=${c.errors}`,
    `identityResolved=${c.identityResolved} identityResolveFailed=${c.identityResolveFailed} wouldNeedIdentityResolve=${c.wouldNeedIdentityResolve}`,
    `apexCandidates=${c.apexCandidates} representativeCandidates=${c.representativeCandidates} providerCalls=${c.providerCalls} byTier=${byTier}`,
    `stoppedReason=${result.stoppedReason ?? 'none'}${result.errorMessage ? ` error=${result.errorMessage}` : ''}`,
  ];
}

/**
 * Thin operator CLI for ladder root enrollment.
 * Boots Nest on demand only — no AppModule / worker startup side effects.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const config = loadCollectorConfig(process.env);
    const args = parseCollectorLadderSeedArgs(argv, config);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorLadderSeedCli'),
    });

    const gameData = app.get(GAME_DATA_PROVIDER);
    if (!isLadderProvider(gameData)) {
      throw new Error(
        'GAME_DATA_PROVIDER does not expose league-v4 ladder methods required for ladder-seed.',
      );
    }

    const seeder = app.get(LadderSeedService);
    const result = await seeder.seed(
      {
        platform: args.platform as PlatformRoute,
        mode: args.mode,
        tiers: args.tiers as never,
        dryRun: args.dryRun,
        ...(args.division !== undefined ? { division: args.division } : {}),
        ...(args.page !== undefined ? { page: args.page } : {}),
        ...(args.maxPagesPerDivision !== undefined
          ? { maxPagesPerDivision: args.maxPagesPerDivision }
          : {}),
        leagueQueueType: config.ladderQueueType,
      },
      gameData,
    );

    const report = {
      ok: result.ok,
      mode: result.mode,
      dryRun: result.dryRun,
      platform: result.platform,
      tiers: result.tiers,
      leagueQueueType: result.leagueQueueType,
      division: result.division,
      pagesRequested: result.pagesRequested,
      counters: result.counters,
      stoppedReason: result.stoppedReason,
      ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
      label: 'ladder_root_enrollment',
    };

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout(formatReportLines(result));
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
