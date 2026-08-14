import type {
  ChampionAiInsightValidationCode,
  ChampionAiInsightValidationError,
  ChampionAiInsightValidationReason,
} from './output';

export type ChampionAiValidationDiagnostic = {
  kind: ChampionAiInsightValidationCode;
  reason: ChampionAiInsightValidationReason;
  handle?: string;
  token?: string;
  champion?: string;
};

export function championAiValidationDiagnostic(
  error: ChampionAiInsightValidationError,
  extras?: { champion?: string },
): ChampionAiValidationDiagnostic {
  const diagnostic: ChampionAiValidationDiagnostic = {
    kind: error.code,
    reason: error.details.reason,
  };
  if (error.details.handle) {
    diagnostic.handle = error.details.handle;
  }
  if (error.details.token) {
    diagnostic.token = error.details.token;
  }
  if (extras?.champion) {
    diagnostic.champion = extras.champion;
  }
  return diagnostic;
}

export function formatChampionAiValidationDiagnostic(
  error: ChampionAiInsightValidationError,
  extras?: { champion?: string },
): string {
  const diagnostic = championAiValidationDiagnostic(error, extras);
  const parts = [
    'Champion AI validation failed',
    `kind=${diagnostic.kind}`,
    `reason=${diagnostic.reason}`,
  ];
  if (diagnostic.handle) {
    parts.push(`handle=${diagnostic.handle}`);
  }
  if (diagnostic.token) {
    parts.push(`token=${diagnostic.token}`);
  }
  if (diagnostic.champion) {
    parts.push(`champion=${diagnostic.champion}`);
  }
  return parts.join(' ');
}
