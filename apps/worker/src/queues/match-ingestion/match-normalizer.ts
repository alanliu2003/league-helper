import {
  PlatformRouteSchema,
  ProviderResponseInvalidError,
  TeamPositionSchema,
  normalizeParticipantPosition,
  parsePatchVersion,
  parsePlatformRoute,
  type TeamPosition,
} from '@league-helper/shared';

/**
 * Public match-card positions use {@link normalizeParticipantPosition}.
 * Ingestion persists raw Riot teamPosition / individualPosition / lane / role
 * unchanged so reprocessing can recompute display roles without re-fetching.
 */
export { normalizeParticipantPosition };
import {
  RiotMatchDtoSchema,
  type RiotMatchDto,
  type RiotMatchParticipantDto,
  type RiotMatchTeamDto,
} from '@league-helper/server-riot';
import type { Prisma } from '@prisma/client';

/** Classic SR remake window — only applied with early-surrender signals. */
export const REMAKE_MAX_DURATION_SECONDS = 300;

export type NormalizedMatchParticipant = {
  participantId: number;
  externalAccountId: string | null;
  riotIdGameName: string | null;
  riotIdTagLine: string | null;
  championId: number;
  championName: string | null;
  teamId: number;
  teamPosition: TeamPosition;
  individualPosition: string;
  lane: string | null;
  role: string | null;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  largestKillingSpree: number | null;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  totalCs: number;
  goldEarned: number;
  goldSpent: number;
  totalDamageDealtToChampions: number;
  physicalDamageDealtToChampions: number;
  magicDamageDealtToChampions: number;
  trueDamageDealtToChampions: number;
  totalDamageTaken: number;
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  controlWardsPurchased: number | null;
  timePlayedSeconds: number;
  /** Final inventory item0–item6 including empty slots as 0. */
  itemIds: number[];
  perkIds: number[];
  statPerkIds: number[];
  primaryPerkStyleId: number | null;
  secondaryPerkStyleId: number | null;
  summonerSpell1Id: number;
  summonerSpell2Id: number;
  rawPayload: Prisma.InputJsonValue | null;
};

export type NormalizedMatchTeam = {
  teamId: number;
  win: boolean;
  earlySurrender: boolean;
  bans: number[];
  objectives: Prisma.InputJsonValue | null;
};

