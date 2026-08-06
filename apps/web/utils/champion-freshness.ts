import type { ChampionStatsFreshness } from '@league-helper/shared';

export type ChampionFreshnessBanner = {
  text: string;
  tone: 'accent' | 'muted';
};

/**
 * Map envelope freshness to a subtle UI banner.
 * CURRENT → no banner. Never invents staleRelativeToMatches.
 */
export function championFreshnessBanner(
  freshness: ChampionStatsFreshness | null | undefined,
  options: { calculatedAt?: string | null } = {},
): ChampionFreshnessBanner | null {
  switch (freshness) {
    case 'RECALCULATION_PENDING':
      return {
        text: 'Aggregates are updating. Figures may change shortly.',
        tone: 'accent',
      };
    case 'UNKNOWN': {
      const calculatedAt = options.calculatedAt;
      return {
        text: calculatedAt
          ? `Last calculated ${new Date(calculatedAt).toLocaleString()} — freshness not claimed as current.`
          : 'Freshness unknown — timestamp currentness is not claimed.',
        tone: 'muted',
      };
    }
    case 'CURRENT':
    default:
      return null;
  }
}
