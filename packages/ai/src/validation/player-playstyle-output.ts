import {
  PlayerPlaystyleStoredInsightSchema,
  type PlayerPlaystyleStoredInsight,
} from '@league-helper/shared';
import type { ZodError } from 'zod';
import { resolveEvidenceToken, type EvidenceHandleMapping } from '../context/evidence-handles';
import { buildPlayerPlaystyleEvidenceHandleMapping } from '../context/player-playstyle-evidence';
import type {
  PlayerPlaystyleEvidenceEntry,
  PlayerPlaystyleInternalContext,
} from '../context/player-playstyle-types';
import {
  extractNumericTokens,
  findDisallowedNumericTokenForTexts,
  isAnalyticsTimingToken,
  stripEvidenceHandlesFromProse,
} from './grounding';

export type PlayerPlaystyleValidationCode =
  | 'PARSE'
  | 'SCHEMA'
  | 'EVIDENCE'
  | 'SLICE'
  | 'NUMERIC'
  | 'HTML';

export type PlayerPlaystyleValidationReason =
  | 'INVALID_JSON'
  | 'SCHEMA_MISMATCH'
  | 'UNKNOWN_EVIDENCE_HANDLE'
  | 'UNKNOWN_EVIDENCE_ID'
  | 'DISALLOWED_STATISTICAL_EVIDENCE'
  | 'MISSING_STATISTICAL_EVIDENCE'
  | 'MISSING_SLICE_EVIDENCE'
  | 'ECONOMY_NOT_ALLOWED'
  | 'COMBAT_NOT_ALLOWED'
  | 'DISALLOWED_CHAMPION_TENDENCY'
  | 'CHAMPION_TENDENCIES_NOT_ALLOWED'
  | 'UNSUPPORTED_NUMERIC_TOKEN'
  | 'HTML_NOT_ALLOWED';

export type PlayerPlaystyleValidationDetails = {
  reason: PlayerPlaystyleValidationReason;
  handle?: string;
  token?: string;
  tokenKind?: 'timing';
  evidenceId?: string;
};

const DEFAULT_REASON_BY_CODE: Record<
  PlayerPlaystyleValidationCode,
  PlayerPlaystyleValidationReason
> = {
  PARSE: 'INVALID_JSON',
  SCHEMA: 'SCHEMA_MISMATCH',
  EVIDENCE: 'UNKNOWN_EVIDENCE_ID',
  SLICE: 'DISALLOWED_CHAMPION_TENDENCY',
  NUMERIC: 'UNSUPPORTED_NUMERIC_TOKEN',
  HTML: 'HTML_NOT_ALLOWED',
};

export class PlayerPlaystyleValidationError extends Error {
  readonly details: PlayerPlaystyleValidationDetails;

  constructor(
    readonly code: PlayerPlaystyleValidationCode,
    message: string,
    details: Partial<PlayerPlaystyleValidationDetails> = {},
  ) {
    super(message);
    this.name = 'PlayerPlaystyleValidationError';
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
const SLICE_ID_PATTERN = /^SLICE_(.+)_(TOP|JUNGLE|MIDDLE|BOTTOM|SUPPORT)_(.+)$/;

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
    throw new PlayerPlaystyleValidationError('PARSE', 'Insight output is not valid JSON.', {
      reason: 'INVALID_JSON',
    });
  }
}

function parseStoredInsight(raw: string): PlayerPlaystyleStoredInsight {
  const parsed = parseInsightJson(raw);
  const result = PlayerPlaystyleStoredInsightSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlayerPlaystyleValidationError('SCHEMA', formatSchemaErrorMessage(result.error), {
      reason: 'SCHEMA_MISMATCH',
    });
  }
  return result.data;
}

function isForbiddenEvidenceId(id: string): boolean {
  return id === 'OVERALL_KDA';
}

function isStatisticalEvidenceId(id: string): boolean {
  if (isForbiddenEvidenceId(id) || id === 'CONFIDENCE_WARNING') {
    return false;
  }
  if (id.startsWith('SCOPE_')) {
    return false;
  }
  return id.startsWith('OVERALL_') || id.startsWith('SLICE_');
}

function catalogMap(context: PlayerPlaystyleInternalContext): Map<string, PlayerPlaystyleEvidenceEntry> {
  return new Map(context.evidenceCatalog.map((entry) => [entry.id, entry]));
}

