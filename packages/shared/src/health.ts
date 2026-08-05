import { z } from 'zod';

export const ProviderModeSchema = z.enum(['mock', 'real']);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
  database: z.enum(['up', 'down']).optional(),
  /** Development readiness indicator — never makes a live Riot call. */
  providerMode: ProviderModeSchema.optional(),
  /** True when a real-mode API key is present; false for mock or missing key. */
  providerConfigured: z.boolean().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createHealthResponse(
  service: string,
  extras?: {
    database?: 'up' | 'down';
    providerMode?: ProviderMode;
    providerConfigured?: boolean;
  },
): HealthResponse {
  return HealthResponseSchema.parse({
    status: 'ok',
    service,
    timestamp: new Date().toISOString(),
    ...(extras?.database ? { database: extras.database } : {}),
    ...(extras?.providerMode ? { providerMode: extras.providerMode } : {}),
    ...(extras?.providerConfigured !== undefined
      ? { providerConfigured: extras.providerConfigured }
      : {}),
  });
}
