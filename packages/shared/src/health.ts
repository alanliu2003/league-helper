import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createHealthResponse(service: string): HealthResponse {
  return HealthResponseSchema.parse({
    status: 'ok',
    service,
    timestamp: new Date().toISOString(),
  });
}
