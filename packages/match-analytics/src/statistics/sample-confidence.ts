export type SampleConfidence = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';

export type SampleConfidenceThresholds = {
  readonly insufficientBelow: number;
  readonly lowBelow: number;
  readonly mediumBelow: number;
};

export const DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS: SampleConfidenceThresholds = {
  insufficientBelow: 30,
  lowBelow: 100,
  mediumBelow: 500,
} as const;

export function classifySampleConfidence(
  sampleSize: number,
  thresholds: SampleConfidenceThresholds = DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
): SampleConfidence {
  if (sampleSize < thresholds.insufficientBelow) {
    return 'INSUFFICIENT';
  }
  if (sampleSize < thresholds.lowBelow) {
    return 'LOW';
  }
  if (sampleSize < thresholds.mediumBelow) {
    return 'MEDIUM';
  }
  return 'HIGH';
}
