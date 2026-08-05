import 'dotenv/config';
import {
  ProviderForbiddenError,
  ProviderNotConfiguredError,
  ProviderRateLimitedError,
  ProviderResponseInvalidError,
  ProviderUnauthorizedError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  ValidationFailureError,
  parsePlatformRoute,
} from '@league-helper/shared';
import {
  loadRiotConfig,
  MockRiotGameDataProvider,
  RiotApiClient,
  RiotGameDataProvider,
} from '@league-helper/server-riot';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const gameName = readArg('--game-name');
  const tagLine = readArg('--tag-line');
  const platformRaw = readArg('--platform');

  if (!gameName || !tagLine || !platformRaw) {
    console.error('Usage: pnpm riot:resolve --game-name "Example" --tag-line "NA1" --platform na1');
    process.exitCode = 1;
    return;
  }

  const config = loadRiotConfig();
  const platform = parsePlatformRoute(platformRaw);
  const provider =
    config.providerMode === 'mock'
      ? new MockRiotGameDataProvider()
      : new RiotGameDataProvider(RiotApiClient.create(config));

  try {
    const player = await provider.resolvePlayer({ gameName, tagLine, platform });
    console.log(
      JSON.stringify(
        {
          provider: player.provider,
          externalAccountId: player.externalAccountId,
          gameName: player.riotId.gameName,
          tagLine: player.riotId.tagLine,
          platform: player.platform,
          regionalRoute: player.regionalRoute,
          profileIconId: player.profileIconId ?? null,
          summonerLevel: player.summonerLevel ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    handleCliError(error);
  }
}

function handleCliError(error: unknown): void {
  if (error instanceof ResourceNotFoundError) {
    console.error(`Not found (404): ${error.message}`);
    process.exitCode = 404;
    return;
  }
  if (error instanceof ProviderForbiddenError) {
    console.error(`Forbidden (403): ${error.message}`);
    console.error(
      'Riot development keys expire regularly. Refresh your key at https://developer.riotgames.com/ and update RIOT_API_KEY.',
    );
    process.exitCode = 403;
    return;
  }
  if (error instanceof ProviderUnauthorizedError || error instanceof ProviderNotConfiguredError) {
    console.error(`Authentication/configuration error: ${error.message}`);
    process.exitCode = 401;
    return;
  }
  if (error instanceof ProviderRateLimitedError) {
    const details = error.details as { retryAfterSeconds?: number | null } | undefined;
    console.error(
      `Rate limited (429). retryAfterSeconds=${details?.retryAfterSeconds ?? 'unknown'}`,
    );
    process.exitCode = 429;
    return;
  }
  if (error instanceof ProviderUnavailableError) {
    const details = error.details as { reason?: string } | undefined;
    console.error(
      `Provider unavailable: ${error.message} (reason=${details?.reason ?? 'unknown'})`,
    );
    process.exitCode = 503;
    return;
  }
  if (error instanceof ProviderResponseInvalidError) {
    console.error(`Invalid provider response: ${error.message}`);
    process.exitCode = 502;
    return;
  }
  if (error instanceof ValidationFailureError) {
    console.error(`Validation error: ${error.message}`);
    process.exitCode = 400;
    return;
  }

  console.error('Unexpected error while resolving Riot ID.');
  process.exitCode = 1;
}

void main();
