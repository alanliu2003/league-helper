export const CHAMPION_BUILD_CATEGORIES = [
  'STARTING_ITEMS',
  'CORE_BUILD',
  'BOOTS',
  'RUNES',
  'SUMMONER_SPELLS',
  'SKILL_SEQUENCE',
  'SKILL_PRIORITY',
] as const;

export type ChampionBuildCategory = (typeof CHAMPION_BUILD_CATEGORIES)[number];

export const DEFAULT_BUILD_AGGREGATION_VERSION = '1';
