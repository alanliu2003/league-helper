export const BUILD_DISPLAY_EXPLORATORY_MIN = 5;
export const BUILD_DISPLAY_CREDIBLE_MIN = 10;
export const BUILD_DISPLAY_STRONG_MIN = 20;

export type BuildSampleBand = 'BELOW_DISPLAY' | 'EXPLORATORY' | 'CREDIBLE' | 'STRONG';

export type BuildSampleDisplay = {
  band: BuildSampleBand;
  lowSample: boolean;
  exposeWinRate: boolean;
};

/**
 * Build rows are sparser than champion rankings.
 * Do not reuse the ranking floor of 30 as a hide-row threshold.
 * Win rate is omitted below the exploratory floor so 1-game 100% is never a recommendation.
 */
export function classifyBuildSampleDisplay(sampleSize: number): BuildSampleDisplay {
  if (sampleSize < BUILD_DISPLAY_EXPLORATORY_MIN) {
    return { band: 'BELOW_DISPLAY', lowSample: true, exposeWinRate: false };
  }
  if (sampleSize < BUILD_DISPLAY_CREDIBLE_MIN) {
    return { band: 'EXPLORATORY', lowSample: true, exposeWinRate: true };
  }
  if (sampleSize < BUILD_DISPLAY_STRONG_MIN) {
    return { band: 'CREDIBLE', lowSample: false, exposeWinRate: true };
  }
  return { band: 'STRONG', lowSample: false, exposeWinRate: true };
}
