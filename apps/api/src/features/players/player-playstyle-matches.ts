import {
  PlatformRouteSchema,
  RANKED_SOLO_QUEUE_ID,
  normalizeParticipantPosition,
  type PlatformRoute,
} from '@league-helper/shared';
import type { PlayerPlaystyleMatchInput } from '@league-helper/match-analytics';
import type {
  PlayerPlaystyleWindowRow,
  PlayerPlaystyleParticipantSummary,
} from '../../persistence/match.repository';

export const PLAYSTYLE_WINDOW_LIMIT = 20;

export type { PlayerPlaystyleWindowRow };

export type PlaystyleWindowRow = PlayerPlaystyleWindowRow;

export type PlaystyleWindowClassification =
  | { kind: 'skipped'; reason: 'remake' | 'incomplete' | 'unknownPosition' }
  | { kind: 'analyzed'; row: PlaystyleWindowRow };

export type PlaystyleWindowSummary = {
  windowSize: number;
  analyzed: PlaystyleWindowRow[];
  skipped: {
    remake: number;
    incomplete: number;
    unknownPosition: number;
  };
};

export function playstyleWindowListArgs(playerAccountId: string): {
  playerAccountId: string;
  queueId: number;
  includeRemakes: true;
  limit: number;
} {
  return {
    playerAccountId,
    queueId: RANKED_SOLO_QUEUE_ID,
    includeRemakes: true,
    limit: PLAYSTYLE_WINDOW_LIMIT,
  };
}

function isNonNegativeFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasUsablePlatform(platformRoute: string | null): boolean {
  if (platformRoute === null || platformRoute.trim() === '') {
    return false;
  }
  return PlatformRouteSchema.safeParse(platformRoute.trim().toLowerCase()).success;
}

function hasRequiredScope(row: PlaystyleWindowRow): boolean {
  const patch = row.normalizedPatch?.trim();
  return Boolean(patch) && hasUsablePlatform(row.platformRoute);
}

function hasValidCombatEconomy(participant: PlayerPlaystyleParticipantSummary): boolean {
  return (
    isNonNegativeFinite(participant.kills) &&
    isNonNegativeFinite(participant.deaths) &&
    isNonNegativeFinite(participant.assists) &&
    isNonNegativeFinite(participant.totalCs) &&
    isNonNegativeFinite(participant.goldEarned) &&
    isNonNegativeFinite(participant.visionScore) &&
    isNonNegativeFinite(participant.totalDamageDealtToChampions)
  );
}

function normalizedPositionFor(row: PlaystyleWindowRow): ReturnType<
  typeof normalizeParticipantPosition
> | null {
  const participant = row.participants[0];
  if (!participant) {
    return null;
  }
  return normalizeParticipantPosition({
    queueId: row.queueId,
    mapId: row.mapId,
    gameMode: row.gameMode,
    remake: row.remake,
    teamPosition: participant.teamPosition,
    individualPosition: participant.individualPosition,
    lane: participant.lane,
    role: participant.role,
  });
}

export function classifyPlaystyleWindowRow(row: PlaystyleWindowRow): PlaystyleWindowClassification {
  if (row.remake === true) {
    return { kind: 'skipped', reason: 'remake' };
  }
  if (row.ingestionStatus !== 'COMPLETED') {
    return { kind: 'skipped', reason: 'incomplete' };
  }

  const position = normalizedPositionFor(row);
  if (position === 'UNKNOWN') {
    return { kind: 'skipped', reason: 'unknownPosition' };
  }

  const participant = row.participants[0];
  if (!participant || !hasRequiredScope(row) || !hasValidCombatEconomy(participant)) {
    return { kind: 'skipped', reason: 'incomplete' };
  }

  return { kind: 'analyzed', row };
}

export function summarizePlaystyleWindow(
  rows: readonly PlaystyleWindowRow[],
): PlaystyleWindowSummary {
  const skipped = { remake: 0, incomplete: 0, unknownPosition: 0 };
  const analyzed: PlaystyleWindowRow[] = [];

  for (const row of rows) {
    const classified = classifyPlaystyleWindowRow(row);
    if (classified.kind === 'analyzed') {
      analyzed.push(classified.row);
      continue;
    }
    skipped[classified.reason] += 1;
  }

  return {
    windowSize: rows.length,
    analyzed,
    skipped,
  };
}

export function toPlayerPlaystyleMatchInput(
  row: PlaystyleWindowRow,
  staticById: ReadonlyMap<number, { championKey: string; name: string }>,
): PlayerPlaystyleMatchInput {
  const participant = row.participants[0];
  if (!participant) {
    throw new Error('Analyzed playstyle row is missing a participant.');
  }

  const position = normalizedPositionFor(row) ?? 'UNKNOWN';
  const staticRow = staticById.get(participant.championId);
  const championKey =
    staticRow?.championKey ?? participant.championName ?? String(participant.championId);
  const championName = staticRow?.name ?? participant.championName ?? championKey;
  const platform = PlatformRouteSchema.parse(
    (row.platformRoute ?? '').trim().toLowerCase(),
  ) as PlatformRoute;

  return {
    matchId: row.id,
    participantId: participant.participantId,
    championId: participant.championId,
    championKey,
    championName,
    position,
    patch: row.normalizedPatch?.trim() ?? '',
    platformRoute: platform,
    queueId: row.queueId,
    win: participant.win,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    totalCs: participant.totalCs,
    goldEarned: participant.goldEarned,
    damageToChampions: participant.totalDamageDealtToChampions,
    visionScore: participant.visionScore,
    timePlayedSeconds: participant.timePlayedSeconds,
    gameDurationSeconds: row.gameDurationSeconds,
    goldDifferenceAt10: participant.goldDifferenceAt10,
    goldDifferenceAt15: participant.goldDifferenceAt15,
    csDifferenceAt10: participant.csDifferenceAt10,
    csDifferenceAt15: participant.csDifferenceAt15,
    rankTier: participant.rankTierAtIngestion,
    rankResolutionStatus: String(participant.rankResolutionStatus),
    gameCreation: row.gameCreation,
  };
}
