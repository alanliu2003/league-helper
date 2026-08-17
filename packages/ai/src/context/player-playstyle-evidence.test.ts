import { describe, expect, it } from 'vitest';
import type { PlayerMetricComparison, PlayerPlaystyleMetricId } from '@league-helper/shared';
import { EVIDENCE_HANDLE_PATTERN } from './evidence-handles';
import { buildPlayerPlaystyleContext } from './player-playstyle-builder';
import {
  buildPlayerPlaystyleEvidenceHandleMapping,
  buildPlayerPlaystyleGenerationPayload,
} from './player-playstyle-evidence';
import type { PlayerPlaystyleBuilderInput, PlayerPlaystyleBuilderProfile } from './player-playstyle-types';

function allowedRow(
  metric: PlayerPlaystyleMetricId,
  overrides: Partial<PlayerMetricComparison> = {},
): PlayerMetricComparison {
  return {
    metric,
    playerValue: null,
    baseline: {
      value: null,
      sampleSize: 800,
      sampleConfidence: 'HIGH',
      rankTier: 'GOLD',
      usedAllTierFallback: false,
    },
    delta: 1.1,
    comparableMatchCount: 12,
    direction: 'ABOVE_BASELINE',
    interpretationAllowed: true,
    ...overrides,
  };
}

function disallowedRow(metric: PlayerPlaystyleMetricId): PlayerMetricComparison {
  return {
    metric,
    playerValue: null,
    baseline: null,
    delta: null,
    comparableMatchCount: 2,
    direction: 'NOT_COMPARABLE',
    interpretationAllowed: false,
  };
}

function profile(overrides: Partial<PlayerPlaystyleBuilderProfile> = {}): PlayerPlaystyleBuilderProfile {
  return {
    windowSize: 20,
    matchesAnalyzed: 12,
    comparableMatchCount: 12,
    wins: 7,
    playerSampleBand: 'CREDIBLE',
    patchRange: { min: '16.14', max: '16.15' },
    mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 12 }],
    overall: {
      comparisons: [
        allowedRow('CS_PER_MIN'),
        allowedRow('GOLD_PER_MIN'),
        disallowedRow('DAMAGE_PER_MIN'),
        allowedRow('VISION_PER_MIN'),
        allowedRow('KILLS_PER_GAME'),
        allowedRow('DEATHS_PER_GAME'),
        allowedRow('ASSISTS_PER_GAME'),
        allowedRow('GOLD_DIFF_AT_10'),
        allowedRow('GOLD_DIFF_AT_15'),
        allowedRow('CS_DIFF_AT_10'),
        allowedRow('CS_DIFF_AT_15'),
      ],
    },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 12,
        sampleBand: 'CREDIBLE',
        comparisons: [
          allowedRow('CS_PER_MIN'),
          allowedRow('KDA'),
          disallowedRow('VISION_PER_MIN'),
        ],
      },
    ],
    skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
    ...overrides,
  };
}

function input(overrides: Partial<PlayerPlaystyleBuilderInput> = {}): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [{ matchId: 'NA1_1', participantId: 1 }],
    profile: profile(),
    ...overrides,
  };
}

