import {
  PublicMasterySummarySchema,
  PublicMatchIngestionStatusSchema,
  PublicMatchSummarySchema,
  PublicPlayerSchema,
  PublicRankSummarySchema,
  normalizeParticipantPosition,
  type PublicMasterySummary,
  type PublicMatchSummary,
  type PublicPlayer,
  type PublicRankSummary,
} from '@league-helper/shared';
import type { ChampionMasterySnapshot, RankSnapshot, PlayerAccount } from '@prisma/client';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import type { PlayerMatchListRow } from '../../persistence/match.repository';

export function mapPublicPlayer(
  account: PlayerAccount,
  options: { profileIconUrl?: string | null } = {},
): PublicPlayer {
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
    profileIconUrl: options.profileIconUrl ?? null,
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

export function mapPublicMastery(
  snapshot: ChampionMasterySnapshot,
  champion?: DataDragonChampion | null,
): PublicMasterySummary {
  return PublicMasterySummarySchema.parse({
    id: snapshot.id,
    championId: snapshot.championId,
    championLevel: snapshot.championLevel,
    championPoints: snapshot.championPoints,
    lastPlayTime: snapshot.lastPlayTime?.toISOString() ?? null,
    chestGranted: snapshot.chestGranted,
    tokensEarned: snapshot.tokensEarned,
    capturedAt: snapshot.capturedAt.toISOString(),
    championName: champion?.name ?? null,
    championKey: champion?.id ?? null,
    championIconUrl: champion?.iconUrl ?? null,
  });
}

export type MapPublicMatchOptions = {
  champion?: DataDragonChampion | null;
  /** Data Dragon CDN version used to build item icon URLs. */
  dataDragonVersion?: string | null;
  /** Approved Data Dragon base URL (e.g. https://ddragon.leagueoflegends.com). */
  dataDragonBaseUrl?: string | null;
};

/**
 * Compute public KDA: (kills+assists)/deaths, or kills+assists when deaths is 0
 * (perfect-game convention). Returns null when any component is missing.
 */
export function computePublicKda(
  kills: number | null | undefined,
  deaths: number | null | undefined,
  assists: number | null | undefined,
): number | null {
  if (kills == null || deaths == null || assists == null) {
    return null;
  }
  if (deaths === 0) {
    return kills + assists;
  }
  return (kills + assists) / deaths;
}

export function computeCsPerMinute(
  totalCs: number | null | undefined,
  gameDurationSeconds: number,
): number | null {
  if (totalCs == null || gameDurationSeconds <= 0) {
    return null;
  }
  return totalCs / (gameDurationSeconds / 60);
}

function buildItemIconUrl(
  itemId: number,
  version: string | null | undefined,
  baseUrl: string | null | undefined,
): string | null {
  if (!itemId || !version?.trim() || !baseUrl?.trim()) {
    return null;
  }
  return `${baseUrl.replace(/\/$/, '')}/cdn/${encodeURIComponent(version.trim())}/img/item/${itemId}.png`;
}

function hasTimelineMetrics(
  participant: PlayerMatchListRow['participants'][number] | undefined,
): boolean {
  if (!participant) {
    return false;
  }
  return (
    participant.goldAt10 != null ||
    participant.goldAt15 != null ||
    participant.csAt10 != null ||
    participant.csAt15 != null ||
    participant.xpAt10 != null ||
    participant.xpAt15 != null ||
    participant.goldDifferenceAt10 != null ||
    participant.goldDifferenceAt15 != null ||
    participant.csDifferenceAt10 != null ||
    participant.csDifferenceAt15 != null ||
    participant.killParticipation != null
  );
}

export function mapPublicMatch(
  match: PlayerMatchListRow,
  options: MapPublicMatchOptions = {},
): PublicMatchSummary {
  const participant = match.participants[0];
  const champion = options.champion ?? null;
  const itemIds = (participant?.itemIds ?? []).filter((id) => Number.isInteger(id) && id >= 0);
  const itemIconUrls = itemIds.map((id) =>
    buildItemIconUrl(id, options.dataDragonVersion, options.dataDragonBaseUrl),
  );

  const win = participant?.win ?? null;
  let result: 'victory' | 'defeat' | 'remake' | 'unknown' = 'unknown';
  if (match.remake) {
    result = 'remake';
  } else if (win === true) {
    result = 'victory';
  } else if (win === false) {
    result = 'defeat';
  }

  // Normalized display position — never prefer Riot legacy role (SOLO/DUO_*).
  const normalizedPosition = normalizeParticipantPosition({
    queueId: match.queueId,
    mapId: match.mapId,
    gameMode: match.gameMode,
    remake: match.remake,
    teamPosition: participant?.teamPosition,
    individualPosition: participant?.individualPosition,
    lane: participant?.lane,
    role: participant?.role,
  });

  const championName =
    champion?.name ??
    (participant?.championName && participant.championName.trim() !== ''
      ? participant.championName
      : null);

  return PublicMatchSummarySchema.parse({
    id: match.id,
    externalMatchId: match.externalMatchId,
    queueId: match.queueId,
    gameCreation: match.gameCreation.toISOString(),
    gameDurationSeconds: match.gameDurationSeconds,
    gameVersion: match.gameVersion,
    normalizedPatch: match.normalizedPatch,
    remake: match.remake,
    earlySurrender: match.earlySurrender,
    result,
    championId: participant?.championId ?? null,
    championKey: champion?.id ?? null,
    championName,
    // Icon URL must use Data Dragon string id (Tryndamere), never numeric id (23).
    championIconUrl: champion?.iconUrl ?? null,
    teamPosition: normalizedPosition,
    role: normalizedPosition,
    win,
    kills: participant?.kills ?? null,
    deaths: participant?.deaths ?? null,
    assists: participant?.assists ?? null,
    kda: computePublicKda(participant?.kills, participant?.deaths, participant?.assists),
    totalCs: participant?.totalCs ?? null,
    csPerMinute: computeCsPerMinute(participant?.totalCs, match.gameDurationSeconds),
    killParticipation: participant?.killParticipation ?? null,
    itemIds,
    itemIconUrls,
    summonerSpell1Id: participant?.summonerSpell1Id ?? null,
    summonerSpell2Id: participant?.summonerSpell2Id ?? null,
    goldAt10: participant?.goldAt10 ?? null,
    goldAt15: participant?.goldAt15 ?? null,
    csAt10: participant?.csAt10 ?? null,
    csAt15: participant?.csAt15 ?? null,
    xpAt10: participant?.xpAt10 ?? null,
    xpAt15: participant?.xpAt15 ?? null,
    goldDifferenceAt10: participant?.goldDifferenceAt10 ?? null,
    goldDifferenceAt15: participant?.goldDifferenceAt15 ?? null,
    csDifferenceAt10: participant?.csDifferenceAt10 ?? null,
    csDifferenceAt15: participant?.csDifferenceAt15 ?? null,
    timelineMetricsAvailable: hasTimelineMetrics(participant),
    ingestionStatus: PublicMatchIngestionStatusSchema.parse(match.ingestionStatus),
  });
}

/** Assert a JSON payload never leaks PUUID-like fields. */
export function assertNoPuuidLeak(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (json.includes('externalAccountId') || json.includes('"puuid"')) {
    throw new Error('Public response leaked provider account identity fields.');
  }
}
