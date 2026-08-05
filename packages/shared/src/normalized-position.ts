import { z } from 'zod';
import {
  ARAM_QUEUE_ID,
  ARENA_QUEUE_ID,
  CUSTOM_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  NORMAL_DRAFT_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
} from './match-queues';

/** Provider-neutral position used for public match cards and analytics filters. */
export const NormalizedPositionSchema = z.enum([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'SUPPORT',
  'UNKNOWN',
]);

export type NormalizedPosition = z.infer<typeof NormalizedPositionSchema>;

export type NormalizeParticipantPositionInput = {
  queueId?: number | null;
  mapId?: number | null;
  gameMode?: string | null;
  remake?: boolean | null;
  teamPosition?: string | null;
  individualPosition?: string | null;
  lane?: string | null;
  role?: string | null;
};

/** Summoner's Rift queues where Riot assigned positions are meaningful. */
const STANDARD_SR_QUEUE_IDS = new Set<number>([
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  NORMAL_DRAFT_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
]);

const NON_STANDARD_QUEUE_IDS = new Set<number>([ARAM_QUEUE_ID, ARENA_QUEUE_ID, CUSTOM_QUEUE_ID]);

const NON_STANDARD_GAME_MODES = new Set<string>([
  'ARAM',
  'CHERRY',
  'STRAWBERRY',
  'URF',
  'ARURF',
  'ONEFORALL',
  'NEXUSBLITZ',
  'ULTBOOK',
]);

const RIOT_POSITION_TO_NORMALIZED: Record<string, NormalizedPosition> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MIDDLE',
  MID: 'MIDDLE',
  BOTTOM: 'BOTTOM',
  BOT: 'BOTTOM',
  UTILITY: 'SUPPORT',
};

function clean(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function mapRiotPosition(value: string | null | undefined): NormalizedPosition | null {
  const key = clean(value);
  if (!key || key === 'NONE' || key === 'INVALID' || key === 'UNKNOWN') {
    return null;
  }
  return RIOT_POSITION_TO_NORMALIZED[key] ?? null;
}

function isNonStandardMode(input: NormalizeParticipantPositionInput): boolean {
  if (input.queueId != null && NON_STANDARD_QUEUE_IDS.has(input.queueId)) {
    return true;
  }
  if (input.queueId != null && !STANDARD_SR_QUEUE_IDS.has(input.queueId)) {
    // Unknown/rotating queues: do not invent SR roles.
    return true;
  }
  const mode = clean(input.gameMode);
  if (mode && NON_STANDARD_GAME_MODES.has(mode)) {
    return true;
  }
  // Howling Abyss
  if (input.mapId === 12) {
    return true;
  }
  return false;
}

function fromLaneAndRole(
  laneRaw: string | null | undefined,
  roleRaw: string | null | undefined,
): NormalizedPosition {
  const lane = clean(laneRaw);
  const role = clean(roleRaw);

  if (lane === 'TOP') {
    return 'TOP';
  }
  if (lane === 'JUNGLE') {
    return 'JUNGLE';
  }
  if (lane === 'MIDDLE' || lane === 'MID') {
    return 'MIDDLE';
  }
  if (lane === 'BOTTOM' || lane === 'BOT') {
    if (role === 'DUO_CARRY') {
      return 'BOTTOM';
    }
    if (role === 'DUO_SUPPORT') {
      return 'SUPPORT';
    }
    // Bottom lane alone (or with SOLO/DUO) is ambiguous — do not guess Support.
    return 'UNKNOWN';
  }

  return 'UNKNOWN';
}

/**
 * Deterministic normalized position for public display / analytics.
 *
 * Precedence for standard Summoner's Rift:
 * 1. teamPosition
 * 2. individualPosition
 * 3. conservative lane+role fallback
 * 4. UNKNOWN
 *
 * Never treats legacy Riot role values (SOLO/DUO/DUO_SUPPORT) as positions.
 */
export function normalizeParticipantPosition(
  input: NormalizeParticipantPositionInput,
): NormalizedPosition {
  if (isNonStandardMode(input)) {
    return 'UNKNOWN';
  }

  const fromTeam = mapRiotPosition(input.teamPosition);
  if (fromTeam) {
    return fromTeam;
  }

  const fromIndividual = mapRiotPosition(input.individualPosition);
  if (fromIndividual) {
    return fromIndividual;
  }

  return fromLaneAndRole(input.lane, input.role);
}

export function getNormalizedPositionLabel(position: NormalizedPosition): string {
  switch (position) {
    case 'TOP':
      return 'Top';
    case 'JUNGLE':
      return 'Jungle';
    case 'MIDDLE':
      return 'Mid';
    case 'BOTTOM':
      return 'Bot';
    case 'SUPPORT':
      return 'Support';
    case 'UNKNOWN':
      return 'Unknown role';
    default: {
      const _exhaustive: never = position;
      return _exhaustive;
    }
  }
}

/**
 * Legacy public-display behavior (bug): preferred Riot `role` over `teamPosition`.
 * Used only by reprocessing diagnostics to count rows that would change.
 */
export function legacyBuggyPublicRole(input: {
  teamPosition?: string | null;
  role?: string | null;
}): string | null {
  const role = (input.role ?? '').trim();
  if (role) {
    return role.toUpperCase();
  }
  const team = (input.teamPosition ?? '').trim().toUpperCase();
  if (!team || team === 'NONE' || team === 'INVALID') {
    return team || null;
  }
  return team;
}
