function toEpochMs(value: Date | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Prefer a valid game-end timestamp; else creation + strictly positive finite duration;
 * otherwise null. Never uses ingestion time.
 */
export function resolveMatchEndedAt(
  gameEndTimestamp: Date | number | null | undefined,
  gameCreation: Date | number | null | undefined,
  gameDurationSeconds: number | null | undefined,
): Date | null {
  const endMs = toEpochMs(gameEndTimestamp);
  if (endMs !== null) {
    return new Date(endMs);
  }

  const creationMs = toEpochMs(gameCreation);
  if (
    creationMs === null ||
    typeof gameDurationSeconds !== 'number' ||
    !Number.isFinite(gameDurationSeconds) ||
    gameDurationSeconds <= 0
  ) {
    return null;
  }

  const endedMs = creationMs + gameDurationSeconds * 1000;
  if (!Number.isFinite(endedMs) || endedMs <= 0) {
    return null;
  }

  return new Date(endedMs);
}
