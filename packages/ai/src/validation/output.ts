import { ChampionAiStoredInsightSchema, type ChampionAiStoredInsight } from '@league-helper/shared';
import type { ZodError } from 'zod';
import {
  buildEvidenceHandleMapping,
  resolveEvidenceToken,
  type EvidenceHandleMapping,
} from '../context/evidence-handles';
import type { ChampionInsightContext, ChampionInsightEvidenceEntry } from '../context/types';
import { collectInsightTexts, findDisallowedNumericToken, isAnalyticsTimingToken } from './grounding';

export type ChampionAiInsightValidationCode =
  'PARSE' | 'SCHEMA' | 'EVIDENCE' | 'SLICE' | 'NUMERIC' | 'HTML';

export type ChampionAiInsightValidationReason =
  | 'INVALID_JSON'
  | 'SCHEMA_MISMATCH'
  | 'UNKNOWN_EVIDENCE_HANDLE'
  | 'UNKNOWN_EVIDENCE_ID'
  | 'DISALLOWED_STATISTICAL_EVIDENCE'
  | 'MISSING_STATISTICAL_EVIDENCE'
  | 'MISSING_BUILD_EVIDENCE'
  | 'MISSING_MATCHUP_EVIDENCE'
  | 'BUILD_INSIGHT_NOT_ALLOWED'
  | 'MATCHUP_INSIGHTS_NOT_ALLOWED'
  | 'DISALLOWED_MATCHUP'
  | 'UNSUPPORTED_NUMERIC_TOKEN'
  | 'UNSUPPORTED_ITEM_MECHANICS'
  | 'HTML_NOT_ALLOWED';

export type ChampionAiInsightValidationDetails = {
  reason: ChampionAiInsightValidationReason;
  handle?: string;
  token?: string;
  tokenKind?: 'timing';
  evidenceId?: string;
};

const DEFAULT_REASON_BY_CODE: Record<
  ChampionAiInsightValidationCode,
  ChampionAiInsightValidationReason
> = {
  PARSE: 'INVALID_JSON',
  SCHEMA: 'SCHEMA_MISMATCH',
  EVIDENCE: 'UNKNOWN_EVIDENCE_ID',
  SLICE: 'DISALLOWED_MATCHUP',
  NUMERIC: 'UNSUPPORTED_NUMERIC_TOKEN',
  HTML: 'HTML_NOT_ALLOWED',
};

export class ChampionAiInsightValidationError extends Error {
  readonly details: ChampionAiInsightValidationDetails;

  constructor(
    readonly code: ChampionAiInsightValidationCode,
    message: string,
    details: Partial<ChampionAiInsightValidationDetails> = {},
  ) {
    super(message);
    this.name = 'ChampionAiInsightValidationError';
    this.details = {
      reason: details.reason ?? DEFAULT_REASON_BY_CODE[code],
      ...(details.handle ? { handle: details.handle } : {}),
      ...(details.token ? { token: details.token } : {}),
      ...(details.tokenKind ? { tokenKind: details.tokenKind } : {}),
      ...(details.evidenceId ? { evidenceId: details.evidenceId } : {}),
    };
  }
}

const HTML_PATTERN = /<[a-z][\s\S]*>/i;
const JSON_FENCE_PATTERN = /^```json\s*([\s\S]*?)\s*```$/i;
const SCHEMA_ERROR_MAX_LENGTH = 1500;

const UNSUPPORTED_BUILD_MECHANICS_PATTERNS: RegExp[] = [
  /magic penetration/i,
  /health scaling/i,
  /\bsustain\b/i,
  /burst damage/i,
  /\bmobility\b/i,
  /\bwaveclear\b/i,
  /ability haste/i,
  /cooldown reduction/i,
  /life steal/i,
  /\bomnivamp\b/i,
  /spell vamp/i,
  /grievous wounds/i,
  /armor penetration/i,
  /magic resist(?:ance)?/i,
];

type GroundedClaim = {
  text: string;
  evidence: string[];
};

