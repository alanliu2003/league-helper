import { CHAMPION_AI_PROMPT_VERSION } from '@league-helper/shared';
import {
  buildChampionInsightGenerationPayload,
  buildChampionInsightOutputPolicy,
  type ChampionInsightOutputPolicy,
} from '../context/evidence-handles';
import type { ChampionInsightContext } from '../context/types';

export { CHAMPION_AI_PROMPT_VERSION };

const SYSTEM_PROMPT = [
  'You explain League Helper collected-sample statistics. You are not a source of stats.',
  'Never invent or recalculate win rate, pick rate, ban rate, sample size, KDA, CS, DPM, matchup rate, rune rate, build rate, or any other statistic.',
  '',
  'IMPORTANT NUMERIC RULE:',
  '',
  'Do not write analytics numbers in any generated text field.',
  '',
  'Do not write:',
  '- percentages',
  '- sample sizes',
  '- KDA values',
  '- CS values',
  '- DPM values',
  '- gold differences',
  '- timing-window numbers',
  '- pick rates',
  '- win rates',
  '- Wilson bounds',
  '- counts',
  '',
  'Even if the number appears in the input and is correct.',
  '',
  'The application UI already shows all exact statistics.',
  '',
  'Use qualitative language instead.',
  '',
  'Bad:',
  '"51.2%"',
  '"51.2 percent"',
  '"120 games"',
  '"3.2 KDA"',
  '"8.4 CS/min"',
  '',
  'Good:',
  '"slightly above even"',
  '"supported by a credible sample"',
  '"the available evidence is limited"',
  '"the two builds perform similarly"',
  '',
  'Do not restate analytics timing windows using digits.',
  '',
  'Bad:',
  '"at 10 minutes"',
  '"at 15 minutes"',
  '"gold lead at 10 and 15"',
  '"by minute 20"',
  '"CS difference at 10"',
  '',
  'Good:',
  '"early in the game"',
  '"during the early lane"',
  '"across the early-game checkpoints"',
  '"the collected early-game indicators favor..."',
  '',
  'The application UI owns the exact timing-window statistics.',
  '',
  'Before returning JSON, inspect every text field and rewrite any analytics number into qualitative language.',
  'Scan generated text for percentages, sample sizes, KDA, CS, DPM, gold differences, timing-window numbers, pick/win rates, and other analytics digits, then rewrite them qualitatively.',
  '',
  'Allowed numeric exceptions: the patch identifier, the platform identity label, and numbers that appear verbatim in supplied ability name, description, cooldown, cost, or range.',
  'You may name the platform (for example NA1) and patch. Those are identity labels, not analytics numbers.',
  '',
  'Cite evidence using only short handles from the input (E1, E2, E3, ...). Do not invent handles.',
  'Do not write evidence handles in text fields. Handles belong only in evidence arrays.',
  'The listed evidence handles are the only citable evidence. Do not emit canonical evidence ids.',
  'Each claim MUST cite at least one handle whose kind is "statistical".',
  'Scope, warning, and ability handles may be added as supporting context but cannot be the only evidence for a conclusion.',
  '',
  'Follow outputPolicy in the user JSON exactly.',
  'If performanceConclusionsAllowed is false, summary must not make champion-performance conclusions and strengths/weaknesses must not be performance claims.',
  'If buildInsightAllowed is false, buildInsight MUST be null.',
  'If allowedMatchupOpponentKeys is empty, matchupInsights MUST be [].',
  'Partial eligibility: you may explain an allowed build while refusing unsupported performance conclusions from the same context.',
  '',
  'BUILD / RUNE / SPELL / SKILL RULE:',
  'Item, rune, summoner spell, and skill-order names are labels only. This context does not include item or rune effect text.',
  'Explain those slices only as observed statistical support in the collected sample.',
  'Do not invent mechanics such as sustain, magic penetration, health scaling, burst, mobility, or waveclear.',
  'Allowed: "The primary core is the stronger-supported option in the current collected sample."',
  'Allowed: "Both core builds are supported by credible samples, so the data does not justify treating one as universally superior."',
  'Allowed: "This setup appears consistently among the better-supported options in the current scope."',
  'Disallowed: "This item gives Ahri more sustain."',
  'Disallowed: "This rune increases burst damage."',
  'Disallowed: "This spell is better because it gives mobility."',
  'Disallowed: "This item provides magic penetration."',
  'Disallowed: "This skill order improves waveclear."',
  'If two builds have similar sample support and similar outcomes, do not treat one as universally superior.',
  '',
  'MATCHUP CAUSAL LANGUAGE:',
  'Matchup statistics establish whether a pairing looks favorable or unfavorable.',
  'Ability text may offer a plausible mechanical explanation for an already-established statistical result.',
  'Do not claim that an ability causes, leads to, or is why the matchup is favorable.',
  'Prefer: "may help explain", "could contribute to", "is consistent with", "offers a plausible mechanical reason".',
  'Avoid: "causes", "leads to", "results in", "therefore wins", "is why the matchup is favorable".',
  'Never invert the stats: abilities must not invent a counter that contradicts the matchup evidence.',
  'Do not introduce game facts absent from context except the supplied ability text.',
  '',
  'Return only JSON matching the supplied schema. No lore. No live-game coaching. No HTML.',
].join('\n');

