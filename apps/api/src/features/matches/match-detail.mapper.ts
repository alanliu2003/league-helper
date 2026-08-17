import {
  PlatformRouteSchema,
  PublicMatchDetailSchema,
  RegionalRouteSchema,
  RiotIdSchema,
  getMatchQueueLabel,
  matchTeamSide,
  normalizeParticipantPosition,
  parseMatchTeamObjectives,
  participantHasTimelineMetrics,
  sortMatchParticipants,
  sortMatchTeams,
  winningSideFromTeams,
  type ChampionBuildStaticIdentity,
  type PublicMatchDetail,
  type PublicMatchItemSlot,
  type PublicMatchParticipant,
  type PublicMatchTeam,
  type PublicMatchTeamSide,
  type PublicMatchTimelineStatus,
  type RiotId,
} from '@league-helper/shared';
import { TimelineFetchStatus } from '@prisma/client';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import type { MatchDetailRow } from '../../persistence/match.repository';
import { computeCsPerMinute, computeGoldPerMinute, computePublicKda } from '../players/player-response.mapper';
import {
  identityFromItem,
  identityFromRune,
  identityFromSpell,
  identityFromStyle,
  type MatchStaticIcons,
  type MatchStaticLookups,
} from './match-detail-static';

export type MatchDetailMapContext = {
  champions: Map<number, DataDragonChampion>;
  lookups: MatchStaticLookups;
  icons: MatchStaticIcons;
};

function mapTimelineStatus(fetchStatus: TimelineFetchStatus | null | undefined): PublicMatchTimelineStatus {
  if (!fetchStatus || fetchStatus === TimelineFetchStatus.PENDING) {
    return 'PENDING';
  }
  if (fetchStatus === TimelineFetchStatus.FETCHED) {
    return 'AVAILABLE';
  }
  return 'UNAVAILABLE';
}

function parseRiotIdOrNull(gameName: string | null | undefined, tagLine: string | null | undefined): RiotId | null {
  const parsed = RiotIdSchema.safeParse({
    gameName: gameName ?? '',
    tagLine: tagLine ?? '',
  });
  return parsed.success ? parsed.data : null;
}

function padItemIds(itemIds: number[]): number[] {
  const padded = itemIds.filter((id) => Number.isInteger(id) && id >= 0).slice(0, 7);
  while (padded.length < 7) {
    padded.push(0);
  }
  return padded;
}

function championIdentity(
  championId: number,
  storedName: string | null | undefined,
  champions: Map<number, DataDragonChampion>,
): { key: string | null; name: string | null; iconUrl: string | null } {
  const champion = champions.get(championId);
  const stored = storedName?.trim() ? storedName.trim() : null;
  return {
    key: champion?.id ?? null,
    name: champion?.name ?? stored ?? (championId > 0 ? `Champion ${championId}` : null),
    iconUrl: champion?.iconUrl ?? null,
  };
}

function banIdentity(
  championId: number,
  champions: Map<number, DataDragonChampion>,
): ChampionBuildStaticIdentity | null {
  if (championId <= 0) {
    return null;
  }
  const champion = champions.get(championId);
  return {
    id: championId,
    name: champion?.name ?? `Champion ${championId}`,
    iconUrl: champion?.iconUrl ?? null,
  };
}

