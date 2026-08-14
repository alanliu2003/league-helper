import type { PlayerPlaystyleSampleBand } from '@league-helper/shared';

export const PLAYER_PLAYSTYLE_EXPLORATORY_MIN = 5;
export const PLAYER_PLAYSTYLE_CREDIBLE_MIN = 10;
export const PLAYER_PLAYSTYLE_STRONG_MIN = 20;

/**
 * Player playstyle sample bands are independent of champion ranking (floor 30)
 * and build display bands (BELOW_DISPLAY). 0–4 games is INSUFFICIENT.
 */
export function classifyPlayerPlaystyleSampleBand(sampleSize: number): PlayerPlaystyleSampleBand {
  if (sampleSize < PLAYER_PLAYSTYLE_EXPLORATORY_MIN) {
    return 'INSUFFICIENT';
  }
  if (sampleSize < PLAYER_PLAYSTYLE_CREDIBLE_MIN) {
    return 'EXPLORATORY';
  }
  if (sampleSize < PLAYER_PLAYSTYLE_STRONG_MIN) {
    return 'CREDIBLE';
  }
  return 'STRONG';
}
