import type {
  ChampionInsightAbility,
  ChampionInsightBuildRow,
  ChampionInsightContext,
  ChampionInsightEvidenceEntry,
  ChampionInsightMatchupRow,
} from './types';

/** Handle-shaped tokens, including invalid ones like E0 that must still be rejected as unknown handles. */
export const EVIDENCE_HANDLE_PATTERN = /^E\d+$/;

export type EvidenceHandleEntry = {
  handle: string;
  id: string;
  interpretationAllowed: boolean;
};

export type GenerationEvidence = {
  handle: string;
  canonicalId: string;
  kind: EvidenceKind;
  topic: string;
};

export type EvidenceHandleMapping = {
  entries: EvidenceHandleEntry[];
  handleToId: Map<string, string>;
  idToHandle: Map<string, string>;
  catalogIds: Set<string>;
};

export type EvidenceTokenResolution =
  | { ok: true; id: string }
  | { ok: false; reason: 'UNKNOWN_EVIDENCE_HANDLE'; handle: string }
  | { ok: false; reason: 'UNKNOWN_EVIDENCE_ID'; evidenceId: string };

export type EvidenceKind = 'scope' | 'warning' | 'statistical' | 'ability';

export type ChampionInsightOutputPolicy = {
  performanceConclusionsAllowed: boolean;
  buildInsightAllowed: boolean;
  allowedMatchupOpponentKeys: string[];
};

const PERFORMANCE_EVIDENCE_IDS = [
  'CHAMPION_WIN_RATE',
  'CHAMPION_SAMPLE_SIZE',
  'CHAMPION_SAMPLE_CONFIDENCE',
  'CHAMPION_WILSON_INTERVAL',
  'CHAMPION_KDA',
  'CHAMPION_CS_PER_MIN',
  'CHAMPION_DPM',
] as const;

export function evidenceKind(id: string): EvidenceKind {
  if (id.startsWith('SCOPE_')) {
    return 'scope';
  }
  if (id === 'CONFIDENCE_WARNING') {
    return 'warning';
  }
  if (id.startsWith('ABILITY_')) {
    return 'ability';
  }
  return 'statistical';
}

const TOPIC_BY_ID: Record<string, string> = {
  SCOPE_PATCH: 'scope patch identity',
  SCOPE_POSITION: 'scope position',
  SCOPE_RANK: 'scope rank',
  CONFIDENCE_WARNING: 'limited-evidence / confidence warning',
  CHAMPION_WIN_RATE: 'champion win rate',
  CHAMPION_SAMPLE_SIZE: 'champion sample size',
  CHAMPION_SAMPLE_CONFIDENCE: 'champion sample confidence',
  CHAMPION_WILSON_INTERVAL: 'champion interval confidence',
  CHAMPION_KDA: 'champion KDA',
  CHAMPION_CS_PER_MIN: 'champion CS per minute',
  CHAMPION_DPM: 'champion damage per minute',
  BUILD_CORE_PRIMARY: 'primary core build',
  BUILD_CORE_SECONDARY: 'secondary core build',
  BUILD_STARTING_PRIMARY: 'primary starting items',
  BUILD_BOOTS_PRIMARY: 'primary boots',
  RUNE_PAGE_PRIMARY: 'primary rune page',
  SPELL_PAIR_PRIMARY: 'primary summoner spells',
  SKILL_ORDER_PRIMARY: 'primary skill order',
};

type GenerationContext = Pick<ChampionInsightContext, 'champion' | 'matchups'>;

function allowedMatchupOpponentKeys(context: GenerationContext): string[] {
  return [...context.matchups.strongAgainst, ...context.matchups.weakAgainst]
    .filter((row) => row.interpretationAllowed)
    .map((row) => row.opponentChampionKey);
}

function isOpponentAbilityId(id: string, championKey: string): string | undefined {
  const ability = /^ABILITY_([^_]+)_(.+)$/.exec(id);
  if (!ability?.[1] || ability[1] === championKey) {
    return undefined;
  }
  return ability[1];
}

