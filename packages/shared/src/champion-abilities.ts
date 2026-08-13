import {
  ChampionAbilitySummarySchema,
  type ChampionAbilitySlot,
  type ChampionAbilitySummary,
} from './champion-api';

export const ABILITY_SLOTS = [
  'PASSIVE',
  'Q',
  'W',
  'E',
  'R',
] as const satisfies readonly ChampionAbilitySlot[];

const SPELL_SLOTS = ['Q', 'W', 'E', 'R'] as const satisfies readonly ChampionAbilitySlot[];

const SLOT_FALLBACK_NAME: Record<ChampionAbilitySlot, string> = {
  PASSIVE: 'Passive',
  Q: 'Q',
  W: 'W',
  E: 'E',
  R: 'R',
};

export type StoredChampionPassive = {
  name?: string;
  description?: string;
  imageFull?: string | null;
};

export type StoredChampionSpell = {
  name?: string;
  description?: string;
  imageFull?: string | null;
  cooldownBurn?: string | null;
  costBurn?: string | null;
  rangeBurn?: string | null;
};

export type StoredChampionAbilities = {
  passive: StoredChampionPassive;
  spells: StoredChampionSpell[];
};

export type AbilityIconUrlBuilders = {
  version: string | null;
  buildPassiveIconUrl: (imageFull: string, version: string) => string | null;
  buildSpellIconUrl: (imageFull: string, version: string) => string | null;
};

const HTML_TAG = /<[^>]+>/g;
const BR_TAG = /<br\s*\/?>/gi;
const TEMPLATE_MARKER = /\{\{[^}]*\}\}/g;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** Plain-text ability copy: no HTML, no template markers, no invented numbers. */
export function normalizeAbilityDescription(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  let text = raw.replace(BR_TAG, '\n');
  text = text.replace(HTML_TAG, '');
  text = decodeBasicEntities(text);
  text = text.replace(TEMPLATE_MARKER, '');
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/[ \t]*\n[ \t]*/g, '\n');
  return text.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function imageFullFrom(value: unknown): string | null {
  const direct = optionalString(value);
  if (direct) {
    return direct;
  }
  const image = asRecord(value);
  if (!image) {
    return null;
  }
  return optionalString(image.full) ?? null;
}

function snapshotPassive(raw: unknown): StoredChampionPassive {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }
  const name = optionalString(record.name);
  const description = typeof record.description === 'string' ? record.description : undefined;
  const imageFull = imageFullFrom(record.imageFull) ?? imageFullFrom(record.image) ?? null;
  const snapshot: StoredChampionPassive = {};
  if (name) {
    snapshot.name = name;
  }
  if (description !== undefined) {
    snapshot.description = description;
  }
  if (imageFull) {
    snapshot.imageFull = imageFull;
  }
  return snapshot;
}

function snapshotSpell(raw: unknown): StoredChampionSpell {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }
  const snapshot: StoredChampionSpell = {};
  const name = optionalString(record.name);
  if (name) {
    snapshot.name = name;
  }
  if (typeof record.description === 'string') {
    snapshot.description = record.description;
  }
  const imageFull = imageFullFrom(record.imageFull) ?? imageFullFrom(record.image);
  if (imageFull) {
    snapshot.imageFull = imageFull;
  }
  const cooldownBurn = optionalString(record.cooldownBurn);
  if (cooldownBurn) {
    snapshot.cooldownBurn = cooldownBurn;
  }
  const costBurn = optionalString(record.costBurn);
  if (costBurn) {
    snapshot.costBurn = costBurn;
  }
  const rangeBurn = optionalString(record.rangeBurn);
  if (rangeBurn) {
    snapshot.rangeBurn = rangeBurn;
  }
  return snapshot;
}

function hasStoredContent(passive: StoredChampionPassive, spells: StoredChampionSpell[]): boolean {
  if (passive.name || passive.description || passive.imageFull) {
    return true;
  }
  return spells.some((spell) => spell.name || spell.description || spell.imageFull);
}

/**
 * Trim Data Dragon champion-detail ability fields into a persistable snapshot.
 * Does not sanitize display text — that happens at read time.
 */
export function snapshotDataDragonAbilities(input: {
  passive?: unknown;
  spells?: unknown;
}): StoredChampionAbilities {
  const passive = snapshotPassive(input.passive);
  const spells = Array.isArray(input.spells)
    ? input.spells.slice(0, SPELL_SLOTS.length).map(snapshotSpell)
    : [];
  if (!hasStoredContent(passive, spells)) {
    return { passive: {}, spells: [] };
  }
  return { passive, spells };
}

function buildIconUrl(
  imageFull: string | null | undefined,
  version: string | null,
  builder: (imageFull: string, version: string) => string | null,
): string | null {
  const file = optionalString(imageFull ?? undefined);
  const ver = optionalString(version ?? undefined);
  if (!file || !ver) {
    return null;
  }
  try {
    return builder(file, ver);
  } catch {
    return null;
  }
}

function toAbility(input: {
  slot: ChampionAbilitySlot;
  stored: StoredChampionPassive | StoredChampionSpell;
  iconUrl: string | null;
}): ChampionAbilitySummary {
  const cooldown =
    'cooldownBurn' in input.stored ? optionalString(input.stored.cooldownBurn) : undefined;
  const cost = 'costBurn' in input.stored ? optionalString(input.stored.costBurn) : undefined;
  const range = 'rangeBurn' in input.stored ? optionalString(input.stored.rangeBurn) : undefined;
  return ChampionAbilitySummarySchema.parse({
    slot: input.slot,
    name: optionalString(input.stored.name) ?? SLOT_FALLBACK_NAME[input.slot],
    description: normalizeAbilityDescription(input.stored.description),
    iconUrl: input.iconUrl,
    ...(cooldown ? { cooldown } : {}),
    ...(cost ? { cost } : {}),
    ...(range ? { range } : {}),
  });
}

/**
 * Map persisted champion ability JSON into the public DTO.
 * Empty stored blobs yield an empty array so the UI can hide the ability row.
 */
export function extractChampionAbilities(
  stored: { passive?: unknown; spells?: unknown },
  urls: AbilityIconUrlBuilders,
): ChampionAbilitySummary[] {
  const snapshot = snapshotDataDragonAbilities({
    passive: stored.passive,
    spells: stored.spells,
  });
  if (!hasStoredContent(snapshot.passive, snapshot.spells)) {
    return [];
  }

  const passive = toAbility({
    slot: 'PASSIVE',
    stored: snapshot.passive,
    iconUrl: buildIconUrl(snapshot.passive.imageFull, urls.version, urls.buildPassiveIconUrl),
  });

  const spells = SPELL_SLOTS.map((slot, index) =>
    toAbility({
      slot,
      stored: snapshot.spells[index] ?? {},
      iconUrl: buildIconUrl(
        snapshot.spells[index]?.imageFull,
        urls.version,
        urls.buildSpellIconUrl,
      ),
    }),
  );

  return [passive, ...spells];
}