function truncateMessage(message: string, maxLength = SCHEMA_ERROR_MAX_LENGTH): string {
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.slice(0, maxLength - 3)}...`;
}

function formatZodIssuePath(path: Array<string | number>): string {
  return path.length > 0 ? path.join('.') : 'root';
}

function formatSchemaErrorMessage(error: ZodError): string {
  const details = error.issues
    .map((issue) => `${formatZodIssuePath(issue.path)}: ${issue.message}`)
    .join('; ');
  return truncateMessage(`Insight output does not match the stored schema. ${details}`);
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = JSON_FENCE_PATTERN.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }
  return trimmed;
}

function parseInsightJson(raw: string): unknown {
  const payload = stripJsonFence(raw);
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new ChampionAiInsightValidationError('PARSE', 'Insight output is not valid JSON.', {
      reason: 'INVALID_JSON',
    });
  }
}

function parseStoredInsight(raw: string): ChampionAiStoredInsight {
  const parsed = parseInsightJson(raw);
  const result = ChampionAiStoredInsightSchema.safeParse(parsed);
  if (!result.success) {
    throw new ChampionAiInsightValidationError('SCHEMA', formatSchemaErrorMessage(result.error), {
      reason: 'SCHEMA_MISMATCH',
    });
  }
  return result.data;
}

function isStatisticalEvidenceId(id: string): boolean {
  if (id === 'CONFIDENCE_WARNING') {
    return false;
  }
  if (id.startsWith('SCOPE_') || id.startsWith('ABILITY_')) {
    return false;
  }
  return (
    id.startsWith('CHAMPION_') ||
    id.startsWith('BUILD_') ||
    id.startsWith('RUNE_') ||
    id.startsWith('SPELL_') ||
    id.startsWith('SKILL_') ||
    id.startsWith('MATCHUP_')
  );
}

function isBuildSliceEvidenceId(id: string): boolean {
  return (
    id.startsWith('BUILD_') ||
    id.startsWith('RUNE_') ||
    id.startsWith('SPELL_') ||
    id.startsWith('SKILL_')
  );
}

function catalogMap(context: ChampionInsightContext): Map<string, ChampionInsightEvidenceEntry> {
  return new Map(context.evidenceCatalog.map((entry) => [entry.id, entry]));
}

function collectClaims(insight: ChampionAiStoredInsight): GroundedClaim[] {
  const claims: GroundedClaim[] = [insight.summary, ...insight.strengths, ...insight.weaknesses];
  if (insight.buildInsight) {
    claims.push(insight.buildInsight);
  }
  for (const matchup of insight.matchupInsights) {
    claims.push({ text: matchup.text, evidence: matchup.evidence });
  }
  return claims;
}

function resolveEvidenceList(
  evidence: string[],
  mapping: EvidenceHandleMapping,
): string[] {
  return evidence.map((token) => {
    const resolved = resolveEvidenceToken(token, mapping);
    if (resolved.ok) {
      return resolved.id;
    }
    if (resolved.reason === 'UNKNOWN_EVIDENCE_HANDLE') {
      throw new ChampionAiInsightValidationError(
        'EVIDENCE',
        `Unknown evidence handle '${resolved.handle}'.`,
        { reason: 'UNKNOWN_EVIDENCE_HANDLE', handle: resolved.handle },
      );
    }
    throw new ChampionAiInsightValidationError(
      'EVIDENCE',
      `Unknown evidence id '${resolved.evidenceId}'.`,
      { reason: 'UNKNOWN_EVIDENCE_ID', evidenceId: resolved.evidenceId },
    );
  });
}

function resolveStoredInsightEvidence(
  insight: ChampionAiStoredInsight,
  mapping: EvidenceHandleMapping,
): ChampionAiStoredInsight {
  return {
    summary: {
      ...insight.summary,
      evidence: resolveEvidenceList(insight.summary.evidence, mapping),
    },
    strengths: insight.strengths.map((claim) => ({
      ...claim,
      evidence: resolveEvidenceList(claim.evidence, mapping),
    })),
    weaknesses: insight.weaknesses.map((claim) => ({
      ...claim,
      evidence: resolveEvidenceList(claim.evidence, mapping),
    })),
    buildInsight: insight.buildInsight
      ? {
          ...insight.buildInsight,
          evidence: resolveEvidenceList(insight.buildInsight.evidence, mapping),
        }
      : null,
    matchupInsights: insight.matchupInsights.map((matchup) => ({
      ...matchup,
      evidence: resolveEvidenceList(matchup.evidence, mapping),
    })),
  };
}

function assertEvidence(
  insight: ChampionAiStoredInsight,
  context: ChampionInsightContext,
  mapping: EvidenceHandleMapping,
): void {
  const catalog = catalogMap(context);
  for (const claim of collectClaims(insight)) {
    for (const id of claim.evidence) {
      const entry = catalog.get(id);
      if (!entry) {
        throw new ChampionAiInsightValidationError('EVIDENCE', `Unknown evidence id '${id}'.`, {
          reason: 'UNKNOWN_EVIDENCE_ID',
          evidenceId: id,
        });
      }
      if (isStatisticalEvidenceId(id) && !entry.interpretationAllowed) {
        throw new ChampionAiInsightValidationError(
          'EVIDENCE',
          `Statistical evidence id '${id}' is not interpretation-allowed.`,
          {
            reason: 'DISALLOWED_STATISTICAL_EVIDENCE',
            evidenceId: id,
            handle: mapping.idToHandle.get(id),
          },
        );
      }
    }
    const hasAllowedStatisticalEvidence = claim.evidence.some((id) => {
      const entry = catalog.get(id);
      return Boolean(entry && isStatisticalEvidenceId(id) && entry.interpretationAllowed);
    });
    if (!hasAllowedStatisticalEvidence) {
      throw new ChampionAiInsightValidationError(
        'EVIDENCE',
        'Claim must cite at least one allowed statistical evidence id.',
        { reason: 'MISSING_STATISTICAL_EVIDENCE' },
      );
    }
  }

  if (insight.buildInsight) {
    const hasBuildEvidence = insight.buildInsight.evidence.some((id) => {
      const entry = catalog.get(id);
      return Boolean(entry && isBuildSliceEvidenceId(id) && entry.interpretationAllowed);
    });
    if (!hasBuildEvidence) {
      throw new ChampionAiInsightValidationError(
        'EVIDENCE',
        'buildInsight must cite at least one allowed build, rune, spell, or skill evidence id.',
        { reason: 'MISSING_BUILD_EVIDENCE' },
      );
    }
  }
}

function findMatchup(
  context: ChampionInsightContext,
  opponentChampionKey: string,
  side: 'STRONG' | 'WEAK',
) {
  const rows = side === 'STRONG' ? context.matchups.strongAgainst : context.matchups.weakAgainst;
  return rows.find((row) => row.opponentChampionKey === opponentChampionKey);
}

function assertSliceRules(
  insight: ChampionAiStoredInsight,
  context: ChampionInsightContext,
  mapping: EvidenceHandleMapping,
): void {
  if (insight.buildInsight && !context.buildInsightAllowed) {
    throw new ChampionAiInsightValidationError(
      'SLICE',
      'buildInsight is not allowed for this context.',
      { reason: 'BUILD_INSIGHT_NOT_ALLOWED' },
    );
  }
  if (insight.matchupInsights.length > 0 && !context.matchupExplanationsAllowed) {
    throw new ChampionAiInsightValidationError(
      'SLICE',
      'matchupInsights are not allowed for this context.',
      { reason: 'MATCHUP_INSIGHTS_NOT_ALLOWED' },
    );
  }

  const catalog = catalogMap(context);
  for (const matchup of insight.matchupInsights) {
    const row = findMatchup(context, matchup.opponentChampionKey, matchup.side);
    if (!row || !row.interpretationAllowed) {
      throw new ChampionAiInsightValidationError(
        'SLICE',
        `Matchup ${matchup.side} ${matchup.opponentChampionKey} is not an allowed opponent.`,
        { reason: 'DISALLOWED_MATCHUP' },
      );
    }
    const expectedId = `MATCHUP_${matchup.side}_${matchup.opponentChampionKey}`;
    const entry = catalog.get(expectedId);
    if (!matchup.evidence.includes(expectedId) || !entry?.interpretationAllowed) {
      throw new ChampionAiInsightValidationError(
        'EVIDENCE',
        `Matchup insight must cite allowed evidence id '${expectedId}'.`,
        {
          reason: 'MISSING_MATCHUP_EVIDENCE',
          evidenceId: expectedId,
          handle: mapping.idToHandle.get(expectedId),
        },
      );
    }
  }
}

function assertNumericGrounding(
  insight: ChampionAiStoredInsight,
  context: ChampionInsightContext,
): void {
  const token = findDisallowedNumericToken(insight, context);
  if (token !== undefined) {
    throw new ChampionAiInsightValidationError(
      'NUMERIC',
      `Unsupported numeric token '${token}' is not on the ability/patch allowlist.`,
      {
        reason: 'UNSUPPORTED_NUMERIC_TOKEN',
        token,
        ...(isAnalyticsTimingToken(token, collectInsightTexts(insight))
          ? { tokenKind: 'timing' as const }
          : {}),
      },
    );
  }
}

function assertNoHtml(insight: ChampionAiStoredInsight): void {
  for (const text of collectInsightTexts(insight)) {
    if (HTML_PATTERN.test(text)) {
      throw new ChampionAiInsightValidationError('HTML', 'Insight text must not contain HTML tags.', {
        reason: 'HTML_NOT_ALLOWED',
      });
    }
  }
}

function assertBuildMechanics(insight: ChampionAiStoredInsight): void {
  const text = insight.buildInsight?.text;
  if (!text) {
    return;
  }
  for (const pattern of UNSUPPORTED_BUILD_MECHANICS_PATTERNS) {
    if (pattern.test(text)) {
      throw new ChampionAiInsightValidationError(
        'EVIDENCE',
        'buildInsight must not invent item, rune, spell, or skill mechanics that are not supplied in the context.',
        { reason: 'UNSUPPORTED_ITEM_MECHANICS' },
      );
    }
  }
}

export function validateChampionAiInsight(
  raw: string,
  context: ChampionInsightContext,
): ChampionAiStoredInsight {
  const mapping = buildEvidenceHandleMapping(context.evidenceCatalog, context);
  const insight = resolveStoredInsightEvidence(parseStoredInsight(raw), mapping);
  assertEvidence(insight, context, mapping);
  assertSliceRules(insight, context, mapping);
  assertNumericGrounding(insight, context);
  assertNoHtml(insight);
  assertBuildMechanics(insight);
  return insight;
}
