import 'dotenv/config';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { GameDataProvider } from '@league-helper/shared';
import { AppModule } from '../../../app.module';
import { PLAYER_REFRESH_CONFIG } from '../../../config/player-refresh.config';
import type { PlayerRefreshConfig } from '../../../config/player-refresh.config';
import { GAME_DATA_PROVIDER } from '../../../integrations/riot/riot.tokens';
import { IngestionJobRepository } from '../../../persistence/ingestion-job.repository';
import { MatchRepository } from '../../../persistence/match.repository';
import { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import { RankSnapshotRepository } from '../../../persistence/rank-snapshot.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { MatchIngestionProducer } from '../../../queues/match-ingestion.producer';
import { PlayerCacheService } from '../player-cache.service';
import { loadMatchBootstrapConfig } from '../bootstrap/bootstrap-player.config';
import {
  checkAggregateSmoke,
  createWaitDepsFromPrisma,
  runBootstrapCliMain,
} from '../bootstrap/bootstrap-player-cli';
import type { BootstrapCoreDeps } from '../bootstrap/bootstrap-player-core';

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const exitCode = await runBootstrapCliMain({
    argv,
    createDeps: async () => {
      const config = loadMatchBootstrapConfig(process.env);
      const app = await NestFactory.createApplicationContext(AppModule, {
        logger: new StderrConsoleLogger('BootstrapPlayerCli'),
      });

      const gameData = app.get<GameDataProvider>(GAME_DATA_PROVIDER);
      const playerAccounts = app.get(PlayerAccountRepository);
      const rankSnapshots = app.get(RankSnapshotRepository);
      const matches = app.get(MatchRepository);
      const ingestionJobs = app.get(IngestionJobRepository);
      const producer = app.get(MatchIngestionProducer);
      const cache = app.get(PlayerCacheService);
      const refreshConfig = app.get<PlayerRefreshConfig>(PLAYER_REFRESH_CONFIG);
      const prisma = app.get(PrismaService);
      const logger = new Logger('matches:bootstrap-player');

      const coreDeps: BootstrapCoreDeps = {
        resolvePlayer: (input) => gameData.resolvePlayer(input),
        getRankedEntries: (account) => gameData.getRankedEntries(account),
        getRecentMatchIds: (account, options) => gameData.getRecentMatchIds(account, options),
        upsertPlayerAccount: (input) => playerAccounts.upsertPlayerAccount(input),
        insertRankIfChanged: (input) => rankSnapshots.insertIfChanged(input),
        enqueueDeps: {
          matches,
          ingestionJobs,
          producer,
          matchIngestionJobAttempts: refreshConfig.matchIngestionJobAttempts,
          logger,
          invalidatePlayerCache: (playerId) => cache.invalidate(playerId),
        },
        config,
        logger,
      };

      return {
        deps: {
          config,
          coreDeps,
          waitDeps: createWaitDepsFromPrisma(prisma),
          checkSmoke: () => checkAggregateSmoke(prisma),
        },
        close: async () => {
          await app.close();
        },
      };
    },
  });

  process.exitCode = exitCode;
  process.exit(exitCode);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
