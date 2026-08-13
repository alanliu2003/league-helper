export type RunePageInput = {
  perkIds: readonly number[];
  statPerkIds: readonly number[];
  primaryPerkStyleId: number | null;
  secondaryPerkStyleId: number | null;
};

export type DerivedRunePage = {
  signature: string;
  keystoneId: number | null;
  primaryPerkIds: number[];
  secondaryPerkIds: number[];
  statPerkIds: number[];
  primaryPerkStyleId: number | null;
  secondaryPerkStyleId: number | null;
  stylesComplete: boolean;
};

const PRIMARY_PERK_COUNT = 4;

/**
 * Persisted perkIds are style-then-selection order from Match-v5:
 * [keystone, primary rows..., secondary selections...].
 * Style IDs are optional; never invent a tree from missing source.
 */
export function deriveRunePage(input: RunePageInput): DerivedRunePage | null {
  const perkIds = input.perkIds.filter((id) => id > 0);
  if (perkIds.length < PRIMARY_PERK_COUNT) {
    return null;
  }

  const primaryPerkIds = perkIds.slice(0, PRIMARY_PERK_COUNT);
  const secondaryPerkIds = perkIds.slice(PRIMARY_PERK_COUNT);
  const statPerkIds = input.statPerkIds.filter((id) => id > 0);
  const stylesComplete =
    input.primaryPerkStyleId !== null &&
    input.primaryPerkStyleId > 0 &&
    input.secondaryPerkStyleId !== null &&
    input.secondaryPerkStyleId > 0;

  const styleLeft = stylesComplete ? String(input.primaryPerkStyleId) : '';
  const styleRight = stylesComplete ? String(input.secondaryPerkStyleId) : '';

  return {
    signature: [
      styleLeft,
      primaryPerkIds.join('-'),
      styleRight,
      secondaryPerkIds.join('-'),
      statPerkIds.join('-'),
    ].join(':'),
    keystoneId: primaryPerkIds[0] ?? null,
    primaryPerkIds,
    secondaryPerkIds,
    statPerkIds,
    primaryPerkStyleId: stylesComplete ? input.primaryPerkStyleId : null,
    secondaryPerkStyleId: stylesComplete ? input.secondaryPerkStyleId : null,
    stylesComplete,
  };
}
