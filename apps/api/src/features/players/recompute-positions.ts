import { legacyBuggyPublicRole, normalizeParticipantPosition } from '@league-helper/shared';

export type RecomputePositionRow = {
  participantId: string;
  playerId: string | null;
  queueId: number;
  mapId: number | null;
  gameMode: string | null;
  remake: boolean;
  teamPosition: string;
  individualPosition: string;
  lane: string | null;
  role: string | null;
};

export type RecomputePositionCounts = {
  examined: number;
  displayWouldChange: number;
  unchanged: number;
  convertedToUnknown: number;
  failed: number;
  cachesInvalidated: number;
};

export type RecomputePositionResult = {
  counts: RecomputePositionCounts;
  affectedPlayerIds: string[];
};

/**
 * Pure recompute diagnostics for stored MatchParticipant rows.
 * Raw provider fields are never mutated — public display is derived at the API boundary.
 * Apply mode invalidates profile caches so clients pick up corrected normalized roles.
 */
export function analyzePositionRecompute(rows: RecomputePositionRow[]): RecomputePositionResult {
  const counts: RecomputePositionCounts = {
    examined: 0,
    displayWouldChange: 0,
    unchanged: 0,
    convertedToUnknown: 0,
    failed: 0,
    cachesInvalidated: 0,
  };
  const affected = new Set<string>();

  for (const row of rows) {
    counts.examined += 1;
    try {
      const normalized = normalizeParticipantPosition({
        queueId: row.queueId,
        mapId: row.mapId,
        gameMode: row.gameMode,
        remake: row.remake,
        teamPosition: row.teamPosition,
        individualPosition: row.individualPosition,
        lane: row.lane,
        role: row.role,
      });

      const legacy = legacyBuggyPublicRole({
        teamPosition: row.teamPosition,
        role: row.role,
      });
      const legacyDisplay = mapLegacyDisplayLabel(legacy);

      if (legacyDisplay !== normalized) {
        counts.displayWouldChange += 1;
        if (row.playerId) {
          affected.add(row.playerId);
        }
      } else {
        counts.unchanged += 1;
      }

      if (normalized === 'UNKNOWN' && legacyDisplay !== 'UNKNOWN') {
        counts.convertedToUnknown += 1;
      }
    } catch {
      counts.failed += 1;
    }
  }

  return {
    counts,
    affectedPlayerIds: [...affected],
  };
}

/** What the old public mapper effectively exposed (after UTILITY→SUPPORT label mapping). */
function mapLegacyDisplayLabel(legacy: string | null): string {
  if (!legacy) {
    return 'UNKNOWN';
  }
  const upper = legacy.toUpperCase();
  if (upper === 'UTILITY') {
    return 'SUPPORT';
  }
  if (upper === 'NONE' || upper === 'INVALID') {
    return 'UNKNOWN';
  }
  return upper;
}
