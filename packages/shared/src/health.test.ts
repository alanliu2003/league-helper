import { describe, expect, it } from 'vitest';
import { createHealthResponse, HealthResponseSchema } from './health';

describe('HealthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    const payload = createHealthResponse('api');
    expect(HealthResponseSchema.parse(payload)).toEqual(payload);
    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('api');
  });

  it('rejects an invalid status', () => {
    expect(() =>
      HealthResponseSchema.parse({
        status: 'down',
        service: 'api',
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
