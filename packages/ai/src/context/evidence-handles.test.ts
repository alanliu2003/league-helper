import { describe, expect, it } from 'vitest';
import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionCoreBuild,
  ChampionMatchupRow,
} from '@league-helper/shared';
import { buildChampionInsightContext } from './builder';
import type { ChampionInsightContextInput, ChampionInsightEvidenceEntry } from './types';
import {
  buildChampionInsightGenerationPayload,
  buildEvidenceHandleMapping,
  evidenceKind,
  evidenceTopicLabel,
  resolveEvidenceToken,
} from './evidence-handles';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function metrics(): ChampionAggregateMetrics {
  return {
    sampleSize: 120,
    wins: 61,
    winRate: 0.512,
    wilsonInterval: {
      lowerBound: 0.42,
      upperBound: 0.6,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'HIGH',
    aggregateKdaRatio: 3.2,
    averageCsPerMinute: 8.4,
    averageDamagePerMinute: 580,
    averageVisionScorePerMinute: 1.1,
    averageGoldPerMinute: 400,
    averageGoldDifferenceAt10: 212,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
  };
}

function coreBuild(sampleBand: ChampionCoreBuild['sampleBand'] = 'CREDIBLE'): ChampionCoreBuild {
  const exploratory = sampleBand === 'EXPLORATORY' || sampleBand === 'BELOW_DISPLAY';
  return {
    items: [
      item(3001, "Rylai's Crystal Scepter"),
      item(3002, "Liandry's Torment"),
      item(3003, "Zhonya's Hourglass"),
    ],
    sampleSize: exploratory ? 6 : 40,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample: exploratory,
    sampleBand,
  };
}

function matchup(
  championKey: string,
  name: string,
  overrides: Partial<Omit<ChampionMatchupRow, 'opponent'>> & { championId?: number } = {},
): ChampionMatchupRow {
  const { championId, ...row } = overrides;
  return {
    opponent: {
      championId: championId ?? 134,
      championKey,
      name,
      iconUrl: 'https://example.com/champ.png',
    },
    position: 'MIDDLE',
    sampleSize: 40,
    wins: 24,
    losses: 16,
    winRate: 0.6,
    wilsonInterval: { lowerBound: 0.44, upperBound: 0.74, confidenceLevel: 0.95 },
    sampleConfidence: 'MEDIUM',
    lowSample: false,
    averageGoldDifferenceAt10: 50,
    averageGoldDifferenceAt15: 90,
    averageCsDifferenceAt10: 2,
    averageCsDifferenceAt15: 4,
    ...row,
  };
}

function ability(
  slot: ChampionAbilitySummary['slot'],
  name: string,
  description: string,
): ChampionAbilitySummary {
  return {
    slot,
    name,
    description,
    iconUrl: 'https://example.com/ability.png',
    cooldown: '12/11/10',
    cost: '70/75/80',
    range: '900',
  };
}

function input(overrides: Partial<ChampionInsightContextInput> = {}): ChampionInsightContextInput {
  return {
    champion: {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      position: 'MIDDLE',
    },
    scope: {
      patch: '16.15',
      platform: 'na1',
      queueId: 420,
      tier: 'GOLD',
      kind: 'COLLECTED_SAMPLE',
    },
    stats: metrics(),
    builds: {
      coreBuilds: [coreBuild()],
      startingItems: [],
      boots: [],
      runes: [],
      summonerSpells: [],
      skillOrder: [],
    },
    matchups: {
      strongAgainst: [matchup('Syndra', 'Syndra')],
      weakAgainst: [],
    },
    abilities: [ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.')],
    ...overrides,
  };
}

function generationHandles(context: ReturnType<typeof buildChampionInsightContext>) {
  return buildEvidenceHandleMapping(context.evidenceCatalog, context);
}

describe('evidence handle mapping', () => {
  it('assigns sequential E-handles from catalog order and is deterministic', () => {
    const catalog = buildChampionInsightContext(input()).evidenceCatalog;
    const first = buildEvidenceHandleMapping(catalog);
    const second = buildEvidenceHandleMapping(catalog);

    expect(first.entries[0]).toEqual({
      handle: 'E1',
      id: catalog[0]?.id,
      interpretationAllowed: catalog[0]?.interpretationAllowed,
    });
    expect(first.handleToId.get('E1')).toBe(catalog[0]?.id);
    expect(first.idToHandle.get(catalog[0]?.id ?? '')).toBe('E1');
    expect(first.entries).toHaveLength(catalog.length);
    expect(first.entries.at(-1)?.handle).toBe(`E${catalog.length}`);
    expect(second.entries).toEqual(first.entries);
  });

  it('maps known champion, build, matchup, and ability ids to stable handles', () => {
    const catalog = buildChampionInsightContext(input()).evidenceCatalog;
    const mapping = buildEvidenceHandleMapping(catalog);

    expect(mapping.idToHandle.get('CHAMPION_WIN_RATE')).toMatch(/^E[1-9]\d*$/);
    expect(mapping.idToHandle.get('BUILD_CORE_PRIMARY')).toMatch(/^E[1-9]\d*$/);
    expect(mapping.idToHandle.get('MATCHUP_STRONG_Syndra')).toMatch(/^E[1-9]\d*$/);
    expect(mapping.idToHandle.get('ABILITY_Ahri_E')).toMatch(/^E[1-9]\d*$/);
    expect(mapping.handleToId.get(mapping.idToHandle.get('CHAMPION_WIN_RATE') ?? '')).toBe(
      'CHAMPION_WIN_RATE',
    );
  });

  it('resolves handles to canonical ids and rejects unknown handles', () => {
    const catalog: ChampionInsightEvidenceEntry[] = [
      { id: 'CHAMPION_WIN_RATE', interpretationAllowed: true },
      { id: 'BUILD_CORE_PRIMARY', interpretationAllowed: true },
    ];
    const mapping = buildEvidenceHandleMapping(catalog);

    expect(resolveEvidenceToken('E1', mapping)).toEqual({
      ok: true,
      id: 'CHAMPION_WIN_RATE',
    });
    expect(resolveEvidenceToken('E2', mapping)).toEqual({
      ok: true,
      id: 'BUILD_CORE_PRIMARY',
    });
    expect(resolveEvidenceToken('E17', mapping)).toEqual({
      ok: false,
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E17',
    });
    expect(resolveEvidenceToken('E0', mapping)).toEqual({
      ok: false,
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E0',
    });
  });

  it('still resolves canonical catalog ids for robustness', () => {
    const catalog: ChampionInsightEvidenceEntry[] = [
      { id: 'CHAMPION_WIN_RATE', interpretationAllowed: true },
    ];
    const mapping = buildEvidenceHandleMapping(catalog);

    expect(resolveEvidenceToken('CHAMPION_WIN_RATE', mapping)).toEqual({
      ok: true,
      id: 'CHAMPION_WIN_RATE',
    });
    expect(resolveEvidenceToken('NOT_A_REAL_ID', mapping)).toEqual({
      ok: false,
      reason: 'UNKNOWN_EVIDENCE_ID',
      evidenceId: 'NOT_A_REAL_ID',
    });
  });

  it('builds short topic labels without requiring the model to emit canonical ids', () => {
    expect(evidenceTopicLabel('CHAMPION_WIN_RATE')).toMatch(/win rate/i);
    expect(evidenceTopicLabel('BUILD_CORE_PRIMARY')).toMatch(/primary core/i);
    expect(evidenceTopicLabel('MATCHUP_STRONG_Syndra')).toMatch(/Syndra/);
    expect(evidenceTopicLabel('ABILITY_Ahri_E')).toMatch(/Ahri/);
    expect(evidenceTopicLabel('CONFIDENCE_WARNING')).toMatch(/limited|confidence/i);
  });

  it('exposes handles on the generation payload and omits canonical evidence ids', () => {
    const context = buildChampionInsightContext(input());
    const payload = buildChampionInsightGenerationPayload(context);
    const serialized = JSON.stringify(payload);

    expect(payload.evidence[0]?.handle).toBe('E1');
    expect(payload.performance.evidenceHandles.length).toBeGreaterThan(0);
    expect(payload.builds.coreBuilds[0]?.evidenceHandle).toMatch(/^E\d+$/);
    expect(payload.matchupCandidates.strongAgainst[0]?.evidenceHandle).toMatch(/^E\d+$/);
    expect(payload.evidence[0]?.kind).toBe('scope');
    expect(payload.evidence.some((entry) => entry.kind === 'statistical')).toBe(true);
    expect(payload.outputPolicy.performanceConclusionsAllowed).toBe(true);
    expect(payload.outputPolicy.buildInsightAllowed).toBe(true);
    expect(payload.outputPolicy.allowedMatchupOpponentKeys).toEqual(['Syndra']);
    expect(serialized).not.toContain('CHAMPION_WIN_RATE');
    expect(serialized).not.toContain('BUILD_CORE_PRIMARY');
    expect(serialized).not.toContain('MATCHUP_STRONG_Syndra');
    expect(serialized).not.toContain('ABILITY_Ahri_E');
    expect(serialized).not.toContain('evidenceCatalog');
  });

  it('classifies scope, warning, statistical, and ability kinds', () => {
    expect(evidenceKind('SCOPE_PATCH')).toBe('scope');
    expect(evidenceKind('CONFIDENCE_WARNING')).toBe('warning');
    expect(evidenceKind('CHAMPION_WIN_RATE')).toBe('statistical');
    expect(evidenceKind('BUILD_CORE_PRIMARY')).toBe('statistical');
    expect(evidenceKind('MATCHUP_STRONG_Syndra')).toBe('statistical');
    expect(evidenceKind('ABILITY_Ahri_E')).toBe('ability');
  });
});

describe('generation-facing evidence vs internal catalog', () => {
  it('gives allowed evidence an E# handle and skips disallowed statistical evidence', () => {
    const catalog: ChampionInsightEvidenceEntry[] = [
      { id: 'SCOPE_PATCH', interpretationAllowed: true },
      { id: 'CHAMPION_WIN_RATE', interpretationAllowed: false },
      { id: 'CHAMPION_SAMPLE_SIZE', interpretationAllowed: false },
      { id: 'BUILD_CORE_PRIMARY', interpretationAllowed: true },
    ];
    const mapping = buildEvidenceHandleMapping(catalog);

    expect(mapping.entries.map((entry) => entry.id)).toEqual(['SCOPE_PATCH', 'BUILD_CORE_PRIMARY']);
    expect(mapping.entries.map((entry) => entry.handle)).toEqual(['E1', 'E2']);
    expect(mapping.idToHandle.get('SCOPE_PATCH')).toBe('E1');
    expect(mapping.idToHandle.get('BUILD_CORE_PRIMARY')).toBe('E2');
    expect(mapping.idToHandle.get('CHAMPION_WIN_RATE')).toBeUndefined();
    expect(mapping.idToHandle.get('CHAMPION_SAMPLE_SIZE')).toBeUndefined();
    expect(mapping.handleToId.get('E1')).toBe('SCOPE_PATCH');
    expect(mapping.handleToId.get('E2')).toBe('BUILD_CORE_PRIMARY');
  });

  it('keeps deterministic handle order after skipping disallowed catalog entries', () => {
    const catalog: ChampionInsightEvidenceEntry[] = [
      { id: 'SCOPE_PATCH', interpretationAllowed: true },
      { id: 'CHAMPION_WIN_RATE', interpretationAllowed: false },
      { id: 'CONFIDENCE_WARNING', interpretationAllowed: true },
      { id: 'BUILD_CORE_PRIMARY', interpretationAllowed: true },
    ];
    const first = buildEvidenceHandleMapping(catalog);
    const second = buildEvidenceHandleMapping(catalog);

    expect(first.entries.map((entry) => `${entry.handle}:${entry.id}`)).toEqual([
      'E1:SCOPE_PATCH',
      'E2:CONFIDENCE_WARNING',
      'E3:BUILD_CORE_PRIMARY',
    ]);
    expect(second.entries).toEqual(first.entries);
  });

  it('still resolves fabricated canonical catalog ids even when they have no generation handle', () => {
    const catalog: ChampionInsightEvidenceEntry[] = [
      { id: 'SCOPE_PATCH', interpretationAllowed: true },
      { id: 'CHAMPION_WIN_RATE', interpretationAllowed: false },
    ];
    const mapping = buildEvidenceHandleMapping(catalog);

    expect(resolveEvidenceToken('CHAMPION_WIN_RATE', mapping)).toEqual({
      ok: true,
      id: 'CHAMPION_WIN_RATE',
    });
    expect(resolveEvidenceToken('E2', mapping)).toEqual({
      ok: false,
      reason: 'UNKNOWN_EVIDENCE_HANDLE',
      handle: 'E2',
    });
  });

  it('keeps CHAMPION_WIN_RATE in the internal catalog without a generation handle when performance is INSUFFICIENT', () => {
    const context = buildChampionInsightContext(
      input({
        stats: { ...metrics(), sampleConfidence: 'INSUFFICIENT', sampleSize: 8, wins: 3, winRate: 0.375 },
      }),
    );
    const mapping = generationHandles(context);

    expect(context.evidenceCatalog.some((entry) => entry.id === 'CHAMPION_WIN_RATE')).toBe(true);
    expect(
      context.evidenceCatalog.find((entry) => entry.id === 'CHAMPION_WIN_RATE')?.interpretationAllowed,
    ).toBe(false);
    expect(mapping.idToHandle.get('CHAMPION_WIN_RATE')).toBeUndefined();
    expect(mapping.idToHandle.get('CHAMPION_SAMPLE_SIZE')).toBeUndefined();
    expect(mapping.idToHandle.get('CHAMPION_SAMPLE_CONFIDENCE')).toBeUndefined();
    expect(mapping.idToHandle.get('CONFIDENCE_WARNING')).toMatch(/^E\d+$/);
    expect(mapping.idToHandle.get('SCOPE_PATCH')).toMatch(/^E\d+$/);

    const payload = buildChampionInsightGenerationPayload(context);
    expect(payload.performance.evidenceHandles).toEqual([]);
    expect(payload.outputPolicy.performanceConclusionsAllowed).toBe(false);
    expect(JSON.stringify(payload.evidence)).not.toMatch(/CHAMPION_WIN_RATE/);
  });

  it('keeps a low-sample matchup internally but omits it from generation candidates and handles', () => {
    const context = buildChampionInsightContext(
      input({
        matchups: {
          strongAgainst: [
            matchup('Neeko', 'Neeko', {
              championId: 518,
              lowSample: true,
              sampleConfidence: 'INSUFFICIENT',
              sampleSize: 6,
            }),
          ],
          weakAgainst: [],
        },
        opponentAbilities: [
          {
            championKey: 'Neeko',
            abilities: [
              ability('E', 'Tangle-Barbs', 'Neeko roots enemies in a line with tangled vines.'),
            ],
          },
        ],
      }),
    );
    const mapping = generationHandles(context);
    const payload = buildChampionInsightGenerationPayload(context);

    expect(context.matchups.strongAgainst[0]?.opponentChampionKey).toBe('Neeko');
    expect(context.matchups.strongAgainst[0]?.interpretationAllowed).toBe(false);
    expect(context.evidenceCatalog.some((entry) => entry.id === 'MATCHUP_STRONG_Neeko')).toBe(true);
    expect(mapping.idToHandle.get('MATCHUP_STRONG_Neeko')).toBeUndefined();
    expect(mapping.idToHandle.get('ABILITY_Neeko_E')).toBeUndefined();
    expect(payload.matchupCandidates.strongAgainst).toEqual([]);
    expect(payload.matchupCandidates.weakAgainst).toEqual([]);
    expect(payload.outputPolicy.allowedMatchupOpponentKeys).toEqual([]);
    expect(payload.opponentAbilities).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('Neeko');
  });

  it('keeps an exploratory build internally without a generation statistical handle', () => {
    const context = buildChampionInsightContext(
      input({
        builds: {
          coreBuilds: [coreBuild('EXPLORATORY')],
          startingItems: [],
          boots: [],
          runes: [],
          summonerSpells: [],
          skillOrder: [],
        },
        matchups: { strongAgainst: [], weakAgainst: [] },
      }),
    );
    const mapping = generationHandles(context);
    const payload = buildChampionInsightGenerationPayload(context);

    expect(context.builds.coreBuilds[0]?.sampleBand).toBe('EXPLORATORY');
    expect(context.builds.coreBuilds[0]?.interpretationAllowed).toBe(false);
    expect(context.evidenceCatalog.some((entry) => entry.id === 'BUILD_CORE_PRIMARY')).toBe(true);
    expect(mapping.idToHandle.get('BUILD_CORE_PRIMARY')).toBeUndefined();
    expect(payload.buildInsightAllowed).toBe(false);
    expect(payload.outputPolicy.buildInsightAllowed).toBe(false);
    expect(payload.builds.coreBuilds).toEqual([]);
  });

  it('gives a CREDIBLE build a handle while omitting INSUFFICIENT performance stats from generation evidence', () => {
    const context = buildChampionInsightContext(
      input({
        stats: { ...metrics(), sampleConfidence: 'INSUFFICIENT', sampleSize: 8, wins: 3, winRate: 0.375 },
        matchups: { strongAgainst: [], weakAgainst: [] },
      }),
    );
    const mapping = generationHandles(context);
    const payload = buildChampionInsightGenerationPayload(context);

    expect(context.generationEligible).toBe(true);
    expect(context.performanceConclusionsAllowed).toBe(false);
    expect(context.buildInsightAllowed).toBe(true);
    expect(mapping.idToHandle.get('BUILD_CORE_PRIMARY')).toMatch(/^E\d+$/);
    expect(mapping.idToHandle.get('CHAMPION_WIN_RATE')).toBeUndefined();
    expect(mapping.idToHandle.get('CHAMPION_KDA')).toBeUndefined();
    expect(payload.matchupCandidates.strongAgainst).toEqual([]);
    expect(payload.matchupCandidates.weakAgainst).toEqual([]);
    expect(payload.outputPolicy).toEqual({
      performanceConclusionsAllowed: false,
      buildInsightAllowed: true,
      allowedMatchupOpponentKeys: [],
    });
    expect(payload.builds.coreBuilds[0]?.evidenceHandle).toBe(mapping.idToHandle.get('BUILD_CORE_PRIMARY'));
    expect(payload.evidence.map((entry) => entry.handle)).toEqual(
      mapping.entries.map((entry) => entry.handle),
    );
    expect(payload.evidence.every((entry) => entry.kind !== undefined)).toBe(true);
  });

  it('omits all ability generation handles when no matchup explanation is eligible', () => {
    const context = buildChampionInsightContext(
      input({
        matchups: { strongAgainst: [], weakAgainst: [] },
        opponentAbilities: [
          {
            championKey: 'Syndra',
            abilities: [
              ability('E', 'Scatter the Weak', 'Syndra knocks enemies back with a cone of force.'),
            ],
          },
        ],
      }),
    );
    const mapping = generationHandles(context);
    const payload = buildChampionInsightGenerationPayload(context);

    expect(context.matchupExplanationsAllowed).toBe(false);
    expect(payload.outputPolicy.allowedMatchupOpponentKeys).toEqual([]);
    expect(context.evidenceCatalog.some((entry) => entry.id === 'ABILITY_Ahri_E')).toBe(true);
    expect(mapping.entries.every((entry) => !entry.id.startsWith('ABILITY_'))).toBe(true);
    expect(mapping.idToHandle.get('ABILITY_Ahri_E')).toBeUndefined();
    expect(mapping.idToHandle.get('ABILITY_Syndra_E')).toBeUndefined();
    expect(payload.abilities).toEqual([]);
    expect(payload.opponentAbilities).toEqual([]);
    expect(payload.evidence.every((entry) => entry.kind !== 'ability')).toBe(true);
    expect(JSON.stringify(payload.evidence)).not.toMatch(/ABILITY_/);
  });

  it('exposes subject and eligible-opponent ability handles only for allowed matchups', () => {
    const context = buildChampionInsightContext(
      input({
        matchups: {
          strongAgainst: [matchup('Syndra', 'Syndra')],
          weakAgainst: [
            matchup('Zed', 'Zed', {
              championId: 238,
              lowSample: true,
              sampleConfidence: 'INSUFFICIENT',
              sampleSize: 6,
            }),
          ],
        },
        opponentAbilities: [
          {
            championKey: 'Syndra',
            abilities: [
              ability('E', 'Scatter the Weak', 'Syndra knocks enemies back with a cone of force.'),
            ],
          },
          {
            championKey: 'Zed',
            abilities: [
              ability('R', 'Death Mark', 'Zed marks an enemy and dashes to them after a delay.'),
            ],
          },
          {
            championKey: 'Yasuo',
            abilities: [
              ability('E', 'Sweeping Blade', 'Yasuo dashes through a target.'),
            ],
          },
        ],
      }),
    );
    const mapping = generationHandles(context);
    const payload = buildChampionInsightGenerationPayload(context);

    expect(context.evidenceCatalog.some((entry) => entry.id === 'MATCHUP_STRONG_Syndra')).toBe(true);
    expect(payload.outputPolicy.allowedMatchupOpponentKeys).toEqual(['Syndra']);
    expect(mapping.idToHandle.get('MATCHUP_STRONG_Syndra')).toMatch(/^E\d+$/);
    expect(mapping.idToHandle.get('ABILITY_Ahri_E')).toMatch(/^E\d+$/);
    expect(mapping.idToHandle.get('ABILITY_Syndra_E')).toMatch(/^E\d+$/);
    expect(mapping.idToHandle.get('ABILITY_Zed_R')).toBeUndefined();
    expect(mapping.idToHandle.get('ABILITY_Yasuo_E')).toBeUndefined();
    expect(payload.abilities.some((ability) => ability.slot === 'E')).toBe(true);
    expect(payload.opponentAbilities.map((group) => group.championKey)).toEqual(['Syndra']);
    expect(JSON.stringify(payload)).not.toContain('Zed');
    expect(JSON.stringify(payload)).not.toContain('Yasuo');
  });
});