describe('player playstyle evidence catalog', () => {
  it('never includes OVERALL_KDA even if a KDA overall comparison is present', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        profile: profile({
          overall: { comparisons: [allowedRow('KDA'), allowedRow('CS_PER_MIN')] },
        }),
      }),
    );

    expect(context.evidenceCatalog.some((entry) => entry.id === 'OVERALL_KDA')).toBe(false);
    expect(context.evidenceCatalog.some((entry) => entry.id === 'OVERALL_CS_PER_MIN')).toBe(true);
  });

  it('includes SLICE_Ahri_MIDDLE_KDA when that slice KDA comparison exists, even if disallowed', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        profile: profile({
          championSlices: [
            {
              championKey: 'Ahri',
              championName: 'Ahri',
              position: 'MIDDLE',
              matchCount: 4,
              sampleBand: 'INSUFFICIENT',
              comparisons: [disallowedRow('KDA'), allowedRow('CS_PER_MIN')],
            },
          ],
        }),
      }),
    );

    expect(context.evidenceCatalog.some((entry) => entry.id === 'SLICE_Ahri_MIDDLE_KDA')).toBe(true);
    expect(
      context.evidenceCatalog.find((entry) => entry.id === 'SLICE_Ahri_MIDDLE_KDA')?.interpretationAllowed,
    ).toBe(false);
    expect(context.evidenceCatalog.some((entry) => entry.id === 'SLICE_Ahri_MIDDLE_CS_PER_MIN')).toBe(
      true,
    );
  });

  it('includes OVERALL_GOLD_PER_MIN when that overall comparison is present', () => {
    const allowed = buildPlayerPlaystyleContext(input());
    const disallowed = buildPlayerPlaystyleContext(
      input({
        profile: profile({
          overall: { comparisons: [disallowedRow('GOLD_PER_MIN')] },
          championSlices: [],
        }),
      }),
    );
    const allowedMapping = buildPlayerPlaystyleEvidenceHandleMapping(allowed.evidenceCatalog);
    const disallowedMapping = buildPlayerPlaystyleEvidenceHandleMapping(disallowed.evidenceCatalog);

    expect(allowed.evidenceCatalog.some((entry) => entry.id === 'OVERALL_GOLD_PER_MIN')).toBe(true);
    expect(disallowed.evidenceCatalog.some((entry) => entry.id === 'OVERALL_GOLD_PER_MIN')).toBe(true);
    expect(allowedMapping.idToHandle.get('OVERALL_GOLD_PER_MIN')).toMatch(EVIDENCE_HANDLE_PATTERN);
    expect(disallowedMapping.idToHandle.get('OVERALL_GOLD_PER_MIN')).toBeUndefined();
  });

  it('assigns E* handles only to interpretationAllowed catalog entries', () => {
    const context = buildPlayerPlaystyleContext(input());
    const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);
    const payload = buildPlayerPlaystyleGenerationPayload(context);

    expect(mapping.idToHandle.get('SCOPE_QUEUE')).toBe('E1');
    expect(mapping.idToHandle.get('SCOPE_PATCH_RANGE')).toBe('E2');
    expect(mapping.idToHandle.get('SCOPE_MIX')).toBe('E3');
    expect(mapping.idToHandle.get('OVERALL_DAMAGE_PER_MIN')).toBeUndefined();
    expect(mapping.idToHandle.get('SLICE_Ahri_MIDDLE_VISION_PER_MIN')).toBeUndefined();
    expect(mapping.idToHandle.get('SLICE_Ahri_MIDDLE_CS_PER_MIN')).toMatch(EVIDENCE_HANDLE_PATTERN);
    expect(payload.evidence.every((entry) => EVIDENCE_HANDLE_PATTERN.test(entry.handle))).toBe(true);
    expect(payload.evidence.map((entry) => entry.handle)).toEqual(
      mapping.entries.map((entry) => entry.handle),
    );
    expect(JSON.stringify(payload.evidence)).not.toContain('OVERALL_DAMAGE_PER_MIN');
    expect(JSON.stringify(payload.evidence)).not.toContain('canonicalId');
  });

  it('uses championKey and position in slice evidence ids', () => {
    const context = buildPlayerPlaystyleContext(input());

    expect(context.evidenceCatalog.some((entry) => entry.id === 'SLICE_Ahri_MIDDLE_CS_PER_MIN')).toBe(
      true,
    );
    expect(context.evidenceCatalog.some((entry) => entry.id === 'SLICE_Ahri_MIDDLE_KDA')).toBe(true);
  });

  it('marks SCOPE_* as always citable', () => {
    const context = buildPlayerPlaystyleContext(input());
    const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);

    for (const id of ['SCOPE_QUEUE', 'SCOPE_PATCH_RANGE', 'SCOPE_MIX'] as const) {
      expect(context.evidenceCatalog.find((entry) => entry.id === id)).toEqual({
        id,
        interpretationAllowed: true,
      });
      expect(mapping.idToHandle.get(id)).toMatch(EVIDENCE_HANDLE_PATTERN);
    }
  });
});
