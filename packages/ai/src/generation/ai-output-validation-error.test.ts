import { describe, expect, it } from 'vitest';
import { ChampionAiInsightValidationError } from '../validation/output';
import { PlayerPlaystyleValidationError } from '../validation/player-playstyle-output';
import { AiOutputValidationError, readAiValidationDiagnostic } from './ai-output-validation-error';

describe('AiOutputValidationError', () => {
  it('keeps retryable false for champion and player terminal validation causes', () => {
    const champion = new AiOutputValidationError('Champion AI insight output failed validation.', {
      cause: new ChampionAiInsightValidationError('NUMERIC', 'Disallowed numeric token.', {
        reason: 'UNSUPPORTED_NUMERIC_TOKEN',
        token: '51.2%',
      }),
    });
    const player = new AiOutputValidationError(
      'Player playstyle insight output failed validation.',
      {
        cause: new PlayerPlaystyleValidationError('EVIDENCE', "Unknown evidence handle 'E99'.", {
          reason: 'UNKNOWN_EVIDENCE_HANDLE',
          handle: 'E99',
        }),
      },
    );

    expect(champion.retryable).toBe(false);
    expect(player.retryable).toBe(false);
    expect(champion.cause).toBeInstanceOf(ChampionAiInsightValidationError);
    expect(player.cause).toBeInstanceOf(PlayerPlaystyleValidationError);
    expect(readAiValidationDiagnostic(champion.cause)).toEqual({
      code: 'NUMERIC',
      reason: 'UNSUPPORTED_NUMERIC_TOKEN',
      token: '51.2%',
    });
    expect(readAiValidationDiagnostic(player.cause)).toEqual({
      code: 'EVIDENCE',
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E99',
    });
  });
});
