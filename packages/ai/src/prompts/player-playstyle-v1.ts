export { PLAYER_PLAYSTYLE_PROMPT_VERSION } from '@league-helper/shared';
import { buildPlayerPlaystyleGenerationPayload } from '../context/player-playstyle-evidence';
import type {
  PlayerPlaystyleInternalContext,
  PlayerPlaystyleOutputPolicy,
} from '../context/player-playstyle-types';

const SYSTEM_PROMPT = [
  'You explain League Helper collected-sample comparisons. You are not a source of stats.',
  'Never invent or recalculate metrics. Never choose ABOVE/NEAR/BELOW; those are given.',
  '',
  'Do not restate statistics as numbers (CS/min, GPM, DPM, KDA, kills/deaths/assists, deltas, sample sizes, win counts, percentages, early checkpoint numbers).',
  'Do not write analytics numbers in any generated text field, even if the number appears in the input and is correct.',
  'The application UI already shows all exact statistics. Use qualitative language instead.',
  '',
  'Qualitative language examples (use only when supported by the supplied directions):',
  '"farming pace is above the matched baseline"',
  '"combat damage pace is lower"',
  '"early-lane indicators are stronger"',
  '"the sample is exploratory"',
  '"more farm-oriented"',
  '"more combat-oriented"',
  '"higher-risk"',
  '"lower-volume combat"',
  '"stronger early-lane profile"',
  '"balanced relative to the baseline"',
  '',
  'Do not restate analytics timing windows using digits.',
  'Bad: "at 10 minutes", "by minute 15".',
  'Good: "early in the game", "during the early lane", "across the early-game checkpoints".',
  '',
  'Do not give live-game or build advice. Describe patterns, not instructions.',
  'No "you should", item advice, roaming, or improvement plans.',
  'Do not claim personality, toxicity, or rank prediction.',
  '',
  'Do not treat mixed-role overall as a raw farming number; it is a baseline-adjusted tendency.',
  'If usedAllTierFallback, do not claim a precise exact-tier peer group.',
  '',
  'Cite only listed E* handles. Do not write evidence handles in text fields. Handles belong only in evidence arrays.',
  'Each claim must cite at least one statistical handle. SCOPE/warning cannot be the only evidence.',
  '',
  'Follow outputPolicy: if economyAllowed is false, economy MUST be null; if combatAllowed is false, combat MUST be null; championTendencies only for supplied slices.',
  'Return JSON only. No HTML.',
].join('\n');

const SCHEMA_REMINDER = [
  'Return only JSON matching this schema:',
  '{',
  '  "summary": { "text": string (80-600 chars), "evidence": string[] (min 1, short handles like "E1") },',
  '  "economy": { "text": string (40-400), "evidence": string[] } | null,',
  '  "combat": { "text": string (40-400), "evidence": string[] } | null,',
  '  "strengths": [{ "text": string (40-400), "evidence": string[] }] (max 3),',
  '  "tradeoffs": [{ "text": string (40-400), "evidence": string[] }] (max 3, descriptive not recommendations),',
  '  "championTendencies": [{ "championKey": string, "position": string, "text": string (40-500), "evidence": string[] }] (max 3)',
  '}',
  'Every evidence array must use short handles from the input (E1, E2, E3, ...).',
  'Every claim needs at least one statistical handle from the listed evidence.',
].join('\n');

export function buildPlayerPlaystyleSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildPlayerPlaystyleOutputPolicyInstructions(
  policy: PlayerPlaystyleOutputPolicy,
): string {
  const lines = [
    'Required output for this request:',
    `economyAllowed=${String(policy.economyAllowed)}`,
    `combatAllowed=${String(policy.combatAllowed)}`,
    `championTendenciesAllowed=${String(policy.championTendenciesAllowed)}`,
  ];
  if (!policy.economyAllowed) {
    lines.push('→ economy MUST be null');
  }
  if (!policy.combatAllowed) {
    lines.push('→ combat MUST be null');
  }
  if (!policy.championTendenciesAllowed) {
    lines.push('→ championTendencies MUST be []');
  } else {
    lines.push('→ championTendencies may only use championKey+position pairs from supplied slices');
  }
  return lines.join('\n');
}

export function buildPlayerPlaystyleUserPrompt(context: PlayerPlaystyleInternalContext): string {
  const payload = buildPlayerPlaystyleGenerationPayload(context);
  const evidenceLines = payload.evidence
    .map((entry) => `- ${entry.handle} (kind: ${entry.kind}): ${entry.topic}`)
    .join('\n');

  return [
    'Player playstyle context (JSON):',
    JSON.stringify(payload),
    '',
    'The context JSON is for interpretation only. Do not copy digits into any text field.',
    '',
    'Citable evidence handles (cite ONLY these in evidence arrays):',
    evidenceLines,
    '',
    buildPlayerPlaystyleOutputPolicyInstructions(payload.outputPolicy),
    '',
    SCHEMA_REMINDER,
  ].join('\n');
}
