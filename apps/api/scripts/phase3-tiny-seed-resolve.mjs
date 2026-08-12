/**
 * Resolve ONE Challenger seed Riot ID for Phase 3 tiny validation.
 * Uses Account-v1 only for bootstrap identity — not for co-participant rank.
 * Never prints API keys.
 */
import 'dotenv/config';
import {
  getRegionalRouteForPlatform,
  parsePlatformRoute,
} from '@league-helper/shared';
import {
  RIOT_LEAGUE_QUEUE_RANKED_SOLO,
  RiotApiClient,
  RiotGameDataProvider,
  loadRiotConfig,
} from '@league-helper/server-riot';

async function main() {
  const config = loadRiotConfig();
  if (config.providerMode !== 'real') {
    console.error(JSON.stringify({ ok: false, reason: 'RIOT_PROVIDER_MODE_NOT_REAL' }));
    process.exit(2);
  }

  const platform = parsePlatformRoute('na1');
  const client = RiotApiClient.create(config);
  const provider = new RiotGameDataProvider(client);
  const ladder = await provider.getChallengerLeague({
    platform,
    leagueQueueType: RIOT_LEAGUE_QUEUE_RANKED_SOLO,
  });
  const candidate = ladder.candidates[0];
  if (!candidate?.puuid) {
    console.error(JSON.stringify({ ok: false, reason: 'NO_CHALLENGER_PUUID' }));
    process.exit(2);
  }

  const account = await provider.getAccountByPuuid({
    puuid: candidate.puuid,
    platform,
  });

  const matchIds = await provider.getRecentMatchIds(account, {
    queue: 420,
    count: 3,
    start: 0,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        platform: account.platform,
        regionalRoute: getRegionalRouteForPlatform(platform),
        gameName: account.riotId.gameName,
        tagLine: account.riotId.tagLine,
        puuidPrefix: `${candidate.puuid.slice(0, 8)}…`,
        recentQ420MatchCount: matchIds.length,
        note: 'Use gameName/tagLine with matches:bootstrap-player --max-matches 3',
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    }),
  );
  process.exit(2);
});
