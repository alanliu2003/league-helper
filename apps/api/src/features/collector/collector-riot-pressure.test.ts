import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import {
  deriveSoftLongWindow,
  evaluateCollectorRiotPressure,
  loadCollectorRiotPressureConfig,
  type CollectorRiotPressureConfig,
} from './collector-riot-pressure';

function baseConfig(
  overrides: Partial<CollectorRiotPressureConfig> = {},
): CollectorRiotPressureConfig {
  return {
    effectiveLongBudget: 75,
    longLimit: 100,
    utilization: 0.75,
    softLongSafetyMargin: 4,
    softLongWindow: 71,
    hardLongWindow: 85,
    softEnrichPending: 40,
    hardEnrichPending: 120,
    longSoftMinEnrichPending: 1,
    softWaitMs: 15_000,
    hardWaitMs: 25_000,
    cooldownWaitMs: 20_000,
    ...overrides,
  };
}

describe('deriveSoftLongWindow / loadCollectorRiotPressureConfig', () => {
  it('derives soft gate from longLimit * utilization - safety margin (default 71)', () => {
    expect(
      deriveSoftLongWindow({
        longLimit: 100,
        utilization: 0.75,
        softLongSafetyMargin: 4,
        hardLongWindow: 85,
      }),
    ).toBe(71);

    const config = loadCollectorRiotPressureConfig({});
    expect(config.effectiveLongBudget).toBe(75);
    expect(config.softLongWindow).toBe(71);
    expect(config.hardLongWindow).toBe(85);
    expect(config.utilization).toBe(0.75);
    expect(config.softLongWindow).toBeLessThan(config.effectiveLongBudget);
    expect(config.softLongWindow).toBeLessThan(config.hardLongWindow);
  });

  it('honors operator safety-margin override and rejects enrich threshold inversion', () => {
    const tuned = loadCollectorRiotPressureConfig({
      COLLECTOR_RIOT_PRESSURE_SOFT_LONG_SAFETY_MARGIN: '5',
    });
    expect(tuned.softLongWindow).toBe(70);

    // Soft long is clamped below hard even when margin would otherwise overshoot.
    expect(
      deriveSoftLongWindow({
        longLimit: 100,
        utilization: 0.75,
        softLongSafetyMargin: 0,
        hardLongWindow: 60,
      }),
    ).toBe(59);

    expect(() =>
      loadCollectorRiotPressureConfig({
        COLLECTOR_RIOT_PRESSURE_SOFT_ENRICH_PENDING: '120',
        COLLECTOR_RIOT_PRESSURE_HARD_ENRICH_PENDING: '120',
      }),
    ).toThrow(ValidationFailureError);
  });

  it('does not weaken product reserve or utilization defaults via pressure config', () => {
    const config = loadCollectorRiotPressureConfig({});
    expect(config.utilization).toBe(0.75);
    // Pressure loader reuses shared budget config; product reserve stays on that module.
    expect(config.softLongWindow).toBe(71);
  });
});

describe('evaluateCollectorRiotPressure', () => {
  it('proceeds below soft threshold', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 54,
        enrichPending: 0,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({ action: 'proceed', reason: 'clear', waitMs: 0 });
  });

  it('proceeds between old 55 and new soft threshold when enrichPending=0', () => {
    for (const longWin of [56, 60, 70, 71]) {
      const decision = evaluateCollectorRiotPressure(
        {
          sharedCooldownActive: false,
          longWindowMembers: longWin,
          enrichPending: 0,
        },
        baseConfig(),
      );
      expect(decision.action, `longWin=${longWin}`).toBe('proceed');
    }
  });

  it('soft-waits near soft threshold when enrichment pressure is meaningful', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 72,
        enrichPending: 12,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({
      action: 'wait',
      reason: 'soft_pressure',
      waitMs: 15_000,
    });
    if (decision.action === 'wait') {
      expect(decision.detail.softLongTriggered).toBe(true);
      expect(decision.detail.softEnrichTriggered).toBe(false);
    }
  });

  it('soft-waits on enrichment backlog alone even when longWin is low', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 30,
        enrichPending: 45,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({ action: 'wait', reason: 'soft_pressure' });
    if (decision.action === 'wait') {
      expect(decision.detail.softEnrichTriggered).toBe(true);
      expect(decision.detail.softLongTriggered).toBe(false);
    }
  });

  it('does not soft-wait solely on longWin when enrichPending=0 above soft', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 74,
        enrichPending: 0,
      },
      baseConfig(),
    );
    expect(decision.action).toBe('proceed');
  });

  it('hard-waits above hard long threshold', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 85,
        enrichPending: 0,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({
      action: 'wait',
      reason: 'hard_pressure',
      waitMs: 25_000,
    });
  });

  it('hard-waits on enrichment hard threshold', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 10,
        enrichPending: 120,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({ action: 'wait', reason: 'hard_pressure' });
  });

  it('defers on active shared cooldown', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: true,
        longWindowMembers: 10,
        enrichPending: 0,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({
      action: 'wait',
      reason: 'shared_cooldown',
      waitMs: 20_000,
    });
  });

  it('uses budget suggested waitMs when waiting (no busy-spin)', () => {
    const decision = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 90,
        enrichPending: 0,
        budgetSuggestedWaitMs: 32_000,
      },
      baseConfig(),
    );
    expect(decision).toMatchObject({ action: 'wait', reason: 'hard_pressure', waitMs: 32_000 });

    const tiny = evaluateCollectorRiotPressure(
      {
        sharedCooldownActive: false,
        longWindowMembers: 90,
        enrichPending: 0,
        budgetSuggestedWaitMs: 100,
      },
      baseConfig(),
    );
    expect(tiny.action).toBe('wait');
    expect(tiny.waitMs).toBeGreaterThanOrEqual(5_000);
  });

  it('documents hard gate as pressure heuristic above util ceiling', () => {
    const config = baseConfig();
    expect(config.hardLongWindow).toBeGreaterThan(config.effectiveLongBudget);
    expect(config.softLongWindow).toBeLessThan(config.effectiveLongBudget);
  });
});
