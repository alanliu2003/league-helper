import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guard: any unmocked fetch to Riot hosts during tests must fail hard.
 * Individual Riot client tests inject mock fetch and never hit this path.
 */
describe('Riot network guard', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.riotgames.com')) {
        throw new Error(`Blocked unmocked Riot network request: ${url}`);
      }
      throw new Error(`Blocked unexpected network request in tests: ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fails if a test attempts an unhandled Riot request', async () => {
    await expect(
      fetch('https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/x'),
    ).rejects.toThrow(/Blocked unmocked Riot network request/);
  });
});