export function isGenerationCitableEvidence(
  entry: ChampionInsightEvidenceEntry,
  context?: GenerationContext,
): boolean {
  if (!entry.interpretationAllowed) {
    return false;
  }
  if (!context) {
    return true;
  }
  if (entry.id.startsWith('ABILITY_')) {
    const allowedOpponents = allowedMatchupOpponentKeys(context);
    if (allowedOpponents.length === 0) {
      return false;
    }
    const opponentKey = isOpponentAbilityId(entry.id, context.champion.championKey);
    if (opponentKey) {
      return allowedOpponents.includes(opponentKey);
    }
    return true;
  }
  return true;
}

export function buildGenerationEvidence(
  catalog: ChampionInsightEvidenceEntry[],
  context?: GenerationContext,
): GenerationEvidence[] {
  return catalog.filter((entry) => isGenerationCitableEvidence(entry, context)).map((entry, index) => ({
    handle: `E${index + 1}`,
    canonicalId: entry.id,
    kind: evidenceKind(entry.id),
    topic: evidenceTopicLabel(entry.id),
  }));
}

export function buildEvidenceHandleMapping(
  catalog: ChampionInsightEvidenceEntry[],
  context?: GenerationContext,
): EvidenceHandleMapping {
  const generation = buildGenerationEvidence(catalog, context);
  const entries: EvidenceHandleEntry[] = generation.map((entry) => ({
    handle: entry.handle,
    id: entry.canonicalId,
    interpretationAllowed: true,
  }));

  return {
    entries,
    handleToId: new Map(entries.map((entry) => [entry.handle, entry.id])),
    idToHandle: new Map(entries.map((entry) => [entry.id, entry.handle])),
    catalogIds: new Set(catalog.map((entry) => entry.id)),
  };
}

export function isEvidenceHandle(token: string): boolean {
  return EVIDENCE_HANDLE_PATTERN.test(token);
}

export function resolveEvidenceToken(
  token: string,
  mapping: EvidenceHandleMapping,
): EvidenceTokenResolution {
  if (isEvidenceHandle(token)) {
    const id = mapping.handleToId.get(token);
    if (!id) {
      return { ok: false, reason: 'UNKNOWN_EVIDENCE_HANDLE', handle: token };
    }
    return { ok: true, id };
  }

  if (mapping.catalogIds.has(token) || mapping.idToHandle.has(token)) {
    return { ok: true, id: token };
  }

  return { ok: false, reason: 'UNKNOWN_EVIDENCE_ID', evidenceId: token };
}

export function evidenceTopicLabel(id: string): string {
  const known = TOPIC_BY_ID[id];
  if (known) {
    return known;
  }

  const strong = /^MATCHUP_STRONG_(.+)$/.exec(id);
  if (strong?.[1]) {
    return `strong matchup vs ${strong[1]}`;
  }

  const weak = /^MATCHUP_WEAK_(.+)$/.exec(id);
  if (weak?.[1]) {
    return `weak matchup vs ${weak[1]}`;
  }

  const ability = /^ABILITY_([^_]+)_(.+)$/.exec(id);
  if (ability?.[1] && ability[2]) {
    return `${ability[1]} ${ability[2]} ability`;
  }

  return 'listed evidence';
}

function omitInterpretationAllowed<T extends { interpretationAllowed: boolean }>(
  row: T,
): Omit<T, 'interpretationAllowed'> {
  const { interpretationAllowed: _ignored, ...rest } = row;
  return rest;
}

function withHandle<T extends object>(
  row: T,
  mapping: EvidenceHandleMapping,
  id: string,
): T & { evidenceHandle?: string } {
  const handle = mapping.idToHandle.get(id);
  return handle ? { ...row, evidenceHandle: handle } : row;
}

function handlesForIds(mapping: EvidenceHandleMapping, ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const handle = mapping.idToHandle.get(id);
    return handle ? [handle] : [];
  });
}

function generationBuildRows(
  rows: ChampionInsightBuildRow[],
  mapping: EvidenceHandleMapping,
  idForIndex: (index: number) => string,
) {
  return rows.flatMap((row, index) => {
    if (!row.interpretationAllowed) {
      return [];
    }
    return [withHandle(omitInterpretationAllowed(row), mapping, idForIndex(index))];
  });
}

