import type { ConfidenceInterval, SampleConfidence } from '@league-helper/shared';

/** Format a rate (0–1) as a percentage; null/NaN/Infinity → Unavailable. */
export function formatChampionRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Unavailable';
  }
  return `${(value * 100).toFixed(1)}%`;
}

/** Format a finite metric; null/NaN/Infinity → Unavailable (never fake 0). */
export function formatChampionMetric(
  value: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Unavailable';
  }
  const digits = options.digits ?? 2;
  const formatted = value.toFixed(digits);
  if (options.signed && value > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

export function formatWilsonInterval(interval: ConfidenceInterval | null | undefined): string {
  if (!interval) {
    return 'Unavailable';
  }
  if (!Number.isFinite(interval.lowerBound) || !Number.isFinite(interval.upperBound)) {
    return 'Unavailable';
  }
  return `${(interval.lowerBound * 100).toFixed(1)}–${(interval.upperBound * 100).toFixed(1)}%`;
}

export function deriveLosses(sampleSize: number, wins: number): number {
  if (!Number.isFinite(sampleSize) || !Number.isFinite(wins)) {
    return 0;
  }
  return Math.max(0, sampleSize - wins);
}

export function confidenceToneClass(confidence: SampleConfidence): string {
  switch (confidence) {
    case 'HIGH':
      return 'text-[var(--lh-victory)]';
    case 'MEDIUM':
      return 'text-[var(--lh-accent)]';
    case 'LOW':
      return 'text-[var(--lh-warning)]';
    case 'INSUFFICIENT':
    default:
      return 'text-[var(--lh-muted)]';
  }
}

export function positionDisplayLabel(position: string): string {
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
    default:
      return position;
  }
}
