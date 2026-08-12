/** Nest injection token for the GameDataProvider implementation. */
export const GAME_DATA_PROVIDER = Symbol('GAME_DATA_PROVIDER');

/** Nest injection token for validated Riot configuration. */
export const RIOT_CONFIG = Symbol('RIOT_CONFIG');

/** Nest injection token for the Redis-backed proactive Riot request budget store. */
export const RIOT_REQUEST_BUDGET_STORE = Symbol('RIOT_REQUEST_BUDGET_STORE');
