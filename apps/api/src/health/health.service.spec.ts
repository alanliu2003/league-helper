import { describe, expect, it, vi } from 'vitest';
import { HealthResponseSchema } from '@league-helper/shared';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns a typed ok health response after a DB ping', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const riotConfig = {
      providerMode: 'mock' as const,
      apiKey: undefined,
      timeoutMs: 10_000,
      maxRetries: 2,
      maxRetryDelayMs: 5_000,
      baseDomain: 'api.riotgames.com',
    };
    const service = new HealthService(prisma as never, riotConfig);
    const result = await service.getHealth();

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(HealthResponseSchema.parse(result).status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.database).toBe('up');
    expect(result.providerMode).toBe('mock');
    expect(result.providerConfigured).toBe(true);
  });
});
