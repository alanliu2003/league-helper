import { z } from 'zod';

const SyncDataDragonImageSchema = z.object({
  full: z.string().optional(),
});

const SyncDataDragonPassiveSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  image: SyncDataDragonImageSchema.optional(),
});

const SyncDataDragonSpellSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  cooldownBurn: z.string().optional(),
  costBurn: z.string().optional(),
  rangeBurn: z.string().optional(),
  image: SyncDataDragonImageSchema.optional(),
});

export const SyncDataDragonChampionEntrySchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  image: z.record(z.unknown()).optional(),
  stats: z.record(z.unknown()).optional(),
  passive: SyncDataDragonPassiveSchema.optional(),
  spells: z.array(SyncDataDragonSpellSchema).optional(),
});

export const SyncDataDragonChampionFileSchema = z.object({
  type: z.string().optional(),
  version: z.string().min(1),
  data: z
    .record(z.string(), SyncDataDragonChampionEntrySchema)
    .refine((data) => Object.keys(data).length > 0, { message: 'champion data must not be empty' }),
});

export type SyncDataDragonChampionEntry = z.infer<typeof SyncDataDragonChampionEntrySchema>;
export type SyncDataDragonChampionFile = z.infer<typeof SyncDataDragonChampionFileSchema>;

export function parseChampionStaticFile(input: unknown): SyncDataDragonChampionFile {
  return SyncDataDragonChampionFileSchema.parse(input);
}

export type MappedChampionStaticRow = {
  championId: number;
  championKey: string;
  name: string;
  title: string;
  tags: string[];
  baseStats: Record<string, unknown>;
  passive: Record<string, unknown>;
  spells: unknown[];
  imageData: Record<string, unknown>;
};
