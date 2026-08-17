import { describe, expect, it } from 'vitest';
import {
  PLAYER_PLAYSTYLE_PROMPT_VERSION as SHARED_PROMPT_VERSION,
  type PlayerMetricComparison,
  type PlayerPlaystyleMetricId,
} from '@league-helper/shared';
import { buildPlayerPlaystyleContext } from '../context/player-playstyle-builder';
import type { PlayerPlaystyleBuilderInput, PlayerPlaystyleBuilderProfile } from '../context/player-playstyle-types';
import {
  PLAYER_PLAYSTYLE_PROMPT_VERSION,
  buildPlayerPlaystyleSystemPrompt,
  buildPlayerPlaystyleUserPrompt,
} from './player-playstyle-v1';

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

function profile(
  overrides: Partial<PlayerPlaystyleBuilderProfile> = {},
): PlayerPlaystyleBuilderProfile {
  return {
    windowSize: 20,
    matchesAnalyzed: 12,
    comparableMatchCount: 12,
    wins: 7,
    playerSampleBand: 'CREDIBLE',
    patchRange: { min: '16.14', max: '16.15' },
    mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 8 }],
    overall: {
      comparisons: [
        allowedRow('CS_PER_MIN'),
        allowedRow('GOLD_PER_MIN'),
        allowedRow('DAMAGE_PER_MIN'),
        allowedRow('KILLS_PER_GAME'),
      ],
    },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
        sampleBand: 'CREDIBLE',
        comparisons: [allowedRow('CS_PER_MIN'), allowedRow('KDA')],
      },
    ],
    skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
    ...overrides,
  };
}

function input(overrides: Partial<PlayerPlaystyleBuilderInput> = {}): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [{ matchId: 'PRIVACY_MATCH_SECRET', participantId: 1 }],
    playerAccountId: 'player-account-uuid-secret',
    profile: profile(),
    ...overrides,
  };
}

describe('player playstyle prompts', () => {
  const context = buildPlayerPlaystyleContext(input());

  it('re-exports the shared prompt version', () => {
    expect(PLAYER_PLAYSTYLE_PROMPT_VERSION).toBe(SHARED_PROMPT_VERSION);
    expect(PLAYER_PLAYSTYLE_PROMPT_VERSION).toBe('player-playstyle-v1');
  });

  it('includes spec §10.6 locked rules', () => {
    const system = buildPlayerPlaystyleSystemPrompt();
    expect(system).toContain('Never invent');
    expect(system).toContain('Never choose ABOVE/NEAR/BELOW');
    expect(system).toContain('live-game');
    expect(system).toContain('personality');
    expect(system).toContain('mixed-role');
    expect(system).toContain('usedAllTierFallback');
    expect(system).toContain('JSON only');
    expect(system).toContain('You are not a source of stats');
    expect(system).toContain('you should');
    expect(system).toContain('outputPolicy');
    expect(system).toContain('economy MUST be null');
    expect(system).toContain('Do not write evidence handles in text fields');
    expect(system).not.toMatch(/sk-[A-Za-z0-9]|api[_-]?key|Bearer /i);
  });

  it('omits matchId and playerAccountId from the user prompt', () => {
    const user = buildPlayerPlaystyleUserPrompt(context);
    expect(user).toContain('E1');
    expect(user).toContain('Citable evidence handles');
    expect(user).toContain('outputPolicy');
    expect(user).not.toContain('PRIVACY_MATCH_SECRET');
    expect(user).not.toContain('matchId');
    expect(user).not.toContain('playerAccountId');
    expect(user).not.toContain('player-account-uuid-secret');
  });
});