export type NormalizedMatch = {
  provider: 'RIOT';
  externalMatchId: string;
  platformRoute: string | null;
  regionalRoute: string;
  gameId: bigint | null;
  queueId: number;
  mapId: number | null;
  gameMode: string | null;
  gameType: string | null;
  gameCreation: Date;
  gameEndTimestamp: Date | null;
  gameDurationSeconds: number;
  gameVersion: string;
  normalizedPatch: string | null;
  remake: boolean;
  earlySurrender: boolean;
  normalizationVersion: string;
  rawPayload: Prisma.InputJsonValue | null;
  teams: NormalizedMatchTeam[];
  participants: NormalizedMatchParticipant[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeTeamPosition(raw: unknown): TeamPosition {
  if (typeof raw !== 'string' || raw.trim() === '' || raw === 'NONE') {
    return 'NONE';
  }
  const parsed = TeamPositionSchema.safeParse(raw.trim().toUpperCase());
  return parsed.success ? parsed.data : 'INVALID';
}

function extractItemIds(participant: RiotMatchParticipantDto): number[] {
  const record = asRecord(participant);
  // Keep empty slots (0) so item0–item6 positions remain reconstructible.
  return [0, 1, 2, 3, 4, 5, 6].map((index) => asNumber(record[`item${index}`], 0));
}

function extractPerkIds(participant: RiotMatchParticipantDto): number[] {
  const perks = asRecord(participant.perks);
  const styles = Array.isArray(perks.styles) ? perks.styles : [];
  const ids: number[] = [];
  for (const style of styles) {
    const styleRecord = asRecord(style);
    const selections = Array.isArray(styleRecord.selections) ? styleRecord.selections : [];
    for (const selection of selections) {
      const perk = asOptionalNumber(asRecord(selection).perk);
      if (perk !== null) {
        ids.push(perk);
      }
    }
  }
  return ids;
}

function extractPerkStyleIds(participant: RiotMatchParticipantDto): {
  primaryPerkStyleId: number | null;
  secondaryPerkStyleId: number | null;
} {
  const perks = asRecord(participant.perks);
  const styles = Array.isArray(perks.styles) ? perks.styles : [];
  const styleIds = styles
    .map((style) => asOptionalNumber(asRecord(style).style))
    .filter((value): value is number => value !== null);
  return {
    primaryPerkStyleId: styleIds[0] ?? null,
    secondaryPerkStyleId: styleIds[1] ?? null,
  };
}

function extractStatPerkIds(participant: RiotMatchParticipantDto): number[] {
  const perks = asRecord(participant.perks);
  const statPerks = asRecord(perks.statPerks);
  return [statPerks.offense, statPerks.flex, statPerks.defense]
    .map((value) => asOptionalNumber(value))
    .filter((value): value is number => value !== null);
}

function resolvePlatformRoute(platformId: unknown): string | null {
  if (typeof platformId !== 'string' || platformId.trim() === '') {
    return null;
  }
  try {
    return parsePlatformRoute(platformId);
  } catch {
    const lowered = platformId.trim().toLowerCase();
    const parsed = PlatformRouteSchema.safeParse(lowered);
    return parsed.success ? parsed.data : null;
  }
}

/**
 * Remake detection (conservative, tested):
 * A match is a remake only when duration is within the classic remake window
 * (<= 300s) AND Riot early-surrender signals are present
 * (`gameEndedInEarlySurrender` on any participant, or team earlySurrender).
 *
 * Ordinary short games, ARAM stomps, or voluntary mid-game surrenders
 * (`gameEndedInSurrender` without early-surrender + short window) are NOT remakes.
 */
export function detectRemakeAndEarlySurrender(input: {
  gameDurationSeconds: number;
  participants: RiotMatchParticipantDto[];
  teams: RiotMatchTeamDto[];
}): { remake: boolean; earlySurrender: boolean } {
  const participantEarly = input.participants.some((participant) =>
    asBoolean(asRecord(participant).gameEndedInEarlySurrender, false),
  );
  const participantSurrender = input.participants.some((participant) =>
    asBoolean(asRecord(participant).gameEndedInSurrender, false),
  );
  const teamEarly = input.teams.some((team) => {
    const record = asRecord(team);
    return (
      asBoolean(record.earlySurrender, false) || asBoolean(record.gameEndedInEarlySurrender, false)
    );
  });

  const earlySurrender = participantEarly || participantSurrender || teamEarly;
  const remake =
    input.gameDurationSeconds <= REMAKE_MAX_DURATION_SECONDS && (participantEarly || teamEarly);

  return { remake, earlySurrender };
}

function normalizeParticipant(
  participant: RiotMatchParticipantDto,
  index: number,
  storeRaw: boolean,
): NormalizedMatchParticipant {
  const record = asRecord(participant);
  const participantId = asOptionalNumber(record.participantId) ?? index + 1;
  const championId = asOptionalNumber(participant.championId);
  const teamId = asOptionalNumber(participant.teamId);

  if (championId === null || teamId === null) {
    throw new ProviderResponseInvalidError('Match participant is missing championId or teamId.', {
      participantId,
    });
  }

  const totalMinionsKilled = asNumber(participant.totalMinionsKilled, 0);
  const neutralMinionsKilled = asNumber(participant.neutralMinionsKilled, 0);
  const perkStyles = extractPerkStyleIds(participant);

  return {
    participantId,
    externalAccountId: asOptionalString(participant.puuid),
    riotIdGameName: asOptionalString(participant.riotIdGameName),
    riotIdTagLine: asOptionalString(participant.riotIdTagline),
    championId,
    championName: asOptionalString(participant.championName),
    teamId,
    teamPosition: normalizeTeamPosition(participant.teamPosition),
    individualPosition: asOptionalString(participant.individualPosition) ?? 'INVALID',
    lane: asOptionalString(record.lane),
    role: asOptionalString(record.role),
    win: asBoolean(participant.win, false),
    kills: asNumber(participant.kills, 0),
    deaths: asNumber(participant.deaths, 0),
    assists: asNumber(participant.assists, 0),
    largestKillingSpree: asOptionalNumber(record.largestKillingSpree),
    totalMinionsKilled,
    neutralMinionsKilled,
    totalCs: totalMinionsKilled + neutralMinionsKilled,
    goldEarned: asNumber(participant.goldEarned, 0),
    goldSpent: asNumber(record.goldSpent, 0),
    totalDamageDealtToChampions: asNumber(record.totalDamageDealtToChampions, 0),
    physicalDamageDealtToChampions: asNumber(record.physicalDamageDealtToChampions, 0),
    magicDamageDealtToChampions: asNumber(record.magicDamageDealtToChampions, 0),
    trueDamageDealtToChampions: asNumber(record.trueDamageDealtToChampions, 0),
    totalDamageTaken: asNumber(record.totalDamageTaken, 0),
    visionScore: asNumber(record.visionScore, 0),
    wardsPlaced: asNumber(record.wardsPlaced, 0),
    wardsKilled: asNumber(record.wardsKilled, 0),
    controlWardsPurchased: asOptionalNumber(record.detectorWardsPlaced),
    timePlayedSeconds: asNumber(record.timePlayed, 0),
    itemIds: extractItemIds(participant),
    perkIds: extractPerkIds(participant),
    statPerkIds: extractStatPerkIds(participant),
    primaryPerkStyleId: perkStyles.primaryPerkStyleId,
    secondaryPerkStyleId: perkStyles.secondaryPerkStyleId,
    summonerSpell1Id: asNumber(participant.summoner1Id, 0),
    summonerSpell2Id: asNumber(participant.summoner2Id, 0),
    rawPayload: storeRaw ? (participant as unknown as Prisma.InputJsonValue) : null,
  };
}

function normalizeTeam(team: RiotMatchTeamDto): NormalizedMatchTeam {
  const record = asRecord(team);
  const teamId = asOptionalNumber(team.teamId);
  if (teamId === null) {
    throw new ProviderResponseInvalidError('Match team is missing teamId.');
  }

  const bans = Array.isArray(team.bans)
    ? team.bans
        .map((ban) => asOptionalNumber(asRecord(ban).championId))
        .filter((id): id is number => id !== null && id > 0)
    : [];

  return {
    teamId,
    win: asBoolean(team.win, false),
    earlySurrender:
      asBoolean(record.earlySurrender, false) || asBoolean(record.gameEndedInEarlySurrender, false),
    bans,
    objectives: team.objectives ? (team.objectives as unknown as Prisma.InputJsonValue) : null,
  };
}

export type NormalizeMatchInput = {
  raw: unknown;
  regionalRoute: string;
  normalizationVersion: number;
  storeRawPayloads: boolean;
};

/** Deterministically normalize a Match-v5 DTO into the persistence shape. */
export function normalizeMatch(input: NormalizeMatchInput): NormalizedMatch {
  const parsed = RiotMatchDtoSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new ProviderResponseInvalidError('Riot match payload failed schema validation.');
  }

  const match: RiotMatchDto = parsed.data;
  const info = match.info;
  const gameDurationSeconds = info.gameDuration;
  const { remake, earlySurrender } = detectRemakeAndEarlySurrender({
    gameDurationSeconds,
    participants: info.participants,
    teams: info.teams,
  });

  const patch = parsePatchVersion(info.gameVersion);

  return {
    provider: 'RIOT',
    externalMatchId: match.metadata.matchId,
    platformRoute: resolvePlatformRoute(info.platformId),
    regionalRoute: input.regionalRoute,
    gameId: typeof info.gameId === 'number' ? BigInt(info.gameId) : null,
    queueId: info.queueId,
    mapId: info.mapId,
    gameMode: asOptionalString(info.gameMode),
    gameType: asOptionalString(info.gameType),
    gameCreation: new Date(info.gameCreation),
    gameEndTimestamp:
      typeof info.gameEndTimestamp === 'number' ? new Date(info.gameEndTimestamp) : null,
    gameDurationSeconds,
    gameVersion: info.gameVersion,
    normalizedPatch: patch?.label ?? null,
    remake,
    earlySurrender,
    normalizationVersion: String(input.normalizationVersion),
    rawPayload: input.storeRawPayloads ? (match as unknown as Prisma.InputJsonValue) : null,
    teams: info.teams.map(normalizeTeam),
    participants: info.participants.map((participant, index) =>
      normalizeParticipant(participant, index, input.storeRawPayloads),
    ),
  };
}
