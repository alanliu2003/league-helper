import { MatchAnalyticsValidationError } from '../errors';

/**
 * Wilson score interval for a binomial proportion.
 *
 * Let p = wins / n, z = Φ⁻¹(1 − α/2) where α = 1 − confidenceLevel.
 * center = (p + z²/(2n)) / (1 + z²/n)
 * margin = (z / (1 + z²/n)) * sqrt(p(1 − p)/n + z²/(4n²))
 * Bounds are clamped to [0, 1].
 */

export type WilsonScoreInterval = {
  lowerBound: number;
  upperBound: number;
  confidenceLevel: number;
};

/**
 * Approximate inverse of the standard normal CDF (Φ⁻¹).
 * Rational approximation suitable for confidence-interval z-scores.
 */
function inverseNormApprox(p: number): number {
  if (p <= 0 || p >= 1 || !Number.isFinite(p)) {
    throw new MatchAnalyticsValidationError(
      'inverseNormApprox requires p in (0, 1).',
      'INVALID_INVERSE_NORM_P',
    );
  }

  // Coefficients for Acklam's approximation
  const a = [
    -3.969683028665376e1, 2.209460984245175e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614794e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }

  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }

  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function wilsonScoreInterval(
  wins: number,
  sampleSize: number,
  confidenceLevel: number,
): WilsonScoreInterval | null {
  if (
    !Number.isFinite(confidenceLevel) ||
    confidenceLevel <= 0 ||
    confidenceLevel >= 1
  ) {
    throw new MatchAnalyticsValidationError(
      'confidenceLevel must be a finite number in (0, 1).',
      'INVALID_CONFIDENCE_LEVEL',
    );
  }

  if (!Number.isFinite(wins) || !Number.isFinite(sampleSize)) {
    return null;
  }

  if (sampleSize < 0) {
    throw new MatchAnalyticsValidationError(
      'sampleSize must not be negative.',
      'INVALID_SAMPLE_SIZE',
    );
  }

  if (sampleSize === 0) {
    return null;
  }

  if (wins < 0 || wins > sampleSize) {
    throw new MatchAnalyticsValidationError(
      'wins must be between 0 and sampleSize inclusive.',
      'INVALID_WINS',
    );
  }

  const n = sampleSize;
  const p = wins / n;
  const z = inverseNormApprox((1 + confidenceLevel) / 2);
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin =
    (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  return {
    lowerBound: clamp01(center - margin),
    upperBound: clamp01(center + margin),
    confidenceLevel,
  };
}
