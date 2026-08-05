import { Test } from '@nestjs/testing';
import type { GameDataProvider } from '@league-helper/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from '../../health/health.service';
import { RiotModule } from './riot.module';
import { GAME_DATA_PROVIDER, RIOT_CONFIG } from './riot.tokens';
import { MockRiotGameDataProvider } from './mock-riot-game-data.provider';
import { RiotGameDataProvider } from './riot-game-data.provider';
import type { RiotConfig } from './riot.config';

describe('RiotModule DI', () => {
  const previous = {
    mode: process.env.RIOT_PROVIDER_MODE,
    key: process.env.RIOT_API_KEY,
  };

  afterEach(() => {
    if (previous.mode === undefined) {
      delete process.env.RIOT_PROVIDER_MODE;
    } else {
      process.env.RIOT_PROVIDER_MODE = previous.mode;
    }
    if (previous.key === undefined) {
      delete process.env.RIOT_API_KEY;
    } else {
      process.env.RIOT_API_KEY = previous.key;
    }
  });

  it('defaults automated contexts to the mock provider', async () => {
    process.env.RIOT_PROVIDER_MODE = 'mock';
    delete process.env.RIOT_API_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [RiotModule],
    }).compile();

    const provider = moduleRef.get<GameDataProvider>(GAME_DATA_PROVIDER);
    expect(provider).toBeInstanceOf(MockRiotGameDataProvider);
    const config = moduleRef.get<RiotConfig>(RIOT_CONFIG);
    expect(config.providerMode).toBe('mock');
  });

  it('selects the real provider implementation in real mode without calling Riot at init', async () => {
    process.env.RIOT_PROVIDER_MODE = 'real';
    process.env.RIOT_API_KEY = 'test-key-not-used-at-startup';

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const moduleRef = await Test.createTestingModule({
      imports: [RiotModule],
    }).compile();

    const provider = moduleRef.get<GameDataProvider>(GAME_DATA_PROVIDER);
    expect(provider).toBeInstanceOf(RiotGameDataProvider);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('health checks do not invoke Riot', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const health = new HealthService(
      {
        $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as never,
      {
        providerMode: 'mock',
        apiKey: undefined,
        timeoutMs: 10_000,
        maxRetries: 2,
        maxRetryDelayMs: 5_000,
        baseDomain: 'api.riotgames.com',
      },
    );

    await expect(health.getHealth()).resolves.toMatchObject({
      status: 'ok',
      service: 'api',
      providerMode: 'mock',
      providerConfigured: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