function generationMatchupRows(
  rows: ChampionInsightMatchupRow[],
  mapping: EvidenceHandleMapping,
  side: 'STRONG' | 'WEAK',
) {
  return rows.flatMap((row) => {
    if (!row.interpretationAllowed) {
      return [];
    }
    return [
      withHandle(
        omitInterpretationAllowed(row),
        mapping,
        `MATCHUP_${side}_${row.opponentChampionKey}`,
      ),
    ];
  });
}

export function buildChampionInsightOutputPolicy(
  context: ChampionInsightContext,
): ChampionInsightOutputPolicy {
  return {
    performanceConclusionsAllowed: context.performanceConclusionsAllowed,
    buildInsightAllowed: context.buildInsightAllowed,
    allowedMatchupOpponentKeys: allowedMatchupOpponentKeys(context),
  };
}

export function buildChampionInsightGenerationPayload(context: ChampionInsightContext) {
  const mapping = buildEvidenceHandleMapping(context.evidenceCatalog, context);
  const outputPolicy = buildChampionInsightOutputPolicy(context);
  const allowedOpponents = new Set(outputPolicy.allowedMatchupOpponentKeys);
  const hasEligibleMatchup = outputPolicy.allowedMatchupOpponentKeys.length > 0;
  const { interpretationAllowed: _performanceAllowed, ...performanceMetrics } = context.performance;

  return {
    champion: context.champion,
    scope: context.scope,
    outputPolicy,
    performance: {
      ...performanceMetrics,
      evidenceHandles: outputPolicy.performanceConclusionsAllowed
        ? handlesForIds(mapping, PERFORMANCE_EVIDENCE_IDS)
        : [],
    },
    builds: {
      coreBuilds: generationBuildRows(context.builds.coreBuilds, mapping, (index) =>
        index === 0 ? 'BUILD_CORE_PRIMARY' : 'BUILD_CORE_SECONDARY',
      ),
      startingItems: generationBuildRows(context.builds.startingItems, mapping, () => 'BUILD_STARTING_PRIMARY'),
      boots: generationBuildRows(context.builds.boots, mapping, () => 'BUILD_BOOTS_PRIMARY'),
      runes: generationBuildRows(context.builds.runes, mapping, () => 'RUNE_PAGE_PRIMARY'),
      summonerSpells: generationBuildRows(
        context.builds.summonerSpells,
        mapping,
        () => 'SPELL_PAIR_PRIMARY',
      ),
      skillOrder: generationBuildRows(context.builds.skillOrder, mapping, () => 'SKILL_ORDER_PRIMARY'),
    },
    matchupCandidates: {
      strongAgainst: generationMatchupRows(context.matchups.strongAgainst, mapping, 'STRONG'),
      weakAgainst: generationMatchupRows(context.matchups.weakAgainst, mapping, 'WEAK'),
    },
    abilities: hasEligibleMatchup
      ? context.abilities.map((ability: ChampionInsightAbility) =>
          withHandle(ability, mapping, `ABILITY_${ability.championKey}_${ability.slot}`),
        )
      : [],
    opponentAbilities: hasEligibleMatchup
      ? context.opponentAbilities
          .filter((group) => allowedOpponents.has(group.championKey))
          .map((group) => ({
            championKey: group.championKey,
            abilities: group.abilities.map((ability) =>
              withHandle(ability, mapping, `ABILITY_${ability.championKey}_${ability.slot}`),
            ),
          }))
      : [],
    generationEligible: context.generationEligible,
    performanceConclusionsAllowed: context.performanceConclusionsAllowed,
    buildInsightAllowed: context.buildInsightAllowed,
    matchupExplanationsAllowed: context.matchupExplanationsAllowed,
    evidence: mapping.entries.map((entry) => ({
      handle: entry.handle,
      kind: evidenceKind(entry.id),
      topic: evidenceTopicLabel(entry.id),
    })),
  };
}
