import type { ChampionAiInsightValidationError } from './output';

function unknownHandleLabel(error: ChampionAiInsightValidationError): string {
  return error.details.handle ?? 'unknown';
}

export function buildChampionInsightRepairMessage(
  error: ChampionAiInsightValidationError,
): string {
  switch (error.details.reason) {
    case 'UNKNOWN_EVIDENCE_HANDLE':
      return [
        `Your previous output used an unknown evidence handle: ${unknownHandleLabel(error)}.`,
        'Use only the evidence handles listed in the input.',
      ].join('\n');
    case 'UNKNOWN_EVIDENCE_ID':
      return [
        'Your previous output used an unknown evidence id.',
        'Use only the evidence handles listed in the input (E1, E2, E3, ...).',
      ].join('\n');
    case 'UNSUPPORTED_NUMERIC_TOKEN':
      if (error.details.tokenKind === 'timing') {
        return [
          'Your previous response restated an analytics timing value using digits.',
          'Do not mention exact minute checkpoints such as "10 minutes" or "15 minutes".',
          'Rewrite the sentence qualitatively, for example "early-game checkpoints".',
          'Do not change the evidence selection.',
        ].join('\n');
      }
      return [
        'Your previous output contained an analytics number.',
        'Rewrite all analytics values qualitatively. Do not include digits for win rate, sample size, KDA, CS, DPM, or differences.',
      ].join('\n');
    case 'DISALLOWED_STATISTICAL_EVIDENCE':
    case 'BUILD_INSIGHT_NOT_ALLOWED':
    case 'MATCHUP_INSIGHTS_NOT_ALLOWED':
    case 'DISALLOWED_MATCHUP':
      return [
        'Your previous output cited evidence from a slice where interpretationAllowed=false.',
        'Do not draw conclusions from that slice.',
      ].join('\n');
    case 'UNSUPPORTED_ITEM_MECHANICS':
      return [
        'Your previous build explanation introduced item mechanics not provided in the context.',
        'Restrict the explanation to observed statistical support.',
      ].join('\n');
    case 'MISSING_STATISTICAL_EVIDENCE':
      return [
        'Each claim must cite at least one statistical evidence handle (kind: statistical) with interpretationAllowed=true.',
        'Scope, warning, and ability handles cannot be the only evidence.',
      ].join('\n');
    case 'MISSING_BUILD_EVIDENCE':
      return [
        'buildInsight must cite an allowed build, rune, spell, or skill evidence handle.',
      ].join('\n');
    case 'MISSING_MATCHUP_EVIDENCE':
      return [
        "Each matchup insight must cite that matchup's evidence handle from the input.",
      ].join('\n');
    case 'HTML_NOT_ALLOWED':
      return [
        'Your previous output contained HTML.',
        'Return plain text only.',
      ].join('\n');
    case 'INVALID_JSON':
      return [
        'Your previous output was not valid JSON.',
        'Return JSON only. Do not include markdown or commentary.',
      ].join('\n');
    case 'SCHEMA_MISMATCH':
      return [
        'Your previous output did not match the required JSON schema.',
        error.message.length > 400 ? `${error.message.slice(0, 397)}...` : error.message,
      ].join('\n');
    default:
      return [
        'The previous JSON failed validation and must be corrected.',
        error.message.length > 400 ? `${error.message.slice(0, 397)}...` : error.message,
      ].join('\n');
  }
}