function collectClaims(insight: PlayerPlaystyleStoredInsight): GroundedClaim[] {
  const claims: GroundedClaim[] = [insight.summary, ...insight.strengths, ...insight.tradeoffs];
  if (insight.economy) {
    claims.push(insight.economy);
  }
  if (insight.combat) {
    claims.push(insight.combat);
  }
  for (const tendency of insight.championTendencies) {
    claims.push({ text: tendency.text, evidence: tendency.evidence });
  }
  return claims;
}

function collectInsightTexts(insight: PlayerPlaystyleStoredInsight): string[] {
  return collectClaims(insight).map((claim) => claim.text);
}

function resolveEvidenceList(evidence: string[], mapping: EvidenceHandleMapping): string[] {
  return evidence.map((token) => {
    const resolved = resolveEvidenceToken(token, mapping);
    if (resolved.ok) {
      return resolved.id;
    }
    if (resolved.reason === 'UNKNOWN_EVIDENCE_HANDLE') {
      throw new PlayerPlaystyleValidationError(
        'EVIDENCE',
        `Unknown evidence handle '${resolved.handle}'.`,
        { reason: 'UNKNOWN_EVIDENCE_HANDLE', handle: resolved.handle },
      );
    }
    throw new PlayerPlaystyleValidationError(
      'EVIDENCE',
      `Unknown evidence id '${resolved.evidenceId}'.`,
      { reason: 'UNKNOWN_EVIDENCE_ID', evidenceId: resolved.evidenceId },
    );
  });
}

function resolveStoredInsightEvidence(
  insight: PlayerPlaystyleStoredInsight,
  mapping: EvidenceHandleMapping,
): PlayerPlaystyleStoredInsight {
  const resolveClaim = (claim: GroundedClaim): GroundedClaim => ({
    ...claim,
    evidence: resolveEvidenceList(claim.evidence, mapping),
  });

  return {
    summary: resolveClaim(insight.summary),
    economy: insight.economy ? resolveClaim(insight.economy) : null,
    combat: insight.combat ? resolveClaim(insight.combat) : null,
    strengths: insight.strengths.map(resolveClaim),
    tradeoffs: insight.tradeoffs.map(resolveClaim),
    championTendencies: insight.championTendencies.map((tendency) => ({
      ...tendency,
      evidence: resolveEvidenceList(tendency.evidence, mapping),
    })),
  };
}

