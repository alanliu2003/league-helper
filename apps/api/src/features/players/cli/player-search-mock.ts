import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  DomainError,
  PlayerSearchRequestSchema,
  serializeDomainError,
} from '@league-helper/shared';
import { AppModule } from '../../../app.module';
import { PlayerSearchService } from '../player-search.service';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const gameName = readArg('--game-name') ?? 'MockPlayer';
  const tagLine = readArg('--tag-line') ?? 'NA1';
  const platform = readArg('--platform') ?? 'na1';
  const matchCountRaw = readArg('--match-count');
  const matchCount = matchCountRaw ? Number(matchCountRaw) : undefined;

  const request = PlayerSearchRequestSchema.parse({
    gameName,
    tagLine,
    platform,
    ...(matchCount !== undefined ? { matchCount } : {}),
  });

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const searchService = app.get(PlayerSearchService);
    const correlationId = `cli-search-${Date.now()}`;
    const response = await searchService.search(request, correlationId);
    // Safe summary only — never print PUUID or secrets.
    console.log(
      JSON.stringify({
        ok: true,
        playerId: response.player.id,
        riotId: `${response.player.riotId.gameName}#${response.player.riotId.tagLine}`,
        platform: response.player.platform,
        ranks: response.ranks.length,
        mastery: response.mastery.length,
        refreshState: response.refresh.state,
        queuedMatchCount: response.refresh.queuedMatchCount,
        warnings: response.refresh.warnings.length,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      console.error(JSON.stringify(serializeDomainError(error), null, 2));
      process.exitCode = 1;
      return;
    }
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
    process.exitCode = 1;
  } finally {
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 1_500);
      }),
    ]);
    process.exit(process.exitCode ?? 0);
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'unknown',
    }),
  );
  process.exit(1);
});
