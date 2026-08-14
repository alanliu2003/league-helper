import { describe, expect, it } from 'vitest';
import { ChampionAiInsightValidationError } from './output';
import {
  championAiValidationDiagnostic,
  formatChampionAiValidationDiagnostic,
} from './diagnostic';

describe('champion AI validation diagnostics', () => {
  it('formats an unknown-handle failure without prompts or secrets', () => {
    const error = new ChampionAiInsightValidationError('EVIDENCE', "Unknown evidence handle 'E99'.", {
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E99',
    });

    expect(championAiValidationDiagnostic(error, { champion: 'Ahri' })).toEqual({
      kind: 'EVIDENCE',
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E99',
      champion: 'Ahri',
    });
    expect(formatChampionAiValidationDiagnostic(error, { champion: 'Ahri' })).toBe(
      'Champion AI validation failed kind=EVIDENCE reason=UNKNOWN_EVIDENCE_HANDLE handle=E99 champion=Ahri',
    );
  });

  it('formats a numeric failure with the rejected token', () => {
    const error = new ChampionAiInsightValidationError(
      'NUMERIC',
      "Unsupported numeric token '51.2' is not on the ability/patch allowlist.",
      { reason: 'UNSUPPORTED_NUMERIC_TOKEN', token: '51.2' },
    );

    expect(formatChampionAiValidationDiagnostic(error)).toBe(
      'Champion AI validation failed kind=NUMERIC reason=UNSUPPORTED_NUMERIC_TOKEN token=51.2',
    );
  });

  it('formats a disallowed-slice failure', () => {
    const error = new ChampionAiInsightValidationError(
      'EVIDENCE',
      "Statistical evidence id 'CHAMPION_WIN_RATE' is not interpretation-allowed.",
      { reason: 'DISALLOWED_STATISTICAL_EVIDENCE' },
    );

    expect(formatChampionAiValidationDiagnostic(error)).toBe(
      'Champion AI validation failed kind=EVIDENCE reason=DISALLOWED_STATISTICAL_EVIDENCE',
    );
  });
});
