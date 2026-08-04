import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
  database: z.enum(['up', 'down']).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createHealthResponse(
  service: string,
  extras?: { database?: 'up' | 'down' },
): HealthResponse {
  return HealthResponseSchema.parse({
    status: 'ok',
    service,
    timestamp: new Date().toISOString(),
    ...(extras?.database ? { database: extras.database } : {}),
  });
}
