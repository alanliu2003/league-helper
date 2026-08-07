import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { parsePlatformRoute, type GameDataProvider } from '@league-helper/shared';
import { AppModule } from '../../../app.module';
import { GAME_DATA_PROVIDER } from '../../../integrations/riot/riot.tokens';
import { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import {
  cliLog,
  reportCliFailure,
  writeJsonStdout,
  writeTextStdout,
} from '../../players/bootstrap/cli-output';
import {
  parseCollectorSeedArgs,
  parseCollectorSeedPlayersFile,
} from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import { CollectorEnrollmentService } from '../collector-enrollment.service';
import type { CollectorSeedPlayerTarget } from '../collector.types';

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

type SeedPlayerResult = {
  ok: boolean;
  gameName: string;
  tagLine: string;
  platform: string;
  trackedPlayerId?: string;
  status?: string;
  created?: boolean;
  reactivated?: boolean;
  code?: string;
  error?: string;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index] as T);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function seedOne(input: {
  target: CollectorSeedPlayerTarget;
  reactivate: boolean;
  gameData: GameDataProvider;
  playerAccounts: PlayerAccountRepository;
  enrollment: CollectorEnrollmentService;
}): Promise<SeedPlayerResult> {
  const { target } = input;
  try {
    const resolved = await input.gameData.resolvePlayer({
      gameName: target.gameName,
      tagLine: target.tagLine,
      platform: parsePlatformRoute(target.platform),
    });

    const account = await input.playerAccounts.upsertPlayerAccount({
      provider: resolved.provider,
      externalAccountId: resolved.externalAccountId,
      platformRoute: resolved.platform,
      regionalRoute: resolved.regionalRoute,
      gameName: resolved.riotId.gameName,
      tagLine: resolved.riotId.tagLine,
      summonerId: resolved.summonerId ?? null,
      accountId: resolved.accountId ?? null,
      profileIconId: resolved.profileIconId ?? null,
      summonerLevel: resolved.summonerLevel ?? null,
      lastResolvedAt: new Date(),
    });

    const enrolled = await input.enrollment.enroll({
      account: {
        id: account.id,
        provider: account.provider,
        platformRoute: account.platformRoute,
      },
      source: 'ADMIN_SEED',
      ...(target.priority !== undefined ? { priority: target.priority } : {}),
      reactivate: input.reactivate,
    });

    if (!enrolled.ok) {
      return {
        ok: false,
        gameName: target.gameName,
        tagLine: target.tagLine,
        platform: target.platform,
        code: enrolled.code,
        error: enrolled.message,
      };
    }

    return {
      ok: true,
      gameName: target.gameName,
      tagLine: target.tagLine,
      platform: target.platform,
      trackedPlayerId: enrolled.trackedPlayerId,
      status: enrolled.status,
      created: enrolled.created,
      reactivated: enrolled.reactivated,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      gameName: target.gameName,
      tagLine: target.tagLine,
      platform: target.platform,
      error: error instanceof Error ? error.message : 'Seed failed',
    };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const config = loadCollectorConfig(process.env);
    const args = parseCollectorSeedArgs(argv, config);

    let players = args.players;
    if (args.mode === 'file') {
      if (!args.filePath) {
        throw new Error('File mode requires --file <path>.');
      }
      // Complete Zod file validation BEFORE any Riot call / Nest provider use.
      const rawText = await readFile(args.filePath, 'utf8');
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText) as unknown;
      } catch {
        throw new Error(`Invalid JSON in players file: ${args.filePath}`);
      }
      players = parseCollectorSeedPlayersFile(parsedJson);
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorSeedPlayerCli'),
    });

    const gameData = app.get<GameDataProvider>(GAME_DATA_PROVIDER);
    const playerAccounts = app.get(PlayerAccountRepository);
    const enrollment = app.get(CollectorEnrollmentService);

    const results = await mapPool(players, args.concurrency, (target) =>
      seedOne({
        target,
        reactivate: args.reactivate,
        gameData,
        playerAccounts,
        enrollment,
      }),
    );

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    const report = {
      ok: failed === 0,
      total: results.length,
      succeeded,
      failed,
      players: results,
    };

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout([
        `collector:seed-player total=${report.total} succeeded=${succeeded} failed=${failed}`,
        ...results.map((r) =>
          r.ok
            ? `OK ${r.gameName}#${r.tagLine} (${r.platform}) trackedPlayerId=${r.trackedPlayerId} status=${r.status}`
            : `FAIL ${r.gameName}#${r.tagLine} (${r.platform}) ${r.code ?? ''} ${r.error ?? ''}`.trim(),
        ),
      ]);
    }

    process.exitCode = failed === 0 ? 0 : 1;
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
