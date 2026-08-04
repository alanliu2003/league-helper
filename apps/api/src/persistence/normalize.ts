/** Lowercase + trim for Riot ID lookup keys. Display casing is stored separately. */
export function normalizeRiotLookupValue(value: string): string {
  return value.trim().toLowerCase();
}
