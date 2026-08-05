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
  getRegionalRouteForPlatform,
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
  const puuid = readArg('--puuid');
  const platformRaw = readArg('--platform');
  const countRaw = readArg('--count') ?? '5';

  if (!puuid || !platformRaw) {
    console.error(
      'Usage: pnpm riot:match-ids --puuid "fake-or-real-puuid" --platform na1 --count 5',
    );
    process.exitCode = 1;
    return;
  }

  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    console.error('count must be an integer between 1 and 100.');
    process.exitCode = 400;
    return;
  }

  const config = loadRiotConfig();
  const platform = parsePlatformRoute(platformRaw);
  const regionalRoute = getRegionalRouteForPlatform(platform);
  const provider =
    config.providerMode === 'mock'
      ? new MockRiotGameDataProvider()
      : new RiotGameDataProvider(RiotApiClient.create(config));

  const player = {
    provider: 'RIOT' as const,
    externalAccountId: puuid,
    riotId: { gameName: 'CliUser', tagLine: 'DEV' },
    platform,
    regionalRoute,
  };

  try {
    const matchIds = await provider.getRecentMatchIds(player, { count });
    console.log(
      JSON.stringify(
        {
          platform,
          regionalRoute,
          count: matchIds.length,
          matchIds,
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

  console.error('Unexpected error while fetching match IDs.');
  process.exitCode = 1;
}

void main();
