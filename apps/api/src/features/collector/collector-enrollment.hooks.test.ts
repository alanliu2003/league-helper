import { describe, expect, it, vi } from 'vitest';
import {
  maybeEnrollFromBootstrap,
  maybeEnrollFromSearch,
} from './collector-enrollment.hooks';
import type { CollectorEnrollmentResult } from './collector.types';

const account = {
  id: 'acc-1',
  provider: 'RIOT',
  platformRoute: 'na1',
};

describe('maybeEnrollFromSearch', () => {
  it('short-circuits when disabled without calling enroll', async () => {
    const enroll = vi.fn();
    const warn = vi.fn();

    await maybeEnrollFromSearch({
      enabled: false,
      enroll,
      account,
      warn,
    });

    expect(enroll).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('enrolls with PRODUCT_SEARCH when enabled', async () => {
    const enroll = vi.fn(async () => ({
      ok: true,
      trackedPlayerId: 'tp-1',
      playerAccountId: account.id,
      status: 'ACTIVE',
      enrollmentSource: 'PRODUCT_SEARCH',
      created: true,
      reactivated: false,
      platformRoute: 'na1',
    }) satisfies CollectorEnrollmentResult);
    const warn = vi.fn();

    await maybeEnrollFromSearch({
      enabled: true,
      enroll,
      account,
      warn,
    });

    expect(enroll).toHaveBeenCalledWith({
      account,
      source: 'PRODUCT_SEARCH',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns on unsupported platform without throwing', async () => {
    const enroll = vi.fn(async () => ({
      ok: false,
      playerAccountId: account.id,
      code: 'UNSUPPORTED_PLATFORM',
      message: 'Platform kr is outside allowlist.',
      platformRoute: 'kr',
    }) satisfies CollectorEnrollmentResult);
    const warn = vi.fn();

    await expect(
      maybeEnrollFromSearch({
        enabled: true,
        enroll,
        account: { ...account, platformRoute: 'kr' },
        warn,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Collector search enrollment skipped',
        code: 'UNSUPPORTED_PLATFORM',
        playerAccountId: account.id,
        platformRoute: 'kr',
      }),
    );
  });

  it('warns on enroll throw without rethrowing', async () => {
    const enroll = vi.fn(async () => {
      throw new Error('db down');
    });
    const warn = vi.fn();

    await expect(
      maybeEnrollFromSearch({
        enabled: true,
        enroll,
        account,
        warn,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Collector search enrollment failed',
        playerAccountId: account.id,
        error: 'db down',
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/puuid/i);
  });
});

describe('maybeEnrollFromBootstrap', () => {
  it('short-circuits when disabled without calling enroll', async () => {
    const enroll = vi.fn();
    const warn = vi.fn();

    await maybeEnrollFromBootstrap({
      enabled: false,
      enroll,
      account,
      warn,
    });

    expect(enroll).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('enrolls with BOOTSTRAP when enabled', async () => {
    const enroll = vi.fn(async () => ({
      ok: true,
      trackedPlayerId: 'tp-1',
      playerAccountId: account.id,
      status: 'ACTIVE',
      enrollmentSource: 'BOOTSTRAP',
      created: true,
      reactivated: false,
      platformRoute: 'na1',
    }) satisfies CollectorEnrollmentResult);
    const warn = vi.fn();

    await maybeEnrollFromBootstrap({
      enabled: true,
      enroll,
      account,
      warn,
    });

    expect(enroll).toHaveBeenCalledWith({
      account,
      source: 'BOOTSTRAP',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns on unsupported platform without throwing', async () => {
    const enroll = vi.fn(async () => ({
      ok: false,
      playerAccountId: account.id,
      code: 'UNSUPPORTED_PLATFORM',
      message: 'unsupported',
      platformRoute: 'kr',
    }) satisfies CollectorEnrollmentResult);
    const warn = vi.fn();

    await expect(
      maybeEnrollFromBootstrap({
        enabled: true,
        enroll,
        account,
        warn,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Collector bootstrap enrollment skipped',
        code: 'UNSUPPORTED_PLATFORM',
      }),
    );
  });

  it('warns on enroll throw without rethrowing', async () => {
    const enroll = vi.fn(async () => {
      throw new Error('boom');
    });
    const warn = vi.fn();

    await expect(
      maybeEnrollFromBootstrap({
        enabled: true,
        enroll,
        account,
        warn,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Collector bootstrap enrollment failed',
        playerAccountId: account.id,
        error: 'boom',
      }),
    );
  });
});
