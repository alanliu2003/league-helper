import type { ChampionAiStoredInsight } from '@league-helper/shared';
import type { ChampionInsightAbility, ChampionInsightContext } from '../context/types';

const NUMERIC_TOKEN_PATTERN = /\d+(?:\.\d+)?/g;
const EVIDENCE_HANDLE_IN_PROSE_PATTERN = /\bE\d+\b/g;

export function extractNumericTokens(text: string): string[] {
  return [...text.matchAll(NUMERIC_TOKEN_PATTERN)].map((match) => match[0]);
}

export function stripEvidenceHandlesFromProse(text: string): string {
  return text.replace(EVIDENCE_HANDLE_IN_PROSE_PATTERN, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripIdentityLabelsFromProse(
  text: string,
  context: ChampionInsightContext,
): string {
  let stripped = stripEvidenceHandlesFromProse(text);
  const platform = context.scope.platform.trim();
  if (platform.length > 0) {
    stripped = stripped.replace(new RegExp(`\\b${escapeRegExp(platform)}\\b`, 'gi'), ' ');
  }
  return stripped;
}

function abilityCorpus(ability: ChampionInsightAbility): string {
  return [ability.name, ability.description, ability.cooldown, ability.cost, ability.range]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
}

export function collectInsightTexts(insight: ChampionAiStoredInsight): string[] {
  const texts = [insight.summary.text];
  for (const claim of insight.strengths) {
    texts.push(claim.text);
  }
  for (const claim of insight.weaknesses) {
    texts.push(claim.text);
  }
  if (insight.buildInsight) {
    texts.push(insight.buildInsight.text);
  }
  for (const matchup of insight.matchupInsights) {
    texts.push(matchup.text);
  }
  return texts;
}

export function buildNumericAllowlist(context: ChampionInsightContext): Set<string> {
  const allowlist = new Set<string>([context.scope.patch]);
  const corpora = [
    ...context.abilities.map(abilityCorpus),
    ...context.opponentAbilities.flatMap((group) => group.abilities.map(abilityCorpus)),
    context.scope.patch,
  ];
  for (const corpus of corpora) {
    for (const token of extractNumericTokens(corpus)) {
      allowlist.add(token);
    }
  }
  return allowlist;
}

export function findDisallowedNumericToken(
  insight: ChampionAiStoredInsight,
  context: ChampionInsightContext,
): string | undefined {
  const allowlist = buildNumericAllowlist(context);
  for (const text of collectInsightTexts(insight)) {
    for (const token of extractNumericTokens(stripIdentityLabelsFromProse(text, context))) {
      if (!allowlist.has(token)) {
        return token;
      }
    }
  }
  return undefined;
}

export function findDisallowedNumericTokenForTexts(
  texts: string[],
  allowlist: Set<string>,
): string | undefined {
  for (const text of texts) {
    for (const token of extractNumericTokens(text)) {
      if (!allowlist.has(token)) {
        return token;
      }
    }
  }
  return undefined;
}

export function isAnalyticsTimingToken(token: string, texts: readonly string[]): boolean {
  const escaped = escapeRegExp(token);
  const patterns = [
    new RegExp(`\\bat\\s+(?:\\d+\\s+and\\s+)?${escaped}(?:\\s+minutes?)?\\b`, 'i'),
    new RegExp(`\\bat\\s+${escaped}\\s+and\\s+\\d+(?:\\s+minutes?)?\\b`, 'i'),
    new RegExp(`\\bby\\s+(?:minute\\s+)?${escaped}\\b`, 'i'),
    new RegExp(`\\bminute(?:s)?\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+minutes?\\b`, 'i'),
  ];
  return texts.some((text) => patterns.some((pattern) => pattern.test(text)));
}