function assertEvidence(
  insight: PlayerPlaystyleStoredInsight,
  context: PlayerPlaystyleInternalContext,
  mapping: EvidenceHandleMapping,
): void {
  const catalog = catalogMap(context);
  for (const claim of collectClaims(insight)) {
    for (const id of claim.evidence) {
      if (isForbiddenEvidenceId(id)) {
        throw new PlayerPlaystyleValidationError(
          'EVIDENCE',
          `Evidence id '${id}' is not allowed.`,
          { reason: 'DISALLOWED_STATISTICAL_EVIDENCE', evidenceId: id },
        );
      }
      const entry = catalog.get(id);
      if (!entry) {
        throw new PlayerPlaystyleValidationError('EVIDENCE', `Unknown evidence id '${id}'.`, {
          reason: 'UNKNOWN_EVIDENCE_ID',
          evidenceId: id,
        });
      }
      if (isStatisticalEvidenceId(id) && !entry.interpretationAllowed) {
        throw new PlayerPlaystyleValidationError(
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
      throw new PlayerPlaystyleValidationError(
        'EVIDENCE',
        'Claim must cite at least one allowed statistical evidence id.',
        { reason: 'MISSING_STATISTICAL_EVIDENCE' },
      );
    }
  }
}

function sliceMatchesChampionPosition(
  evidenceId: string,
  championKey: string,
  position: string,
): boolean {
  const match = SLICE_ID_PATTERN.exec(evidenceId);
  return match?.[1] === championKey && match[2] === position;
}

function findAllowedSlice(
  context: PlayerPlaystyleInternalContext,
  championKey: string,
  position: string,
) {
  return context.championSlices.find(
    (slice) =>
      slice.championKey === championKey &&
      slice.position === position &&
      slice.comparisons.some((row) => row.interpretationAllowed),
  );
}

function assertSliceRules(
  insight: PlayerPlaystyleStoredInsight,
  context: PlayerPlaystyleInternalContext,
  mapping: EvidenceHandleMapping,
): void {
  if (insight.economy && !context.outputPolicy.economyAllowed) {
    throw new PlayerPlaystyleValidationError(
      'SLICE',
      'economy is not allowed for this context.',
      { reason: 'ECONOMY_NOT_ALLOWED' },
    );
  }
  if (insight.combat && !context.outputPolicy.combatAllowed) {
    throw new PlayerPlaystyleValidationError(
      'SLICE',
      'combat is not allowed for this context.',
      { reason: 'COMBAT_NOT_ALLOWED' },
    );
  }
  if (insight.championTendencies.length > 0 && !context.outputPolicy.championTendenciesAllowed) {
    throw new PlayerPlaystyleValidationError(
      'SLICE',
      'championTendencies are not allowed for this context.',
      { reason: 'CHAMPION_TENDENCIES_NOT_ALLOWED' },
    );
  }

  const catalog = catalogMap(context);
  for (const tendency of insight.championTendencies) {
    const slice = findAllowedSlice(context, tendency.championKey, tendency.position);
    if (!slice) {
      throw new PlayerPlaystyleValidationError(
        'SLICE',
        `Champion tendency ${tendency.championKey} ${tendency.position} is not an allowed slice.`,
        { reason: 'DISALLOWED_CHAMPION_TENDENCY' },
      );
    }
    const hasMatchingSliceEvidence = tendency.evidence.some((id) => {
      const entry = catalog.get(id);
      return Boolean(
        entry &&
          isStatisticalEvidenceId(id) &&
          entry.interpretationAllowed &&
          sliceMatchesChampionPosition(id, tendency.championKey, tendency.position),
      );
    });
    if (!hasMatchingSliceEvidence) {
      throw new PlayerPlaystyleValidationError(
        'EVIDENCE',
        `Champion tendency must cite at least one allowed SLICE_* evidence id for ${tendency.championKey} ${tendency.position}.`,
        {
          reason: 'MISSING_SLICE_EVIDENCE',
          handle: mapping.idToHandle.get(`SLICE_${tendency.championKey}_${tendency.position}_CS_PER_MIN`),
        },
      );
    }
  }
}

function buildPlayerPatchAllowlist(context: PlayerPlaystyleInternalContext): Set<string> {
  const allowlist = new Set<string>();
  const range = context.scope.patchRange;
  if (!range) {
    return allowlist;
  }
  for (const patch of [range.min, range.max]) {
    allowlist.add(patch);
    for (const token of extractNumericTokens(patch)) {
      allowlist.add(token);
    }
  }
  return allowlist;
}

function assertNumericGrounding(
  insight: PlayerPlaystyleStoredInsight,
  context: PlayerPlaystyleInternalContext,
): void {
  const texts = collectInsightTexts(insight).map(stripEvidenceHandlesFromProse);
  const token = findDisallowedNumericTokenForTexts(texts, buildPlayerPatchAllowlist(context));
  if (token !== undefined) {
    throw new PlayerPlaystyleValidationError(
      'NUMERIC',
      `Unsupported numeric token '${token}' is not on the patch allowlist.`,
      {
        reason: 'UNSUPPORTED_NUMERIC_TOKEN',
        token,
        ...(isAnalyticsTimingToken(token, texts) ? { tokenKind: 'timing' as const } : {}),
      },
    );
  }
}

function assertNoHtml(insight: PlayerPlaystyleStoredInsight): void {
  for (const text of collectInsightTexts(insight)) {
    if (HTML_PATTERN.test(text)) {
      throw new PlayerPlaystyleValidationError('HTML', 'Insight text must not contain HTML tags.', {
        reason: 'HTML_NOT_ALLOWED',
      });
    }
  }
}

export function validatePlayerPlaystyleInsight(
  raw: string,
  context: PlayerPlaystyleInternalContext,
): PlayerPlaystyleStoredInsight {
  const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);
  const insight = resolveStoredInsightEvidence(parseStoredInsight(raw), mapping);
  assertEvidence(insight, context, mapping);
  assertSliceRules(insight, context, mapping);
  assertNumericGrounding(insight, context);
  assertNoHtml(insight);
  return insight;
}
