export type CanonicalSummonerSpellPair = {
  spell1Id: number;
  spell2Id: number;
  signature: string;
};

/** Unordered pair: Flash+Teleport === Teleport+Flash. */
export function canonicalizeSummonerSpellPair(
  summonerSpell1Id: number,
  summonerSpell2Id: number,
): CanonicalSummonerSpellPair {
  const left = summonerSpell1Id;
  const right = summonerSpell2Id;
  const spell1Id = Math.min(left, right);
  const spell2Id = Math.max(left, right);
  return {
    spell1Id,
    spell2Id,
    signature: `${spell1Id}-${spell2Id}`,
  };
}
