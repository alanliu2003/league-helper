import {
  PublicMasterySummarySchema,
  PublicMatchSummarySchema,
  PublicPlayerSchema,
  PublicRankSummarySchema,
  type PublicMasterySummary,
  type PublicMatchSummary,
  type PublicPlayer,
  type PublicRankSummary,
} from '@league-helper/shared';
import type { ChampionMasterySnapshot, Match, PlayerAccount, RankSnapshot } from '@prisma/client';

export function mapPublicPlayer(account: PlayerAccount): PublicPlayer {
  return PublicPlayerSchema.parse({
    id: account.playerId,
    accountId: account.id,
    provider: account.provider,
    platform: account.platformRoute,
    regionalRoute: account.regionalRoute,
    riotId: {
      gameName: account.currentGameName,
      tagLine: account.currentTagLine,
    },
    profileIconId: account.profileIconId,
    summonerLevel: account.summonerLevel,
    lastResolvedAt: account.lastResolvedAt?.toISOString() ?? null,
  });
}

export function mapPublicRank(snapshot: RankSnapshot): PublicRankSummary {
  return PublicRankSummarySchema.parse({
    id: snapshot.id,
    queueType: snapshot.queueType,
    tier: snapshot.tier,
    division: snapshot.division,
    leaguePoints: snapshot.leaguePoints,
    wins: snapshot.wins,
    losses: snapshot.losses,
    veteran: snapshot.veteran,
    inactive: snapshot.inactive,
    freshBlood: snapshot.freshBlood,
    hotStreak: snapshot.hotStreak,
    capturedAt: snapshot.capturedAt.toISOString(),
  });
}

export function mapPublicMastery(snapshot: ChampionMasterySnapshot): PublicMasterySummary {
  return PublicMasterySummarySchema.parse({
    id: snapshot.id,
    championId: snapshot.championId,
    championLevel: snapshot.championLevel,
    championPoints: snapshot.championPoints,
    lastPlayTime: snapshot.lastPlayTime?.toISOString() ?? null,
    chestGranted: snapshot.chestGranted,
    tokensEarned: snapshot.tokensEarned,
    capturedAt: snapshot.capturedAt.toISOString(),
  });
}

export function mapPublicMatch(
  match: Match & {
    participants: Array<{
      championId: number;
      win: boolean;
      kills: number;
      deaths: number;
      assists: number;
    }>;
  },
): PublicMatchSummary {
  const participant = match.participants[0];
  return PublicMatchSummarySchema.parse({
    id: match.id,
    externalMatchId: match.externalMatchId,
    queueId: match.queueId,
    gameCreation: match.gameCreation.toISOString(),
    gameDurationSeconds: match.gameDurationSeconds,
    gameVersion: match.gameVersion,
    remake: match.remake,
    championId: participant?.championId ?? null,
    win: participant?.win ?? null,
    kills: participant?.kills ?? null,
    deaths: participant?.deaths ?? null,
    assists: participant?.assists ?? null,
  });
}

/** Assert a JSON payload never leaks PUUID-like fields. */
export function assertNoPuuidLeak(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (json.includes('externalAccountId') || json.includes('"puuid"')) {
    throw new Error('Public response leaked provider account identity fields.');
  }
}
