import { z } from 'zod';

/** Provider-neutral identifier. Additional providers can be added without reshaping public models. */
export const ProviderIdSchema = z.enum(['RIOT']);

export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const PROVIDER_IDS = ProviderIdSchema.options;
