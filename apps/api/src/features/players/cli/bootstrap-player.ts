import 'dotenv/config';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadCollectorConfig } from '../../collector/collector.config';
import { maybeEnrollFromBootstrap } from '../../collector/collector-enrollment.hooks';
import { CollectorEnrollmentService } from '../../collector/collector-enrollment.service';
import { loadMatchBootstrapConfig } from '../bootstrap/bootstrap-player.config';
import {
  checkAggregateSmoke,
  createDiscoveryBootstrapCoreDeps,
  createWaitDepsFromPrisma,
  runBootstrapCliMain,
} from '../bootstrap/bootstrap-player-cli';
import { PlayerMatchDiscoveryService } from '../discovery/player-match-discovery.service';

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

      const discovery = app.get(PlayerMatchDiscoveryService);
      const prisma = app.get(PrismaService);
      const logger = new Logger('matches:bootstrap-player');
      const collectorConfig = loadCollectorConfig(process.env);
      const enrollment = app.get(CollectorEnrollmentService);

      const coreDeps = createDiscoveryBootstrapCoreDeps({
        config,
        logger,
        discovery,
        // Flag-gated: omit hook entirely when disabled (zero enrollment work).
        ...(collectorConfig.enrollFromBootstrap
          ? {
              afterSuccessfulUpsert: async (account: {
                id: string;
                provider: string;
                platformRoute: string;
              }) => {
                await maybeEnrollFromBootstrap({
                  enabled: true,
                  enroll: (input) => enrollment.enroll(input),
                  account,
                  warn: (message) => logger.warn(message),
                });
              },
            }
          : {}),
      });

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