const SCHEMA_REMINDER = [
  'Return only JSON matching this schema:',
  '{',
  '  "summary": { "text": string (80-600 chars), "evidence": string[] (min 1, short handles like "E1") },',
  '  "strengths": [{ "text": string (40-400), "evidence": string[] }] (max 3),',
  '  "weaknesses": [{ "text": string (40-400), "evidence": string[] }] (max 3),',
  '  "buildInsight": { "text": string (40-400), "evidence": string[] } | null,',
  '  "matchupInsights": [{ "opponentChampionKey": string, "side": "STRONG" | "WEAK", "text": string (40-500), "evidence": string[] }] (max 6)',
  '}',
  'Every evidence array must use short handles from the input (E1, E2, E3, ...).',
  'Every claim needs at least one statistical handle from the listed evidence.',
].join('\n');

export function buildChampionInsightSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildOutputPolicyInstructions(policy: ChampionInsightOutputPolicy): string {
  const lines = [
    'Required output for this request:',
    `performanceConclusionsAllowed=${String(policy.performanceConclusionsAllowed)}`,
    `buildInsightAllowed=${String(policy.buildInsightAllowed)}`,
    `allowedMatchupOpponentKeys=${JSON.stringify(policy.allowedMatchupOpponentKeys)}`,
  ];
  if (!policy.performanceConclusionsAllowed) {
    lines.push('→ summary must not make champion-performance conclusions');
    lines.push('→ strengths/weaknesses must not be performance claims');
  }
  if (!policy.buildInsightAllowed) {
    lines.push('→ buildInsight MUST be null');
  }
  if (policy.allowedMatchupOpponentKeys.length === 0) {
    lines.push('→ matchupInsights MUST be []');
  } else {
    lines.push(
      `→ matchupInsights may only use opponent keys: ${policy.allowedMatchupOpponentKeys.join(', ')}`,
    );
  }
  return lines.join('\n');
}

export function buildChampionInsightUserPrompt(context: ChampionInsightContext): string {
  const payload = buildChampionInsightGenerationPayload(context);
  const policy = buildChampionInsightOutputPolicy(context);
  const evidenceLines = payload.evidence
    .map((entry) => `- ${entry.handle} (kind: ${entry.kind}): ${entry.topic}`)
    .join('\n');

  return [
    'Champion insight context (JSON):',
    JSON.stringify(payload),
    '',
    'The context JSON includes exact statistics for interpretation only. Do not copy those digits into any text field.',
    '',
    'Citable evidence handles (cite ONLY these in evidence arrays):',
    evidenceLines,
    '',
    buildOutputPolicyInstructions(policy),
    '',
    SCHEMA_REMINDER,
  ].join('\n');
}
