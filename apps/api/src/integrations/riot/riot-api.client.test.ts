import { describe, expect, it, vi } from 'vitest';
import {
  ProviderForbiddenError,
  ProviderNotConfiguredError,
  ProviderRateLimitedError,
  ProviderResponseInvalidError,
  ProviderUnauthorizedError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  UnsupportedPlatformRouteError,
  ValidationFailureError,
} from '@league-helper/shared';
import { z } from 'zod';
import { RiotApiClient } from './riot-api.client';
import { mockAccountDto, mockHttpErrorBodies } from './fixtures';
import { createMockFetch, realConfigOverrides } from './test-utils/mock-fetch';
import { RiotAccountDtoSchema } from './riot-api.schemas';

describe('RiotApiClient', () => {
  it('builds regional hosts for account-v1 and platform hosts for summoner-v4', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: mockAccountDto() },
      { status: 200, body: mockAccountDto() },
    ]);
    const client = RiotApiClient.create(realConfigOverrides(), {
      fetchFn,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    await client.requestJson(
      {
        category: 'account-v1',
        route: { kind: 'regional', regionalRoute: 'americas' },
        path: `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent('Example Player')}/${encodeURIComponent('NA1')}`,
      },
      RiotAccountDtoSchema,
    );

    await client.requestJson(
      {
        category: 'summoner-v4',
        route: { kind: 'platform', platform: 'na1' },
        path: `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent('fake-puuid')}`,
      },
      RiotAccountDtoSchema,
    );

    expect(calls[0]?.url).toContain('https://americas.api.riotgames.com/');
    expect(calls[0]?.url).toContain('Example%20Player');
    expect(calls[1]?.url).toContain('https://na1.api.riotgames.com/');
  });

  it('adds X-Riot-Token server-side and never leaks the key in errors or logs', async () => {
    const apiKey = 'super-secret-riot-key-value';
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      setContext: vi.fn(),
      localInstance: undefined,
    } as unknown as import('@nestjs/common').Logger;

    const { fetchFn, calls } = createMockFetch([
      { status: 403, body: mockHttpErrorBodies()['403'] },
    ]);
    const client = RiotApiClient.create(realConfigOverrides({ apiKey }), {
      fetchFn,
      logger,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    await expect(
      client.requestJson(
        {
          category: 'account-v1',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
        },
        RiotAccountDtoSchema,
      ),
    ).rejects.toBeInstanceOf(ProviderForbiddenError);

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('X-Riot-Token')).toBe(apiKey);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(apiKey);
  });

  it('throws ProviderNotConfigured only when invoked without a key in real mode', async () => {
    const client = RiotApiClient.create(realConfigOverrides({ apiKey: undefined }));
    await expect(
      client.requestJson(
        {
          category: 'account-v1',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
        },
        RiotAccountDtoSchema,
      ),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('rejects unsupported routes before any HTTP request', async () => {
    const { fetchFn, calls } = createMockFetch([]);
    const client = RiotApiClient.create(realConfigOverrides(), { fetchFn });

    expect(() =>
      client.buildHost({
        category: 'summoner-v4',
        route: { kind: 'platform', platform: 'cn1' as never },
        path: '/x',
      }),
    ).toThrow(UnsupportedPlatformRouteError);
    expect(calls).toHaveLength(0);
  });

  it('maps 400/401/403/404 without retry', async () => {
    for (const [status, ErrorType] of [
      [400, ValidationFailureError],
      [401, ProviderUnauthorizedError],
      [403, ProviderForbiddenError],
      [404, ResourceNotFoundError],
    ] as const) {
      let hits = 0;
      const { fetchFn } = createMockFetch([
        () => {
          hits += 1;
          return { status, body: mockHttpErrorBodies()[String(status)] };
        },
      ]);
      const client = RiotApiClient.create(realConfigOverrides({ maxRetries: 2 }), {
        fetchFn,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      });

      await expect(
        client.requestJson(
          {
            category: 'account-v1',
            route: { kind: 'regional', regionalRoute: 'americas' },
            path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
            resourceHint: 'account',
          },
          RiotAccountDtoSchema,
        ),
      ).rejects.toBeInstanceOf(ErrorType);
      expect(hits).toBe(1);
    }
  });

  it('preserves Retry-After on 429 even without X-Rate-Limit-Type', async () => {
    const { fetchFn } = createMockFetch([
      {
        status: 429,
        body: mockHttpErrorBodies()['429'],
        headers: { 'retry-after': '7' },
      },
    ]);
    const client = RiotApiClient.create(realConfigOverrides(), {
      fetchFn,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    try {
      await client.requestJson(
        {
          category: 'match-v5',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/lol/match/v5/matches/by-puuid/fake/ids',
        },
        z.array(z.string()),
      );
      expect.fail('expected rate limit error');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ProviderRateLimitedError);
      const details = (error as ProviderRateLimitedError).details as {
        retryAfterSeconds: number | null;
        rateLimitType: string | null;
      };
      expect(details.retryAfterSeconds).toBe(7);
      expect(details.rateLimitType).toBeNull();
    }
  });

  it('retries bounded 5xx then succeeds', async () => {
    const sleepCalls: number[] = [];
    const { fetchFn, calls } = createMockFetch([
      { status: 500, body: mockHttpErrorBodies()['500'] },
      { status: 200, body: mockAccountDto() },
    ]);
    const client = RiotApiClient.create(realConfigOverrides({ maxRetries: 2 }), {
      fetchFn,
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
      randomFn: () => 0,
    });

    const result = await client.requestJson(
      {
        category: 'account-v1',
        route: { kind: 'regional', regionalRoute: 'americas' },
        path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
      },
      RiotAccountDtoSchema,
    );

    expect(result.data.puuid).toBe(mockAccountDto().puuid);
    expect(calls).toHaveLength(2);
    expect(sleepCalls).toHaveLength(1);
  });

  it('maps persistent 5xx and timeouts to ProviderUnavailable', async () => {
    const { fetchFn: fetch503 } = createMockFetch([
      { status: 503, body: mockHttpErrorBodies()['503'] },
      { status: 503, body: mockHttpErrorBodies()['503'] },
      { status: 503, body: mockHttpErrorBodies()['503'] },
    ]);
    const client503 = RiotApiClient.create(realConfigOverrides({ maxRetries: 2 }), {
      fetchFn: fetch503,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    await expect(
      client503.requestJson(
        {
          category: 'account-v1',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
        },
        RiotAccountDtoSchema,
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    const { fetchFn: fetchTimeout } = createMockFetch([{ status: 0 }]);
    const clientTimeout = RiotApiClient.create(realConfigOverrides({ maxRetries: 0 }), {
      fetchFn: fetchTimeout,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    await expect(
      clientTimeout.requestJson(
        {
          category: 'account-v1',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
        },
        RiotAccountDtoSchema,
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      details: expect.objectContaining({ reason: 'timeout' }),
    });
  });

  it('maps malformed HTTP 200 bodies to ProviderResponseInvalidError', async () => {
    const { fetchFn } = createMockFetch([
      { status: 200, body: mockHttpErrorBodies().malformed200 },
    ]);
    const client = RiotApiClient.create(realConfigOverrides(), {
      fetchFn,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    await expect(
      client.requestJson(
        {
          category: 'account-v1',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
        },
        RiotAccountDtoSchema,
      ),
    ).rejects.toBeInstanceOf(ProviderResponseInvalidError);
  });

  it('does not crash when non-200 bodies are malformed', async () => {
    const { fetchFn } = createMockFetch([{ status: 404, textBody: '<html>nope</html>' }]);
    const client = RiotApiClient.create(realConfigOverrides(), {
      fetchFn,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });

    await expect(
      client.requestJson(
        {
          category: 'account-v1',
          route: { kind: 'regional', regionalRoute: 'americas' },
          path: '/riot/account/v1/accounts/by-riot-id/Example/NA1',
          resourceHint: 'account',
        },
        RiotAccountDtoSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
