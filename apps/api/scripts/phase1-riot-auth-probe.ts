/**
 * Read-only M12-v2 Phase 1 Riot auth probe.
 * Never logs API keys. Infers operating mode only from app rate-limit windows.
 */
import 'dotenv/config';
import {
  ProviderForbiddenError,
  ProviderUnauthorizedError,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
} from '@league-helper/shared';
import {
  RIOT_LEAGUE_QUEUE_RANKED_SOLO,
  RiotApiClient,
  RiotGameDataProvider,
  RiotLeagueEntryDtoArraySchema,
  loadRiotConfig,
  type RiotRateLimitWindow,
} from '@league-helper/server-riot';

function classifyOperatingMode(
  appRateLimit: RiotRateLimitWindow[] | null,
): 'developer-key' | 'UNKNOWN' {
  if (!appRateLimit || appRateLimit.length === 0) {
    return 'UNKNOWN';
  }
  // Documented personal-developer app budget: 20/1s and 100/2m.
  const hasDevShort = appRateLimit.some((w) => w.requests === 20 && w.windowSeconds === 1);
  const hasDevLong = appRateLimit.some((w) => w.requests === 100 && w.windowSeconds === 120);
  if (hasDevShort && hasDevLong) {
    return 'developer-key';
  }
  return 'UNKNOWN';
}

function summarizeWindows(windows: RiotRateLimitWindow[] | null): string | null {
  if (!windows) {
    return null;
  }
  return windows.map((w) => `${w.requests}:${w.windowSeconds}`).join(',');
}

async function main(): Promise<void> {
  const config = loadRiotConfig();
  if (config.providerMode !== 'real') {
    console.log(
      JSON.stringify(
        {
          ok: false,
          blocked: true,
          reason: 'RIOT_PROVIDER_MODE_NOT_REAL',
          providerMode: config.providerMode,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  const platform = parsePlatformRoute('na1');
  const client = RiotApiClient.create(config);
  const provider = new RiotGameDataProvider(client);

  const probes: Record<
    string,
    {
      ok: boolean;
      httpHint?: string;
      detail?: string;
      appRateLimit?: string | null;
    }
  > = {};

  let operatingMode: 'developer-key' | 'UNKNOWN' = 'UNKNOWN';
  let authBlocked = false;

  try {
    const ladder = await provider.getChallengerLeague({
      platform,
      leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
    });
    probes['league-v4-challenger'] = {
      ok: true,
      detail: `candidates=${ladder.candidates.length}`,
    };

    const candidate = ladder.candidates[0];
    if (!candidate?.puuid) {
      probes['account-v1'] = { ok: false, detail: 'no_challenger_puuid_for_followup' };
      probes['league-v4-entries-by-puuid'] = { ok: false, detail: 'skipped_no_puuid' };
      probes['match-v5'] = { ok: false, detail: 'skipped_no_puuid' };
    } else {
      const regionalRoute = getRegionalRouteForPlatform(platform);

      const accountPlayer = await provider.getAccountByPuuid({
        puuid: candidate.puuid,
        platform,
      });
      probes['account-v1'] = {
        ok: true,
        detail: `resolved=true platform=${accountPlayer.platform}`,
      };

      const ranked = await provider.getRankedEntries(accountPlayer);
      probes['league-v4-entries-by-puuid'] = {
        ok: true,
        detail: `entries=${ranked.length}`,
      };

      const matchIds = await provider.getRecentMatchIds(accountPlayer, {
        queue: 420,
        count: 1,
        start: 0,
      });
      probes['match-v5'] = {
        ok: true,
        detail: `idsReturned=${matchIds.length} regionalRoute=${regionalRoute}`,
      };

      const raw = await client.requestJson(
        {
          category: 'league-v4',
          route: { kind: 'platform', platform },
          path: `/lol/league/v4/entries/by-puuid/${encodeURIComponent(candidate.puuid)}`,
          resourceHint: 'ranked',
        },
        RiotLeagueEntryDtoArraySchema,
      );
      operatingMode = classifyOperatingMode(raw.metadata.rateLimit.appRateLimit);
      probes['league-v4-entries-by-puuid'].appRateLimit = summarizeWindows(
        raw.metadata.rateLimit.appRateLimit,
      );
    }
  } catch (error: unknown) {
    if (error instanceof ProviderUnauthorizedError) {
      authBlocked = true;
      probes.auth = { ok: false, httpHint: '401', detail: 'unauthorized' };
    } else if (error instanceof ProviderForbiddenError) {
      authBlocked = true;
      probes.auth = { ok: false, httpHint: '403', detail: 'forbidden' };
    } else {
      const message = error instanceof Error ? error.message : String(error);
      probes.error = {
        ok: false,
        detail: message.slice(0, 200),
      };
    }
  }

  const accountOk = probes['account-v1']?.ok === true;
  const leagueOk =
    probes['league-v4-challenger']?.ok === true ||
    probes['league-v4-entries-by-puuid']?.ok === true;
  const matchOk = probes['match-v5']?.ok === true;

  const report = {
    ok: !authBlocked && accountOk && leagueOk && matchOk,
    authBlocked,
    operatingMode,
    probes,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = authBlocked ? 3 : report.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, fatal: message.slice(0, 200) }, null, 2));
  process.exitCode = 1;
});
