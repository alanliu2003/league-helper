import { describe, expect, it } from 'vitest';
import { ChampionAiInsightValidationError } from './output';
import { buildChampionInsightRepairMessage } from './repair-message';

describe('buildChampionInsightRepairMessage', () => {
  it('tells the model which unknown handle to stop using', () => {
    const error = new ChampionAiInsightValidationError('EVIDENCE', "Unknown evidence handle 'E99'.", {
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E99',
    });
    const message = buildChampionInsightRepairMessage(error);
    expect(message).toContain('unknown evidence handle: E99');
    expect(message).toContain('Use only the evidence handles listed in the input.');
    expect(message).not.toMatch(/sk-[A-Za-z0-9]|AI_API_KEY|Bearer /i);
  });

  it('asks for qualitative rewrite when analytics digits were present', () => {
    const error = new ChampionAiInsightValidationError(
      'NUMERIC',
      "Unsupported numeric token '51.2' is not on the ability/patch allowlist.",
      { reason: 'UNSUPPORTED_NUMERIC_TOKEN', token: '51.2' },
    );
    const message = buildChampionInsightRepairMessage(error);
    expect(message).toContain('analytics number');
    expect(message).toContain('qualitatively');
    expect(message).toContain('Do not include digits');
    expect(message).not.toContain('10 minutes');
  });

  it('gives a timing-specific repair when an analytics minute checkpoint was restated', () => {
    const error = new ChampionAiInsightValidationError(
      'NUMERIC',
      "Unsupported numeric token '15' is not on the ability/patch allowlist.",
      { reason: 'UNSUPPORTED_NUMERIC_TOKEN', token: '15', tokenKind: 'timing' },
    );
    const message = buildChampionInsightRepairMessage(error);
    expect(message).toContain('analytics timing value using digits');
    expect(message).toContain('10 minutes');
    expect(message).toContain('15 minutes');
    expect(message).toContain('early-game checkpoints');
    expect(message).toContain('Do not change the evidence selection');
  });

  it('forbids conclusions from a disallowed slice', () => {
    const error = new ChampionAiInsightValidationError(
      'EVIDENCE',
      "Statistical evidence id 'CHAMPION_WIN_RATE' is not interpretation-allowed.",
      { reason: 'DISALLOWED_STATISTICAL_EVIDENCE', evidenceId: 'CHAMPION_WIN_RATE' },
    );
    const message = buildChampionInsightRepairMessage(error);
    expect(message).toContain('interpretationAllowed=false');
    expect(message).toContain('Do not draw conclusions from that slice.');
  });

  it('restricts invented item mechanics to observed statistical support', () => {
    const error = new ChampionAiInsightValidationError(
      'EVIDENCE',
      'buildInsight must not invent item, rune, spell, or skill mechanics that are not supplied in the context.',
      { reason: 'UNSUPPORTED_ITEM_MECHANICS' },
    );
    const message = buildChampionInsightRepairMessage(error);
    expect(message).toContain('item mechanics not provided in the context');
    expect(message).toContain('observed statistical support');
  });
});
