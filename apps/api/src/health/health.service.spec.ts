import { describe, expect, it, vi } from 'vitest';
import { HealthResponseSchema } from '@league-helper/shared';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns a typed ok health response after a DB ping', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const service = new HealthService(prisma as never);
    const result = await service.getHealth();

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(HealthResponseSchema.parse(result).status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.database).toBe('up');
  });
});
