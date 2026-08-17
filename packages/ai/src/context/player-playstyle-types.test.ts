import { describe, expect, it } from 'vitest';
import type { PlayerMetricComparison, PlayerPlaystyleMetricId } from '@league-helper/shared';
import { buildPlayerPlaystyleContext } from './player-playstyle-builder';
import {
  PlayerPlaystyleInternalContextSchema,
  type PlayerPlaystyleBuilderInput,
  type PlayerPlaystyleBuilderProfile,
} from './player-playstyle-types';

function allowedRow(metric: PlayerPlaystyleMetricId): PlayerMetricComparison {
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
  };
}

function profile(): PlayerPlaystyleBuilderProfile {
  return {
    windowSize: 20,
    matchesAnalyzed: 12,
    comparableMatchCount: 12,
    wins: 7,
    playerSampleBand: 'CREDIBLE',
    patchRange: { min: '16.14', max: '16.15' },
    mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 8 }],
    overall: { comparisons: [allowedRow('CS_PER_MIN')] },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
        sampleBand: 'CREDIBLE',
        comparisons: [allowedRow('CS_PER_MIN')],
      },
    ],
    skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
  };
}

function input(): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [{ matchId: 'NA1_PRIVACY_MATCH_AAA', participantId: 1 }],
    profile: profile(),
  };
}

describe('PlayerPlaystyleInternalContextSchema', () => {
  it('parses builder output', () => {
    const parsed = PlayerPlaystyleInternalContextSchema.safeParse(
      buildPlayerPlaystyleContext(input()),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a payload missing required context fields', () => {
    expect(PlayerPlaystyleInternalContextSchema.safeParse({}).success).toBe(false);
  });
});