function mapParticipant(
  row: MatchDetailRow['participants'][number],
  match: MatchDetailRow,
  teamDamage: number,
  ctx: MatchDetailMapContext,
): PublicMatchParticipant {
  const champion = championIdentity(row.championId, row.championName, ctx.champions);
  const items: PublicMatchItemSlot[] = padItemIds(row.itemIds).map((itemId, slot) => {
    const identity = identityFromItem(itemId, ctx.lookups, ctx.icons);
    return {
      slot,
      itemId,
      name: identity.name,
      iconUrl: identity.iconUrl,
    };
  });

  const riotId = row.playerAccount
    ? parseRiotIdOrNull(row.playerAccount.currentGameName, row.playerAccount.currentTagLine)
    : parseRiotIdOrNull(row.riotIdGameName, row.riotIdTagLine);

  const damageShare =
    teamDamage > 0 ? row.totalDamageDealtToChampions / teamDamage : null;

  return {
    participantId: row.participantId,
    teamId: row.teamId,
    playerId: row.playerAccount?.playerId ?? null,
    riotId,
    championId: row.championId,
    championKey: champion.key,
    championName: champion.name,
    championIconUrl: champion.iconUrl,
    teamPosition: normalizeParticipantPosition({
      queueId: match.queueId,
      mapId: match.mapId,
      gameMode: match.gameMode,
      remake: match.remake,
      teamPosition: row.teamPosition,
      individualPosition: row.individualPosition,
      lane: row.lane,
      role: row.role,
    }),
    win: row.win,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    kda: computePublicKda(row.kills, row.deaths, row.assists),
    totalCs: row.totalCs,
    csPerMinute: computeCsPerMinute(row.totalCs, match.gameDurationSeconds),
    goldEarned: row.goldEarned,
    goldPerMinute: computeGoldPerMinute(row.goldEarned, match.gameDurationSeconds),
    totalDamageDealtToChampions: row.totalDamageDealtToChampions,
    damageShare,
    totalDamageTaken: row.totalDamageTaken,
    visionScore: row.visionScore,
    wardsPlaced: row.wardsPlaced,
    wardsKilled: row.wardsKilled,
    controlWardsPurchased: row.controlWardsPurchased,
    killParticipation: row.killParticipation,
    items,
    summonerSpells: [
      identityFromSpell(row.summonerSpell1Id, ctx.lookups, ctx.icons),
      identityFromSpell(row.summonerSpell2Id, ctx.lookups, ctx.icons),
    ],
    keystone: identityFromRune(row.perkIds[0] ?? 0, ctx.lookups, ctx.icons),
    primaryPerkStyle: identityFromStyle(row.primaryPerkStyleId ?? 0, ctx.lookups, ctx.icons),
    secondaryPerkStyle: identityFromStyle(row.secondaryPerkStyleId ?? 0, ctx.lookups, ctx.icons),
    statShards: row.statPerkIds
      .map((id) => identityFromRune(id, ctx.lookups, ctx.icons))
      .filter((shard): shard is ChampionBuildStaticIdentity => shard !== null),
    goldAt10: row.goldAt10,
    goldAt15: row.goldAt15,
    csAt10: row.csAt10,
    csAt15: row.csAt15,
    xpAt10: row.xpAt10,
    xpAt15: row.xpAt15,
    goldDifferenceAt10: row.goldDifferenceAt10,
    goldDifferenceAt15: row.goldDifferenceAt15,
    csDifferenceAt10: row.csDifferenceAt10,
    csDifferenceAt15: row.csDifferenceAt15,
    xpDifferenceAt10: row.xpDifferenceAt10,
    xpDifferenceAt15: row.xpDifferenceAt15,
    deathsBefore10: row.deathsBefore10,
    deathsBetween10And20: row.deathsBetween10And20,
  };
}

function sumTotals(participants: PublicMatchParticipant[]) {
  return {
    kills: participants.reduce((sum, p) => sum + p.kills, 0),
    deaths: participants.reduce((sum, p) => sum + p.deaths, 0),
    assists: participants.reduce((sum, p) => sum + p.assists, 0),
    goldEarned: participants.reduce((sum, p) => sum + p.goldEarned, 0),
    damageDealtToChampions: participants.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0),
    visionScore: participants.reduce((sum, p) => sum + p.visionScore, 0),
  };
}

export function mapPublicMatchDetail(row: MatchDetailRow, ctx: MatchDetailMapContext): PublicMatchDetail {
  const teamIds = new Set<number>([
    ...row.teams.map((team) => team.teamId),
    ...row.participants.map((participant) => participant.teamId),
  ]);
  const teamMeta = new Map(row.teams.map((team) => [team.teamId, team]));

  const teams: PublicMatchTeam[] = sortMatchTeams(
    [...teamIds].map((teamId) => {
      const meta = teamMeta.get(teamId);
      const members = row.participants.filter((participant) => participant.teamId === teamId);
      const teamDamage = members.reduce((sum, participant) => sum + participant.totalDamageDealtToChampions, 0);
      const participants = sortMatchParticipants(
        members.map((participant) => mapParticipant(participant, row, teamDamage, ctx)),
      );
      const side: PublicMatchTeamSide = matchTeamSide(teamId);
      return {
        teamId,
        side,
        win: meta?.win ?? participants.some((participant) => participant.win),
        bans: (meta?.bans ?? []).flatMap((championId) => {
          const identity = banIdentity(championId, ctx.champions);
          return identity ? [identity] : [];
        }),
        objectives: parseMatchTeamObjectives(meta?.objectives ?? null),
        totals: sumTotals(participants),
        participants,
      };
    }),
  );

  const platform = PlatformRouteSchema.safeParse(row.platformRoute);
  const mapped = PublicMatchDetailSchema.parse({
    match: {
      id: row.id,
      queueId: row.queueId,
      queueLabel: getMatchQueueLabel(row.queueId),
      platform: platform.success ? platform.data : null,
      regionalRoute: RegionalRouteSchema.parse(row.regionalRoute),
      mapId: row.mapId,
      gameMode: row.gameMode && row.gameMode.trim() !== '' ? row.gameMode : null,
      gameCreation: row.gameCreation.toISOString(),
      gameEndTimestamp: row.gameEndTimestamp?.toISOString() ?? null,
      gameDurationSeconds: row.gameDurationSeconds,
      gameVersion: row.gameVersion,
      normalizedPatch: row.normalizedPatch,
      remake: row.remake,
      earlySurrender: row.earlySurrender,
      ingestionStatus: row.ingestionStatus,
      winningSide: winningSideFromTeams(
        row.remake,
        teams.map((team) => ({ side: team.side, win: team.win })),
      ),
    },
    timeline: {
      status: mapTimelineStatus(row.timeline?.fetchStatus),
      metricsAvailable: row.participants.some((participant) => participantHasTimelineMetrics(participant)),
    },
    teams,
  });

  return mapped;
}
