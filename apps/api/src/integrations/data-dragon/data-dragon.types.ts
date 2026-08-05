import { z } from 'zod';

/** Frontend-safe champion metadata resolved from Data Dragon. */
export type DataDragonChampion = {
  /** String champion id / asset key, e.g. "Tryndamere" or "DrMundo". */
  id: string;
  /** Numeric champion key as string, e.g. "23". */
  key: string;
  name: string;
  title: string;
  iconUrl: string;
  /** Default-skin splash CDN URL; null when asset key unavailable. */
  splashUrl: string | null;
};

const DataDragonChampionEntrySchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  title: z.string().min(1),
});

export const DataDragonChampionFileSchema = z.object({
  type: z.string().optional(),
  version: z.string().min(1),
  data: z.record(z.string(), DataDragonChampionEntrySchema),
});

export type DataDragonChampionFile = z.infer<typeof DataDragonChampionFileSchema>;

export const DataDragonVersionsSchema = z.array(z.string().min(1)).min(1);

export const DataDragonRedisCacheSchema = z.object({
  version: z.string().min(1),
  locale: z.string().min(1),
  champions: z.array(
    z.object({
      id: z.string().min(1),
      key: z.string().min(1),
      name: z.string().min(1),
      title: z.string().min(1),
      iconUrl: z.string().url(),
      splashUrl: z.string().url().nullable().optional(),
    }),
  ),
  fetchedAtMs: z.number().int().nonnegative(),
});

export type DataDragonRedisCache = z.infer<typeof DataDragonRedisCacheSchema>;
